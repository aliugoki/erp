import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

type Row = Record<string, unknown>;
const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === '23505';
const isFk = (e: unknown): boolean => (e as { code?: string })?.code === '23503';

/** Unwrap TypeORM's `[rows, affectedCount]` shape for UPDATE/DELETE…RETURNING (else a plain rows array). */
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as Row[];
  }
  return (result ?? []) as Row[];
}

export interface BranchView {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  managerId: string | null;
  managerName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  isHeadOffice: boolean;
  active: boolean;
  employeeCount: number;
}

const SELECT = `
  SELECT b.id, b.name, b.code, b.address, b.city, b.phone, b.manager_id, b.cost_center_id,
         b.is_head_office, b.active,
         (m.first_name || ' ' || m.last_name) AS manager_name,
         cc.name AS cost_center_name,
         (SELECT count(*) FROM hr_employee e WHERE e.branch_id = b.id AND e.deleted_at IS NULL)::int AS employee_count
  FROM branch b
  LEFT JOIN hr_employee m ON m.id = b.manager_id AND m.deleted_at IS NULL
  LEFT JOIN cost_center cc ON cc.id = b.cost_center_id`;

/**
 * Company branches (sites/offices). Tenant-scoped raw SQL via {@link TenantTransactionService} (RLS);
 * mirrors the HR department CRUD. `branch` is referenced by HR/Inventory/POS/Finance — it is core
 * company infra, not feature-gated. Manager and cost-center are joined for display.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async list(): Promise<BranchView[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`${SELECT} WHERE b.deleted_at IS NULL ORDER BY b.is_head_office DESC, b.name`)) as Row[];
      return rows.map(mapBranch);
    });
  }

  async get(id: string): Promise<BranchView> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`${SELECT} WHERE b.id = $1 AND b.deleted_at IS NULL`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Branch not found');
      return mapBranch(rows[0]);
    });
  }

  async create(dto: CreateBranchDto): Promise<BranchView> {
    const id = await this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO branch (tenant_id, name, code, address, city, phone, manager_id, cost_center_id, is_head_office, active)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [dto.name, dto.code ?? null, dto.address ?? null, dto.city ?? null, dto.phone ?? null,
           dto.managerId ?? null, dto.costCenterId ?? null, dto.isHeadOffice ?? false, dto.active ?? true],
        )) as Row[];
        return rows[0]!.id as string;
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Branch code "${dto.code}" already exists`);
        if (isFk(err)) throw new BadRequestException('Unknown manager or cost center for this tenant');
        throw err;
      }
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateBranchDto): Promise<BranchView> {
    await this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
      // COALESCE for plain fields (omit = keep); manager/cost-center accept explicit null to clear.
      if (dto.name !== undefined) push('name', dto.name);
      if (dto.code !== undefined) push('code', dto.code);
      if (dto.address !== undefined) push('address', dto.address);
      if (dto.city !== undefined) push('city', dto.city);
      if (dto.phone !== undefined) push('phone', dto.phone);
      if (dto.managerId !== undefined) push('manager_id', dto.managerId);
      if (dto.costCenterId !== undefined) push('cost_center_id', dto.costCenterId);
      if (dto.isHeadOffice !== undefined) push('is_head_office', dto.isHeadOffice);
      if (dto.active !== undefined) push('active', dto.active);
      if (sets.length === 0) return;
      let res: unknown;
      try {
        res = await m.query(
          `UPDATE branch SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
          params,
        );
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Branch code "${dto.code}" already exists`);
        if (isFk(err)) throw new BadRequestException('Unknown manager or cost center for this tenant');
        throw err;
      }
      if (rowsOf(res).length === 0) throw new NotFoundException('Branch not found');
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.tenantTx.run(async (m) => {
      const res = await m.query(`UPDATE branch SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
      if (rowsOf(res).length === 0) throw new NotFoundException('Branch not found');
      // Branch removal is a soft delete, so the FK ON DELETE SET NULL never fires — clear the
      // back-references ourselves so no employee/department points at a vanished branch.
      await m.query(`UPDATE hr_employee SET branch_id = NULL, updated_at = now() WHERE branch_id = $1`, [id]);
      await m.query(`UPDATE hr_department SET branch_id = NULL, updated_at = now() WHERE branch_id = $1`, [id]);
      await m.query(`UPDATE inventory_warehouse SET branch_id = NULL, updated_at = now() WHERE branch_id = $1`, [id]);
      await m.query(`UPDATE pos_register SET branch_id = NULL, updated_at = now() WHERE branch_id = $1`, [id]);
    });
  }
}

function mapBranch(r: Row): BranchView {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    address: (r.address as string) ?? null,
    city: (r.city as string) ?? null,
    phone: (r.phone as string) ?? null,
    managerId: (r.manager_id as string) ?? null,
    managerName: (r.manager_name as string) ?? null,
    costCenterId: (r.cost_center_id as string) ?? null,
    costCenterName: (r.cost_center_name as string) ?? null,
    isHeadOffice: !!r.is_head_office,
    active: !!r.active,
    employeeCount: Number(r.employee_count ?? 0),
  };
}
