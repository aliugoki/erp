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
export type ControlType = 'NONE' | 'CASH' | 'BANK' | 'PAYABLE' | 'RECEIVABLE';

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  isGroup: boolean;
  controlType: ControlType;
  bankName: string | null;
  accountNumber: string | null;
  /** Foreign denomination for accounts that hold a non-base balance (e.g. USD). Null = base currency. */
  currency: string | null;
  level?: number;
}

export interface FiscalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
}

export interface CashBookRow {
  accountId: string;
  code: string;
  name: string;
  controlType: 'CASH' | 'BANK';
  bankName: string | null;
  accountNumber: string | null;
  opening: Money;
  receipts: Money;
  payments: Money;
  closing: Money;
}
export interface CashBook {
  from: string | null;
  to: string | null;
  accounts: CashBookRow[];
  totals: { receiptsMinor: number; paymentsMinor: number; closingMinor: number };
}

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface CostCenterReport {
  from: string | null;
  to: string | null;
  costCenters: {
    costCenterId: string | null;
    code: string | null;
    name: string;
    revenue: Money;
    expense: Money;
    net: Money;
  }[];
  totals: { revenueMinor: number; expenseMinor: number; netMinor: number };
}

export interface BudgetVsActual {
  period: { id: string; name: string; startDate: string; endDate: string };
  lines: {
    accountId: string;
    code: string;
    name: string;
    type: AccountType;
    budget: Money;
    actual: Money;
    variance: Money;
    variancePct: number | null;
  }[];
  totals: { budgetMinor: number; actualMinor: number; varianceMinor: number };
}

export type VoucherType = 'BRV' | 'BPV' | 'CPV' | 'CRV' | 'JV';
export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  isBase: boolean;
  active: boolean;
}
export interface ExchangeRate {
  id: string;
  currencyCode: string;
  rate: number;
  asOf: string;
}
export interface ConvertResult {
  from: string;
  to: string;
  asOf: string | null;
  amount: Money;
  result: Money;
  fromRate: number;
  toRate: number;
}

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface Recurring {
  id: string;
  description: string;
  voucherType: VoucherType;
  frequency: Frequency;
  nextRunDate: string;
  endDate: string | null;
  active: boolean;
  entries: { accountId: string; debitMinor?: number; creditMinor?: number; costCenterId?: string }[];
}

export interface JournalTxn {
  id: string;
  description: string;
  voucherType: VoucherType;
  voucherNo: string | null;
  status: 'DRAFT' | 'POSTED';
  occurredOn: string;
  reference: string | null;
  reversesId: string | null;
  reversedById: string | null;
  lineCount: number;
  total: Money;
}

export interface Vendor {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
}

export interface CrmClient {
  id: string;
  companyName: string;
}

export interface TxnDetailLine {
  id: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  costCenterCode: string | null;
  debit: Money;
  credit: Money;
}
export interface TxnDetail {
  id: string;
  description: string;
  voucherType: VoucherType;
  voucherNo: string | null;
  status: 'DRAFT' | 'POSTED';
  occurredOn: string;
  reference: string | null;
  entries: TxnDetailLine[];
}

export type BillStatus = 'DRAFT' | 'RECEIVED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export interface Bill {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string | null;
  subtotal: Money;
  tax: Money;
  total: Money;
  paid: Money;
  outstanding: Money;
  status: BillStatus;
  billDate: string | null;
  dueDate: string | null;
}

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
export interface ArAging {
  asOf: string | null;
  buckets: AgingBucketKey[];
  totals: Record<AgingBucketKey | 'total', number>;
  invoices: {
    invoiceId: string;
    number: string;
    clientId: string | null;
    dueDate: string;
    daysPastDue: number;
    bucket: AgingBucketKey;
    amount: Money;
  }[];
}

export interface ApAging {
  asOf: string | null;
  buckets: AgingBucketKey[];
  totals: Record<AgingBucketKey | 'total', number>;
  bills: {
    billId: string;
    number: string;
    vendorId: string;
    vendorName: string | null;
    dueDate: string;
    daysPastDue: number;
    bucket: AgingBucketKey;
    amount: Money;
  }[];
}

export interface ReconEntry {
  entryId: string;
  occurredOn: string;
  voucherNo: string | null;
  description: string;
  debit: Money;
  credit: Money;
  reconciled: boolean;
  reconciledAt: string | null;
}
export interface BankStatementLine {
  id: string;
  date: string;
  description: string | null;
  amount: Money;
  reference: string | null;
  matched: boolean;
}

export interface Reconciliation {
  account: { id: string; code: string; name: string; controlType: 'CASH' | 'BANK'; bankName: string | null; accountNumber: string | null };
  bookBalance: Money;
  clearedBalance: Money;
  unclearedBalance: Money;
  unclearedCount: number;
  entries: ReconEntry[];
}

export interface LedgerLine {
  transactionId: string;
  occurredOn: string;
  description: string;
  voucherType: VoucherType;
  voucherNo: string | null;
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

export interface CashFlowSection {
  lines: { accountId: string; code: string; name: string; amountMinor: number }[];
  totalMinor: number;
}
export interface CashFlow {
  from: string | null;
  to: string | null;
  currency: string;
  opening: Money;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChangeMinor: number;
  closing: Money;
  reconciles: boolean;
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
