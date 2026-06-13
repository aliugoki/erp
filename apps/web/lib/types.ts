export interface Money {
  amountMinor: number;
  currency: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  positionId: string | null;
  joinDate: string | null;
  salary: Money | null;
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string | null;
  subtotal: Money;
  tax: Money;
  total: Money;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'VOID';
  dueDate: string | null;
}

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isGroup: boolean;
  level?: number;
}

export interface JournalTxn {
  id: string;
  description: string;
  occurredOn: string;
  reference: string | null;
  lineCount: number;
  total: Money;
}

export interface LedgerLine {
  transactionId: string;
  occurredOn: string;
  description: string;
  reference: string | null;
  debit: Money;
  credit: Money;
  balance: Money;
}
export interface Ledger {
  account: { id: string; code: string; name: string; type: AccountType };
  opening: Money;
  closing: Money;
  lines: LedgerLine[];
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitMinor: number;
  creditMinor: number;
}
export interface TrialBalance {
  asOf: string | null;
  rows: TrialBalanceRow[];
  totals: { debitMinor: number; creditMinor: number };
  balanced: boolean;
}

export interface StatementLine {
  accountId: string;
  code: string;
  name: string;
  amountMinor: number;
}
export interface BalanceSheet {
  asOf: string | null;
  currency: string;
  assets: { lines: StatementLine[]; totalMinor: number };
  liabilities: { lines: StatementLine[]; totalMinor: number };
  equity: { lines: StatementLine[]; netIncomeMinor: number; totalMinor: number };
  totals: { assetsMinor: number; liabilitiesAndEquityMinor: number };
  balanced: boolean;
}
export interface IncomeStatement {
  from: string | null;
  to: string | null;
  currency: string;
  revenue: { lines: StatementLine[]; totalMinor: number };
  expenses: { lines: StatementLine[]; totalMinor: number };
  netIncomeMinor: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  costPrice: Money;
  sellPrice: Money;
  minStock: number;
  onHand: number;
}
