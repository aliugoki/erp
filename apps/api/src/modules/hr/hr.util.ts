import type { EmployeeRow, EmployeeView } from './hr.types';

/** Minimal structural manager type so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Normalize a TypeORM `manager.query()` result to the rows array. For `UPDATE`/`DELETE … RETURNING`
 * the driver returns `[rows, affectedCount]` (not just `rows`, as it does for `SELECT`/`INSERT …
 * RETURNING`), so a naive `rows[0]` would be the inner array. This unwraps that shape; other shapes
 * (already a rows array) pass through unchanged. */
export function returningRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }
  return (result ?? []) as T[];
}

/** Allocate the next per-tenant, per-type HR document number (e.g. LEAVE-0001, PAYRUN-0003). */
export async function nextHrDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO hr_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = hr_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(4, '0')}`;
}

/** Inclusive whole-day count between two ISO dates (a one-day leave = 1). UTC to avoid DST drift. */
export function inclusiveDays(start: string, end: string): number {
  const s = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const e = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  return Math.floor((e - s) / 86_400_000) + 1;
}

export interface PayComponent {
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  calc: 'FIXED' | 'PCT_OF_BASIC';
  valueMinor: number;
  percent: number;
}
export interface PayslipLineComputed {
  code: string;
  name: string;
  type: string;
  amountMinor: number;
}
export interface PayslipComputed {
  basicMinor: number;
  grossMinor: number;
  deductionMinor: number;
  netMinor: number;
  lines: PayslipLineComputed[];
}

/** Payable-day weight of one attendance record: present/paid-leave = 1, half-day = 0.5, absent = 0. */
export function attendanceDayWeight(status: string): number {
  if (status === 'PRESENT' || status === 'LEAVE') return 1;
  if (status === 'HALF_DAY') return 0.5;
  return 0; // ABSENT or unknown
}

/** Sum the payable days across a month's attendance records. */
export function attendancePayableDays(records: Array<{ status: string }>): number {
  return records.reduce((sum, r) => sum + attendanceDayWeight(r.status), 0);
}

/** Pro-rate a basic salary by attendance: basic × min(payableDays, workingDays) / workingDays (floored,
 * integer minor units). With no working days configured, or no attendance recorded, the full basic is
 * paid so payroll still works for tenants that don't track attendance. */
export function proratedBasicMinor(
  basicMinor: number,
  payableDays: number,
  workingDays: number,
  hasAttendance: boolean,
): number {
  if (!hasAttendance || workingDays <= 0) return basicMinor;
  const capped = Math.min(payableDays, workingDays);
  return Math.floor((basicMinor * capped) / workingDays);
}

/** Compute a payslip from a basic salary and the tenant's active components. Earnings add to gross,
 * deductions subtract to net; percent components are taken off basic. Integer minor units throughout
 * (percent uses floor). Zero/negative component amounts are skipped so the slip stays clean. */
export function computePayslip(basicMinor: number, components: PayComponent[]): PayslipComputed {
  const lines: PayslipLineComputed[] = [
    { code: 'BASIC', name: 'Basic Salary', type: 'BASIC', amountMinor: basicMinor },
  ];
  let grossMinor = basicMinor;
  let deductionMinor = 0;
  for (const c of components) {
    const amount = c.calc === 'FIXED' ? c.valueMinor : Math.floor((basicMinor * c.percent) / 100);
    if (amount <= 0) continue;
    lines.push({ code: c.code, name: c.name, type: c.type, amountMinor: amount });
    if (c.type === 'EARNING') grossMinor += amount;
    else deductionMinor += amount;
  }
  return { basicMinor, grossMinor, deductionMinor, netMinor: grossMinor - deductionMinor, lines };
}

export interface EmployeeFilters {
  department?: string;
  branch?: string;
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
  if (filters.branch) {
    conditions.push(`branch_id = $${i++}`);
    params.push(filters.branch);
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
    branchId: row.branch_id ?? null,
    joinDate: row.join_date,
    salary:
      row.salary_amount_minor === null || row.salary_amount_minor === undefined
        ? null
        : { amountMinor: Number(row.salary_amount_minor), currency: row.salary_currency },
    status: row.status,
    photoRef: row.photo_ref ?? null,
  };
}
