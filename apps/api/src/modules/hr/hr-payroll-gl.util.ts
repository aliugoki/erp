/** GL account map for posting an approved payroll run. One row per tenant. */
export interface HrPayrollGlAccounts {
  salaryExpenseAccountId: string | null;
  salaryPayableAccountId: string | null;
  deductionsPayableAccountId: string | null;
}

export interface GlEntry {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
}
export interface GlVoucher {
  description: string;
  voucherType: 'JV';
  occurredOn: string;
  reference: string;
  entries: GlEntry[];
}

/** Gross pay grouped by the department's salary-expense account (`accountId` null = the department has
 * no per-department account, or the employee has no department → use the tenant-level default). */
export interface ExpenseGroup {
  accountId: string | null;
  grossMinor: number;
}

export interface PayrollRunFigures {
  runNo: string;
  /** Gross broken down per department salary-expense account. Their sum is the run's total gross. */
  expenseGroups: ExpenseGroup[];
  deductionMinor: number;
  netMinor: number;
  occurredOn: string;
}

/**
 * Build the GL voucher for an approved payroll run:
 *   Dr salary expense (gross)            — one debit per distinct expense account (split by department)
 *   Cr deductions payable (deductions)   — only when a deductions account is set and there are deductions
 *   Cr salaries payable / net pay        — the remainder (total gross − deductions credited)
 * Each department's gross debits its own `salary_expense_account_id`; departments without one (and
 * employees without a department) fall back to the tenant-level default expense account. Returns null
 * when the salaries-payable account is unset, the total gross is zero, or any group resolves to no
 * expense account (an unmapped department with no default) — so the caller skips posting. Always
 * balanced: Σ debit = total gross = Σ credit. When no deductions account is configured the deductions
 * fold into the salaries-payable credit, keeping the voucher balanced.
 */
export function payrollRunVoucher(a: HrPayrollGlAccounts, run: PayrollRunFigures): GlVoucher | null {
  if (!a.salaryPayableAccountId) return null;
  const totalGross = run.expenseGroups.reduce((s, g) => s + Math.max(g.grossMinor, 0), 0);
  if (totalGross <= 0) return null;

  // Resolve each group to its expense account (per-department or the default), aggregating by account.
  const debitByAccount = new Map<string, number>();
  for (const g of run.expenseGroups) {
    if (g.grossMinor <= 0) continue;
    const accountId = g.accountId ?? a.salaryExpenseAccountId;
    if (!accountId) return null; // unmapped department with no tenant-level default → cannot post
    debitByAccount.set(accountId, (debitByAccount.get(accountId) ?? 0) + g.grossMinor);
  }

  // Clamp deductions to gross so a malformed run can never yield an unbalanced voucher (defensive —
  // valid payroll always has deductions ≤ gross).
  const deduction = Math.min(Math.max(run.deductionMinor, 0), totalGross);
  const dedEff = a.deductionsPayableAccountId && deduction > 0 ? deduction : 0;
  const payable = totalGross - dedEff;

  const entries: GlEntry[] = [...debitByAccount].map(([accountId, grossMinor]) => ({ accountId, debitMinor: grossMinor }));
  if (dedEff > 0 && a.deductionsPayableAccountId) {
    entries.push({ accountId: a.deductionsPayableAccountId, creditMinor: dedEff });
  }
  if (payable > 0) entries.push({ accountId: a.salaryPayableAccountId, creditMinor: payable });

  return {
    description: `Payroll ${run.runNo}`,
    voucherType: 'JV',
    occurredOn: run.occurredOn,
    reference: run.runNo,
    entries,
  };
}
