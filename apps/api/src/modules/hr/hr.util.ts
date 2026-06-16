import type { EmployeeRow, EmployeeView } from './hr.types';

/** Minimal structural manager type so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

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
