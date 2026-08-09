import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  CreateAreaDto,
  CreateTableDto,
  ListTablesQueryDto,
  MergeTablesDto,
  SetTableStatusDto,
  UpdateAreaDto,
  UpdateTableDto,
} from './dto/restaurant.dto';
import { type Row, type TableStatus, canTransitionTable, rowsOf } from './restaurant.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isUnique = (e: unknown) => code(e) === '23505';
const isForeignKey = (e: unknown) => code(e) === '23503';
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Visual floor plan: areas (indoor/outdoor/VIP/terrace/garden/private room) and tables with x/y/size
 * for the drag-and-drop designer, plus live table status with a guarded state machine and
 * merge/split. Tenant-scoped (RLS). Order-driven status changes arrive in Phase 4; here the status
 * endpoint is the manual/operational path (seat, clear, set cleaning).
 */
@Injectable()
export class RestaurantFloorService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Areas ─────────────────────────────────────────────────────────────────────--
  async createArea(dto: CreateAreaDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO restaurant_floor_area (tenant_id, branch_id, name, kind, sort_order, layout)
         VALUES (${TENANT}, $1,$2, COALESCE($3,'INDOOR'), COALESCE($4,0), COALESCE($5,'{}'::jsonb)) RETURNING id`,
        [dto.branchId ?? null, dto.name, dto.kind ?? null, dto.sortOrder ?? null, dto.layout ? JSON.stringify(dto.layout) : null],
      )) as Row[];
      return this.getAreaInTx(m, rows[0]!.id as string);
    });
  }

  async listAreas(branchId?: string) {
    return this.tenantTx.run(async (m) => {
      const params: unknown[] = [branchId ?? null];
      const rows = (await m.query(
        `SELECT a.id, a.branch_id, a.name, a.kind, a.sort_order, a.layout,
                count(t.id) FILTER (WHERE t.deleted_at IS NULL)::int AS table_count
         FROM restaurant_floor_area a LEFT JOIN restaurant_table t ON t.area_id = a.id
         WHERE a.deleted_at IS NULL AND ($1::uuid IS NULL OR a.branch_id = $1)
         GROUP BY a.id ORDER BY a.sort_order, a.name`,
        params,
      )) as Row[];
      return rows.map((r) => ({ id: r.id, branchId: r.branch_id ?? null, name: r.name, kind: r.kind, sortOrder: Number(r.sort_order), layout: r.layout ?? {}, tableCount: Number(r.table_count) }));
    });
  }

  private async getAreaInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT id, branch_id, name, kind, sort_order, layout FROM restaurant_floor_area WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Area not found');
    const r = rows[0];
    return { id: r.id, branchId: r.branch_id ?? null, name: r.name, kind: r.kind, sortOrder: Number(r.sort_order), layout: r.layout ?? {} };
  }

  async updateArea(id: string, dto: UpdateAreaDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('name', dto.name);
      set('kind', dto.kind);
      set('sort_order', dto.sortOrder);
      if (dto.layout !== undefined) sets.push(`layout=$${params.push(JSON.stringify(dto.layout))}::jsonb`);
      if (!sets.length) return this.getAreaInTx(m, id);
      const res = rowsOf(await m.query(
        `UPDATE restaurant_floor_area SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
        params,
      ));
      if (!res[0]) throw new NotFoundException('Area not found');
      return this.getAreaInTx(m, id);
    });
  }

  async deleteArea(id: string) {
    return this.tenantTx.run(async (m) => {
      const inUse = (await m.query(`SELECT 1 FROM restaurant_table WHERE area_id=$1 AND deleted_at IS NULL LIMIT 1`, [id])) as Row[];
      if (inUse[0]) throw new UnprocessableEntityException('Area has tables; move or delete them first');
      const res = rowsOf(await m.query(
        `UPDATE restaurant_floor_area SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Area not found');
      return { id, deleted: true };
    });
  }

  // ── Tables ──────────────────────────────────────────────────────────────────────
  async createTable(dto: CreateTableDto) {
    return this.tenantTx.run(async (m) => {
      let branchId = dto.branchId ?? null;
      if (dto.areaId) {
        const area = (await m.query(`SELECT branch_id FROM restaurant_floor_area WHERE id=$1 AND deleted_at IS NULL`, [dto.areaId])) as Row[];
        if (!area[0]) throw new BadRequestException('Unknown area for this tenant');
        branchId = branchId ?? ((area[0].branch_id as string) ?? null);
      }
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_table
             (tenant_id, area_id, branch_id, code, capacity, shape, pos_x, pos_y, width, height, rotation)
           VALUES (${TENANT}, $1,$2,$3, COALESCE($4,2), COALESCE($5,'SQUARE'), COALESCE($6,0), COALESCE($7,0),
                   COALESCE($8,80), COALESCE($9,80), COALESCE($10,0)) RETURNING id`,
          [dto.areaId ?? null, branchId, dto.code, dto.capacity ?? null, dto.shape ?? null, dto.posX ?? null, dto.posY ?? null, dto.width ?? null, dto.height ?? null, dto.rotation ?? null],
        )) as Row[];
        return this.getTableInTx(m, rows[0]!.id as string);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Table code "${dto.code}" already exists for this branch`);
        if (isForeignKey(err)) throw new BadRequestException('Unknown area for this tenant');
        throw err;
      }
    });
  }

  async listTables(query: ListTablesQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['t.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`t.branch_id = $${params.push(query.branchId)}`);
      if (query.areaId) conds.push(`t.area_id = $${params.push(query.areaId)}`);
      if (query.status) conds.push(`t.status = $${params.push(query.status)}`);
      const rows = (await m.query(
        `SELECT t.id, t.area_id, a.name AS area, t.branch_id, t.code, t.capacity, t.shape, t.pos_x, t.pos_y,
                t.width, t.height, t.rotation, t.status, t.merged_into_id, t.active
         FROM restaurant_table t LEFT JOIN restaurant_floor_area a ON a.id = t.area_id
         WHERE ${conds.join(' AND ')} ORDER BY a.sort_order NULLS LAST, t.code`,
        params,
      )) as Row[];
      return rows.map((r) => this.mapTable(r));
    });
  }

  async getTable(id: string) {
    return this.tenantTx.run((m) => this.getTableInTx(m, id));
  }

  private async getTableInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT t.id, t.area_id, a.name AS area, t.branch_id, t.code, t.capacity, t.shape, t.pos_x, t.pos_y,
              t.width, t.height, t.rotation, t.status, t.merged_into_id, t.active
       FROM restaurant_table t LEFT JOIN restaurant_floor_area a ON a.id = t.area_id
       WHERE t.id=$1 AND t.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Table not found');
    return this.mapTable(rows[0]);
  }

  async updateTable(id: string, dto: UpdateTableDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown) => {
        if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
      };
      set('area_id', dto.areaId);
      set('code', dto.code);
      set('capacity', dto.capacity);
      set('shape', dto.shape);
      set('pos_x', dto.posX);
      set('pos_y', dto.posY);
      set('width', dto.width);
      set('height', dto.height);
      set('rotation', dto.rotation);
      set('active', dto.active);
      if (!sets.length) return this.getTableInTx(m, id);
      try {
        const res = rowsOf(await m.query(
          `UPDATE restaurant_table SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(id)} AND deleted_at IS NULL RETURNING id`,
          params,
        ));
        if (!res[0]) throw new NotFoundException('Table not found');
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Table code "${dto.code}" already exists for this branch`);
        if (isForeignKey(err)) throw new BadRequestException('Unknown area for this tenant');
        throw err;
      }
      return this.getTableInTx(m, id);
    });
  }

  async deleteTable(id: string) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_table SET deleted_at=now(), updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      ));
      if (!res[0]) throw new NotFoundException('Table not found');
      return { id, deleted: true };
    });
  }

  /** Operational status change, guarded by the transition state machine. */
  async setStatus(id: string, dto: SetTableStatusDto) {
    return this.tenantTx.run(async (m) => {
      const cur = (await m.query(`SELECT status, merged_into_id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!cur[0]) throw new NotFoundException('Table not found');
      if (cur[0].merged_into_id) throw new UnprocessableEntityException('Table is merged into another; set status on the primary table');
      const from = cur[0].status as TableStatus;
      const to = dto.status as TableStatus;
      if (!canTransitionTable(from, to)) throw new UnprocessableEntityException(`Cannot move a ${from} table to ${to}`);
      await m.query(`UPDATE restaurant_table SET status=$1, updated_at=now() WHERE id=$2`, [to, id]);
      return this.getTableInTx(m, id);
    });
  }

  /**
   * Merge tables into the first (primary): the others point at it via merged_into_id and go OCCUPIED.
   * All must share a branch and be free (AVAILABLE/RESERVED). Reversible with {@link split}.
   */
  async merge(dto: MergeTablesDto) {
    return this.tenantTx.run(async (m) => {
      const [primaryId, ...rest] = dto.tableIds;
      const rows = (await m.query(
        `SELECT id, branch_id, status, merged_into_id FROM restaurant_table WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [dto.tableIds],
      )) as Row[];
      if (rows.length !== dto.tableIds.length) throw new BadRequestException('One or more tables do not exist for this tenant');
      const branches = new Set(rows.map((r) => (r.branch_id as string) ?? 'null'));
      if (branches.size > 1) throw new UnprocessableEntityException('Tables must belong to the same branch to merge');
      if (rows.some((r) => r.merged_into_id)) throw new UnprocessableEntityException('One or more tables are already merged');
      if (rows.some((r) => !['AVAILABLE', 'RESERVED'].includes(r.status as string))) throw new UnprocessableEntityException('Only free tables can be merged');
      await m.query(`UPDATE restaurant_table SET status='OCCUPIED', updated_at=now() WHERE id=$1`, [primaryId]);
      await m.query(
        `UPDATE restaurant_table SET merged_into_id=$1, status='OCCUPIED', updated_at=now() WHERE id = ANY($2::uuid[])`,
        [primaryId, rest],
      );
      return { primaryId, merged: rest, count: dto.tableIds.length };
    });
  }

  /** Split a previously-merged group: children detach and free; the primary frees. */
  async split(primaryId: string) {
    return this.tenantTx.run(async (m) => {
      const primary = (await m.query(`SELECT id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`, [primaryId])) as Row[];
      if (!primary[0]) throw new NotFoundException('Table not found');
      const children = (await m.query(`SELECT id FROM restaurant_table WHERE merged_into_id=$1 AND deleted_at IS NULL`, [primaryId])) as Row[];
      if (!children[0]) throw new UnprocessableEntityException('Table is not a merge primary');
      await m.query(`UPDATE restaurant_table SET merged_into_id=NULL, status='CLEANING', updated_at=now() WHERE merged_into_id=$1`, [primaryId]);
      await m.query(`UPDATE restaurant_table SET status='CLEANING', updated_at=now() WHERE id=$1`, [primaryId]);
      return { primaryId, split: children.map((c) => c.id), count: children.length + 1 };
    });
  }

  private mapTable(r: Row) {
    return {
      id: r.id, areaId: r.area_id ?? null, area: r.area ?? null, branchId: r.branch_id ?? null,
      code: r.code, capacity: Number(r.capacity), shape: r.shape,
      position: { x: Number(r.pos_x), y: Number(r.pos_y), width: Number(r.width), height: Number(r.height), rotation: Number(r.rotation) },
      status: r.status, mergedIntoId: r.merged_into_id ?? null, active: Boolean(r.active),
    };
  }
}
