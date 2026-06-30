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

export interface PayrollRunFigures {
  runNo: string;
  grossMinor: number;
  deductionMinor: number;
  netMinor: number;
  occurredOn: string;
}

/**
 * Build the GL voucher for an approved payroll run:
 *   Dr salary expense (gross)
 *   Cr deductions payable (deductions)  — only when a deductions account is set and there are deductions
 *   Cr salaries payable / net pay       — the remainder (gross − deductions credited)
 * Returns null when the minimum accounts (expense + payable) aren't set or the gross is zero, so the
 * caller skips posting. Always balanced: Σ debit = gross = Σ credit. When no deductions account is
 * configured the deductions are folded into the salaries-payable credit, keeping the voucher balanced.
 */
export function payrollRunVoucher(a: HrPayrollGlAccounts, run: PayrollRunFigures): GlVoucher | null {
  if (!a.salaryExpenseAccountId || !a.salaryPayableAccountId || run.grossMinor <= 0) return null;

  // Clamp deductions to gross so a malformed run can never yield an unbalanced voucher (defensive —
  // valid payroll always has deductions ≤ gross).
  const deduction = Math.min(Math.max(run.deductionMinor, 0), run.grossMinor);
  const dedEff = a.deductionsPayableAccountId && deduction > 0 ? deduction : 0;
  const payable = run.grossMinor - dedEff;

  const entries: GlEntry[] = [{ accountId: a.salaryExpenseAccountId, debitMinor: run.grossMinor }];
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
