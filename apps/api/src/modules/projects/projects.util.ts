import type { Money } from '@metaxperts/shared';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Allocate the next per-tenant, per-type project document number (PRJ-000001). */
export async function nextProjectDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO project_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = project_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

/** Labour cost of a time entry = minutes × hourly cost rate (integer minor units). */
export function entryCost(minutes: number, costRateMinor: number): number {
  return Math.round(((minutes || 0) / 60) * (costRateMinor || 0));
}

/** Billable amount of a time entry = minutes × hourly bill rate (0 when non-billable). */
export function entryBill(minutes: number, billRateMinor: number, billable: boolean): number {
  if (!billable) return 0;
  return Math.round(((minutes || 0) / 60) * (billRateMinor || 0));
}

export interface ProjectActuals {
  minutes: number;
  laborCostMinor: number;
  billableMinor: number;
  expenseCostMinor: number;
  billableExpenseMinor: number;
  totalCostMinor: number;
  totalBillableMinor: number;
}

/**
 * Roll up approved time + expenses into project actuals. Cost = labour cost + expense cost; billable =
 * billable labour + billable expenses. (Time entries carry their costed amounts; drafts contribute 0.)
 */
export function projectActuals(
  time: { minutes: number; costMinor: number; billMinor: number }[],
  expenses: { amountMinor: number; billable: boolean }[],
): ProjectActuals {
  const minutes = time.reduce((s, t) => s + t.minutes, 0);
  const laborCostMinor = time.reduce((s, t) => s + t.costMinor, 0);
  const billableMinor = time.reduce((s, t) => s + t.billMinor, 0);
  const expenseCostMinor = expenses.reduce((s, e) => s + e.amountMinor, 0);
  const billableExpenseMinor = expenses.reduce((s, e) => s + (e.billable ? e.amountMinor : 0), 0);
  return {
    minutes,
    laborCostMinor,
    billableMinor,
    expenseCostMinor,
    billableExpenseMinor,
    totalCostMinor: laborCostMinor + expenseCostMinor,
    totalBillableMinor: billableMinor + billableExpenseMinor,
  };
}

/** Remaining budget = budget − total cost (negative = over budget). */
export function budgetRemaining(budgetMinor: number, totalCostMinor: number): number {
  return budgetMinor - totalCostMinor;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const dateOnly = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string) ?? null));

export function mapProject(r: Row) {
  return {
    id: r.id as string,
    projectNo: r.project_no as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    clientId: (r.client_id as string) ?? null,
    clientName: (r.client_name as string) ?? null,
    managerEmployeeId: (r.manager_employee_id as string) ?? null,
    managerName: (r.manager_name as string) ?? null,
    status: r.status as string,
    billingType: r.billing_type as string,
    startDate: dateOnly(r.start_date),
    endDate: dateOnly(r.end_date),
    budget: money(r.budget_minor, r.currency),
    description: (r.description as string) ?? null,
  };
}

export function mapMember(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    employeeId: r.employee_id as string,
    employeeName: (r.employee_name as string) ?? null,
    role: (r.role as string) ?? null,
    costRate: money(r.cost_rate_minor, currency),
    billRate: money(r.bill_rate_minor, currency),
  };
}

export function mapTask(r: Row) {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    assigneeEmployeeId: (r.assignee_employee_id as string) ?? null,
    assigneeName: (r.assignee_name as string) ?? null,
    status: r.status as string,
    priority: r.priority as string,
    estimateMinutes: Number(r.estimate_minutes ?? 0),
    dueDate: dateOnly(r.due_date),
    sort: Number(r.sort ?? 0),
    description: (r.description as string) ?? null,
  };
}

export function mapTimeEntry(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    taskId: (r.task_id as string) ?? null,
    employeeId: r.employee_id as string,
    employeeName: (r.employee_name as string) ?? null,
    entryDate: dateOnly(r.entry_date),
    minutes: Number(r.minutes ?? 0),
    billable: Boolean(r.billable),
    status: r.status as string,
    cost: money(r.cost_minor, currency),
    bill: money(r.bill_minor, currency),
    description: (r.description as string) ?? null,
  };
}

export function mapExpense(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    expenseDate: dateOnly(r.expense_date),
    category: (r.category as string) ?? null,
    amount: money(r.amount_minor, currency),
    billable: Boolean(r.billable),
    employeeId: (r.employee_id as string) ?? null,
    description: (r.description as string) ?? null,
  };
}
