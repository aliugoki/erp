import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { type SuccessEnvelope, paginationMeta } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  CreateAttendanceDto,
  CreateDepartmentDto,
  CreateEmployeeDto,
  CreatePositionDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/hr.dto';
import type { DepartmentView, EmployeeRow, EmployeeView, PositionView } from './hr.types';
import { buildEmployeeWhere, mapEmployeeRow, normalizePagination, returningRows } from './hr.util';

const EMP_COLS =
  'id, employee_code, first_name, last_name, email, phone, department_id, position_id, join_date, salary_amount_minor, salary_currency, status';

@Injectable()
export class HrService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Departments ────────────────────────────────────────────────────────────
  async createDepartment(dto: CreateDepartmentDto): Promise<DepartmentView> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_department (tenant_id, name, manager_id, parent_department_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
         RETURNING id, name, manager_id, parent_department_id`,
        [dto.name, dto.managerId ?? null, dto.parentDepartmentId ?? null],
      )) as Array<Record<string, string | null>>;
      return toDepartment(rows[0]!);
    });
  }

  async listDepartments(): Promise<DepartmentView[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, manager_id, parent_department_id FROM hr_department WHERE deleted_at IS NULL ORDER BY name`,
      )) as Array<Record<string, string | null>>;
      return rows.map(toDepartment);
    });
  }

  async deleteDepartment(id: string): Promise<void> {
    await this.softDelete('hr_department', id);
  }

  // ── Positions ──────────────────────────────────────────────────────────────
  async createPosition(dto: CreatePositionDto): Promise<PositionView> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_position (tenant_id, title, description)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2)
         RETURNING id, title, description`,
        [dto.title, dto.description ?? null],
      )) as Array<Record<string, string | null>>;
      const r = rows[0]!;
      return { id: r.id!, title: r.title!, description: r.description ?? null };
    });
  }

  async listPositions(): Promise<PositionView[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, title, description FROM hr_position WHERE deleted_at IS NULL ORDER BY title`,
      )) as Array<Record<string, string | null>>;
      return rows.map((r) => ({ id: r.id!, title: r.title!, description: r.description ?? null }));
    });
  }

  // ── Employees ──────────────────────────────────────────────────────────────
  async createEmployee(dto: CreateEmployeeDto): Promise<EmployeeView> {
    const code = dto.employeeCode ?? `EMP-${randomBytes(3).toString('hex').toUpperCase()}`;
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_employee
           (tenant_id, employee_code, first_name, last_name, email, phone, department_id, position_id,
            join_date, salary_amount_minor, salary_currency, status,
            date_of_birth, gender, marital_status, national_id, blood_group, nationality, address, city,
            country, emergency_contact_name, emergency_contact_phone, designation, employment_type,
            reporting_to, confirmation_date, work_location)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
         RETURNING ${EMP_COLS}`,
        [
          code,
          dto.firstName,
          dto.lastName,
          dto.email ?? null,
          dto.phone ?? null,
          dto.departmentId ?? null,
          dto.positionId ?? null,
          dto.joinDate ?? null,
          dto.salary?.amountMinor ?? null,
          dto.salary?.currency ?? 'PKR',
          dto.status ?? 'ACTIVE',
          dto.dateOfBirth ?? null,
          dto.gender ?? null,
          dto.maritalStatus ?? null,
          dto.nationalId ?? null,
          dto.bloodGroup ?? null,
          dto.nationality ?? null,
          dto.address ?? null,
          dto.city ?? null,
          dto.country ?? null,
          dto.emergencyContactName ?? null,
          dto.emergencyContactPhone ?? null,
          dto.designation ?? null,
          dto.employmentType ?? null,
          dto.reportingTo ?? null,
          dto.confirmationDate ?? null,
          dto.workLocation ?? null,
        ],
      )) as EmployeeRow[];
      return mapEmployeeRow(rows[0]!);
    });
  }

  async listEmployees(query: ListEmployeesQueryDto): Promise<SuccessEnvelope<EmployeeView[]>> {
    const { page, pageSize, limit, offset } = normalizePagination(query.page, query.pageSize);
    const { clause, params } = buildEmployeeWhere({
      department: query.department,
      status: query.status,
      search: query.search,
    });
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${EMP_COLS} FROM hr_employee ${clause} ORDER BY created_at DESC LIMIT $${
          params.length + 1
        } OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      )) as EmployeeRow[];
      const countRows = (await m.query(
        `SELECT count(*)::int AS total FROM hr_employee ${clause}`,
        params,
      )) as Array<{ total: number }>;
      const total = countRows[0]?.total ?? 0;
      return { data: rows.map(mapEmployeeRow), meta: { pagination: paginationMeta(total, page, pageSize) } };
    });
  }

  async getEmployee(id: string): Promise<EmployeeView> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${EMP_COLS} FROM hr_employee WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )) as EmployeeRow[];
      if (!rows[0]) throw new NotFoundException('Employee not found');
      return mapEmployeeRow(rows[0]);
    });
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto): Promise<EmployeeView> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      sets.push(`${col} = $${params.length + 1}`);
      params.push(val);
    };
    if (dto.firstName !== undefined) set('first_name', dto.firstName);
    if (dto.lastName !== undefined) set('last_name', dto.lastName);
    if (dto.email !== undefined) set('email', dto.email);
    if (dto.phone !== undefined) set('phone', dto.phone);
    if (dto.departmentId !== undefined) set('department_id', dto.departmentId);
    if (dto.positionId !== undefined) set('position_id', dto.positionId);
    if (dto.status !== undefined) set('status', dto.status);
    if (dto.salary !== undefined) {
      set('salary_amount_minor', dto.salary.amountMinor);
      set('salary_currency', dto.salary.currency);
    }

    return this.tenantTx.run(async (m) => {
      if (sets.length === 0) return this.getEmployeeWith(m, id);
      sets.push('updated_at = now()');
      const rows = returningRows<EmployeeRow>(
        await m.query(
          `UPDATE hr_employee SET ${sets.join(', ')} WHERE id = $${params.length + 1} AND deleted_at IS NULL
           RETURNING ${EMP_COLS}`,
          [...params, id],
        ),
      );
      if (!rows[0]) throw new NotFoundException('Employee not found');
      return mapEmployeeRow(rows[0]);
    });
  }

  async deleteEmployee(id: string): Promise<void> {
    await this.softDelete('hr_employee', id);
  }

  // ── Attendance ─────────────────────────────────────────────────────────────
  async createAttendance(dto: CreateAttendanceDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_attendance (tenant_id, employee_id, date, check_in, check_out, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
         RETURNING id, employee_id, date, check_in, check_out, status`,
        [dto.employeeId, dto.date, dto.checkIn ?? null, dto.checkOut ?? null, dto.status ?? 'PRESENT'],
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
  }

  async listAttendance(employeeId: string) {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, employee_id, date, check_in, check_out, status FROM hr_attendance
         WHERE employee_id = $1 AND deleted_at IS NULL ORDER BY date DESC`,
        [employeeId],
      ),
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private async getEmployeeWith(m: EntityManager, id: string): Promise<EmployeeView> {
    const rows = (await m.query(
      `SELECT ${EMP_COLS} FROM hr_employee WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    )) as EmployeeRow[];
    if (!rows[0]) throw new NotFoundException('Employee not found');
    return mapEmployeeRow(rows[0]);
  }

  private async softDelete(table: string, id: string): Promise<void> {
    await this.tenantTx.run(async (m) => {
      const rows = returningRows(
        await m.query(`UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]),
      );
      if (rows.length === 0) throw new NotFoundException('Not found');
    });
  }
}

function toDepartment(r: Record<string, string | null>): DepartmentView {
  return {
    id: r.id!,
    name: r.name!,
    managerId: r.manager_id ?? null,
    parentDepartmentId: r.parent_department_id ?? null,
  };
}
