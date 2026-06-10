import type { EmployeeRow, EmployeeView } from './hr.types';

export interface EmployeeFilters {
  department?: string;
  status?: string;
  search?: string;
}

/** Clamp/normalize pagination input to safe bounds and compute LIMIT/OFFSET. */
export function normalizePagination(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; limit: number; offset: number } {
  const p = Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
  const sizeRaw = Number.isFinite(pageSize) && (pageSize as number) > 0 ? Math.floor(pageSize as number) : 20;
  const size = Math.min(sizeRaw, 100); // cap page size
  return { page: p, pageSize: size, limit: size, offset: (p - 1) * size };
}

/**
 * Build a parameterized WHERE clause for the employee list from filters, starting placeholders at
 * `startIndex`. Returns the SQL fragment (always includes the soft-delete guard) and the params.
 * RLS scopes the tenant, so tenant_id is intentionally NOT in the WHERE.
 */
export function buildEmployeeWhere(
  filters: EmployeeFilters,
  startIndex = 1,
): { clause: string; params: unknown[] } {
  const conditions = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  let i = startIndex;

  if (filters.department) {
    conditions.push(`department_id = $${i++}`);
    params.push(filters.department);
  }
  if (filters.status) {
    conditions.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.search) {
    conditions.push(`(first_name ILIKE $${i} OR last_name ILIKE $${i} OR employee_code ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }

  return { clause: `WHERE ${conditions.join(' AND ')}`, params };
}

/** Map a raw employee row to the API view, reconstituting Money from minor units + currency. */
export function mapEmployeeRow(row: EmployeeRow): EmployeeView {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    positionId: row.position_id,
    joinDate: row.join_date,
    salary:
      row.salary_amount_minor === null || row.salary_amount_minor === undefined
        ? null
        : { amountMinor: Number(row.salary_amount_minor), currency: row.salary_currency },
    status: row.status,
  };
}
