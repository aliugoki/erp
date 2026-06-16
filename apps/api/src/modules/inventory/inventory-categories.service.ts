import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/inventory.dto';

/** Hard cap on the category tree depth (category → sub-category → sub-sub-category). */
export const MAX_CATEGORY_LEVEL = 3;

interface CategoryRow {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  level: number;
  child_count?: string | number;
  product_count?: string | number;
}

export interface CategoryView {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  level: number;
  childCount: number;
  productCount: number;
}

export interface CategoryNode extends CategoryView {
  children: CategoryNode[];
}

function mapCategoryRow(r: CategoryRow): CategoryView {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    parentId: r.parent_id,
    level: r.level,
    childCount: Number(r.child_count ?? 0),
    productCount: Number(r.product_count ?? 0),
  };
}

/** Assemble a flat, level-ordered category list into a nested tree (roots first). */
export function buildCategoryTree(flat: CategoryView[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const c of flat) byId.set(c.id, { ...c, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Product categories — a tenant-scoped 3-level tree (RLS). All depth/parent invariants are enforced
 * here and backstopped by CHECK constraints + a self-FK in the schema (see the InventoryCategories
 * migration). */
@Injectable()
export class InventoryCategoriesService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Flat list with per-node child/product counts, ordered by level then name. */
  async listCategories(): Promise<CategoryView[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT c.id, c.name, c.code, c.parent_id, c.level,
                (SELECT count(*) FROM inventory_category ch WHERE ch.parent_id = c.id AND ch.deleted_at IS NULL) AS child_count,
                (SELECT count(*) FROM inventory_product p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count
         FROM inventory_category c
         WHERE c.deleted_at IS NULL
         ORDER BY c.level, lower(c.name)`,
      )) as CategoryRow[];
      return rows.map(mapCategoryRow);
    });
  }

  /** The same data as {@link listCategories} but nested into a tree. */
  async getTree(): Promise<CategoryNode[]> {
    return buildCategoryTree(await this.listCategories());
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryView> {
    return this.tenantTx.run(async (m) => {
      let level = 1;
      if (dto.parentId) {
        const parent = (await m.query(
          `SELECT level FROM inventory_category WHERE id=$1 AND deleted_at IS NULL`,
          [dto.parentId],
        )) as Array<{ level: number }>;
        if (!parent[0]) throw new NotFoundException('Parent category not found');
        if (parent[0].level >= MAX_CATEGORY_LEVEL) {
          throw new BadRequestException(`Categories nest at most ${MAX_CATEGORY_LEVEL} levels deep`);
        }
        level = parent[0].level + 1;
      }
      try {
        const rows = (await m.query(
          `INSERT INTO inventory_category (tenant_id, name, code, parent_id, level)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4)
           RETURNING id, name, code, parent_id, level`,
          [dto.name, dto.code ?? null, dto.parentId ?? null, level],
        )) as CategoryRow[];
        return mapCategoryRow(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`A category named "${dto.name}" already exists here`);
        throw err;
      }
    });
  }

  /** Rename a category or change its code. Re-parenting (which would shift descendant levels) is not
   * supported — delete and recreate instead. */
  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryView> {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `UPDATE inventory_category
           SET name = COALESCE($2, name), code = COALESCE($3, code), updated_at = now()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id, name, code, parent_id, level`,
          [id, dto.name ?? null, dto.code ?? null],
        )) as CategoryRow[];
        if (!rows[0]) throw new NotFoundException('Category not found');
        return mapCategoryRow(rows[0]);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`A category named "${dto.name}" already exists here`);
        throw err;
      }
    });
  }

  /** Soft-delete a leaf category. Refuses while it still has sub-categories or products attached, so
   * a delete never silently orphans a sub-tree or unlinks stock. */
  async removeCategory(id: string): Promise<{ id: string; deleted: true }> {
    return this.tenantTx.run(async (m) => {
      const cat = (await m.query(
        `SELECT id FROM inventory_category WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ id: string }>;
      if (!cat[0]) throw new NotFoundException('Category not found');

      const children = (await m.query(
        `SELECT count(*)::int AS n FROM inventory_category WHERE parent_id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ n: number }>;
      if (children[0]!.n > 0) throw new BadRequestException('Remove or move the sub-categories first');

      const products = (await m.query(
        `SELECT count(*)::int AS n FROM inventory_product WHERE category_id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Array<{ n: number }>;
      if (products[0]!.n > 0) throw new BadRequestException('Reassign the products in this category first');

      await m.query(`UPDATE inventory_category SET deleted_at = now() WHERE id = $1`, [id]);
      return { id, deleted: true };
    });
  }
}

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isUnique = (e: unknown) => code(e) === '23505';
