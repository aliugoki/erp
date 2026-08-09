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
  branchId: string | null;
  joinDate: string | null;
  salary: Money | null;
  status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
}

// ── Enterprise HR (HCM) ───────────────────────────────────────────────────────
export interface LeaveType {
  id: string;
  name: string;
  code: string | null;
  daysPerYear: number;
  paid: boolean;
  color: string | null;
}

export interface LeaveRequest {
  id: string;
  leaveNo: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  approverId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  employeeName?: string | null;
  typeName?: string | null;
}

export interface SalaryComponent {
  id: string;
  name: string;
  code: string;
  type: string;
  calc: string;
  valueMinor: number;
  percent: number;
  active: boolean;
}

export interface PayrollRun {
  id: string;
  runNo: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  employeeCount: number;
  workingDays: number;
  totalGross: Money;
  totalDeduction: Money;
  totalNet: Money;
  runAt: string | null;
  journalId: string | null;
  journalVoucherNo: string | null;
}

export interface DepartmentSalaryAccount {
  departmentId: string;
  departmentName: string;
  salaryExpenseAccountId: string | null;
}

export interface Payslip {
  id: string;
  payslipNo: string;
  runId: string;
  employeeId: string;
  basic: Money;
  gross: Money;
  deduction: Money;
  net: Money;
  workingDays?: number | null;
  payableDays?: number | null;
  employeeName?: string | null;
  employeeCode?: string | null;
  lines?: { code: string; name: string; type: string; amountMinor: number }[];
}

// ── Employee profile / attendance / policy ────────────────────────────────────
export interface EmployeeEducation {
  id: string;
  degree: string;
  institution: string | null;
  fieldOfStudy: string | null;
  startYear: number | null;
  endYear: number | null;
  grade: string | null;
}

export interface EmployeeExperience {
  id: string;
  company: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface EmployeeProfile {
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
  status: string;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  nationalId: string | null;
  bloodGroup: string | null;
  nationality: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  designation: string | null;
  employmentType: string | null;
  reportingTo: string | null;
  confirmationDate: string | null;
  workLocation: string | null;
  branchId: string | null;
  education: EmployeeEducation[];
  experience: EmployeeExperience[];
}

export interface AttendanceDayRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  status: string | null;
  late: boolean;
  checkIn: string | null;
  checkOut: string | null;
}

export interface Branch {
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

export interface Department {
  id: string;
  name: string;
  managerId: string | null;
  parentDepartmentId: string | null;
  branchId: string | null;
}
export interface Designation {
  id: string;
  name: string;
  description: string | null;
}

export interface ExpenseClaimLine {
  description: string;
  amountMinor: number;
  expenseAccountId: string | null;
}
export interface ExpenseClaim {
  id: string;
  claimNo: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  claimDate: string | null;
  title: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
  total: Money;
  branchId: string | null;
  branchName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  lines: ExpenseClaimLine[];
  decisionNote: string | null;
  journalId: string | null;
  journalVoucherNo: string | null;
  paidOn: string | null;
}

// ── AI Insights ───────────────────────────────────────────────────────────────
export interface AiSummary {
  nextMonthSales: Money;
  hotLeads: number;
  reorderProducts: number;
  atRiskEmployees: number;
}
export interface SalesForecast {
  currency: string;
  history: { month: string; valueMinor: number }[];
  forecastMinor: number[];
}
export interface LeadScore {
  id: string;
  name: string;
  company: string | null;
  rating: string;
  estValue: Money;
  score: number;
  band: string;
}
export interface InventoryDemand {
  id: string;
  sku: string;
  name: string;
  onHand: number;
  avgDailyDemand: number;
  forecast30: number;
  daysToStockout: number | null;
  reorder: boolean;
}
export interface AttritionRisk {
  employeeId: string;
  employeeName: string;
  tenureDays: number;
  absenceRatePct: number;
  score: number;
  band: string;
}
export interface AnomalyReport {
  series: { month: string; valueMinor: number }[];
  anomalies: { index: number; value: number; z: number; month: string }[];
}

// ── Report builder ──────────────────────────────────────────────────────────────
export interface ReportDataset {
  key: string;
  label: string;
  columns: { key: string; label: string; money: boolean }[];
  filterable: string[];
  groupable: string[];
  aggregatable: string[];
}
export interface ReportPreset {
  key: string;
  name: string;
  source: string;
}
export interface ReportResult {
  columns: { key: string; label: string; money?: boolean }[];
  rows: Record<string, unknown>[];
}
export interface SavedReport {
  id: string;
  name: string;
  source: string;
  columns: string[];
  filters: { column: string; value: string }[];
  groupBy: string | null;
}

export interface FbrConfig {
  sellerNtn: string;
  sellerName: string;
  posId: string;
  environment: 'sandbox' | 'production';
  enabled: boolean;
  hasToken: boolean;
}
export interface FbrInvoice {
  id: string;
  sourceId: string;
  invoiceRef: string;
  fbrInvoiceNumber: string | null;
  qr: string | null;
  status: 'PENDING' | 'REPORTED' | 'FAILED';
  environment: string | null;
  amountMinor: number;
  error: string | null;
  reportedAt: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  traceId: string | null;
  createdAt: string;
}

export interface ReportSchedule {
  id: string;
  name: string;
  presetKey: string | null;
  reportId: string | null;
  format: 'pdf' | 'xlsx' | 'csv';
  recipients: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
}

// ── BI analytics dashboard ───────────────────────────────────────────────────────
export interface AnalyticsKpi {
  key: string;
  label: string;
  value: number;
  money: boolean;
  currency?: string;
  deltaPct?: number | null;
  subtitle?: string;
  trend?: number[];
}
export interface AnalyticsDashboard {
  currency: string;
  kpis: AnalyticsKpi[];
  revenueSeries: { period: string; revenue: number; expense: number; profit: number }[];
  pipeline: { stage: string; count: number; value: number }[];
  inventoryByCategory: { category: string; value: number }[];
  headcountByDept: { department: string; headcount: number }[];
}

export interface AttendanceSummaryRow {
  employeeId: string;
  employeeName: string;
  present: number;
  halfDay: number;
  leave: number;
  absent: number;
  payableDays: number;
}

export interface CustomField {
  id: string;
  entity: string;
  label: string;
  fieldKey: string;
  fieldType: string;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
}

export interface Policy {
  id: string;
  name: string;
  category: string;
  description: string | null;
  effectiveDate: string | null;
  status: string;
  version: number;
  fields?: { fieldId: string; label: string; fieldKey: string; fieldType: string; value: string | null }[];
}

export interface PerformanceReview {
  id: string;
  reviewNo: string;
  employeeId: string;
  period: string;
  reviewerId: string | null;
  rating: number | null;
  strengths: string | null;
  improvements: string | null;
  status: string;
  submittedAt: string | null;
  employeeName?: string | null;
}

export interface Goal {
  id: string;
  employeeId: string;
  title: string;
  description: string | null;
  targetDate: string | null;
  status: string;
  progress: number;
}

export interface HeadcountReport {
  total: number;
  byDepartment: { department: string; count: number }[];
  byStatus: { status: string; count: number }[];
}

export interface PayrollSummary {
  latest: PayrollRun | null;
  byComponent: { name: string; type: string; totalMinor: number }[];
}

export interface LeaveSummary {
  pendingCount: number;
  byType: { name: string; approvedDays: number; approvedCount: number }[];
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string | null;
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
/** A billable customer (AR subsidiary) — mirrors Vendor; carries its own RECEIVABLE ledger account. */
export interface Customer {
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

// ── Sales (quote-to-order) ────────────────────────────────────────────────────
export interface SalesLine {
  id?: string;
  productId: string | null;
  description: string;
  quantity: number;
  deliveredQty?: number;
  unitPrice: Money;
  lineTotal: Money;
}
export interface Quotation {
  id: string;
  quoteNo: string;
  clientId: string;
  dealId: string | null;
  status: string;
  validUntil: string | null;
  taxRate: number;
  subtotal: Money;
  tax: Money;
  total: Money;
  notes: string | null;
  lines?: SalesLine[];
}
export interface SalesOrder {
  id: string;
  soNo: string;
  clientId: string;
  quotationId: string | null;
  status: string;
  orderDate: string | null;
  expectedDate: string | null;
  total: Money;
  notes: string | null;
  lines?: SalesLine[];
}

// ── Point of Sale ─────────────────────────────────────────────────────────────
export interface PosRegister {
  id: string;
  name: string;
  code: string | null;
  warehouseId: string | null;
  branchId: string | null;
  location: string | null;
  status: string;
  currency: string;
  cardTerminalProvider: string;
  cardTerminalUrl: string | null;
}
export interface TerminalChargeResult {
  status: 'APPROVED' | 'DECLINED' | 'ERROR';
  reference: string | null;
  scheme: string | null;
  last4: string | null;
  message: string | null;
}
export interface PosShiftReport {
  saleCount: number;
  returnCount: number;
  grossSalesMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  cashSalesMinor: number;
  changeGivenMinor: number;
  cashRefundsMinor: number;
  tenders: { method: string; inMinor: number; outMinor: number }[];
}
export interface PosShift {
  id: string;
  shiftNo: string;
  registerId: string;
  cashierId: string | null;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  openingFloat: Money;
  countedCash: Money | null;
  expectedCash: Money | null;
  variance: Money | null;
  notes: string | null;
  report?: PosShiftReport;
}
export interface PosSaleLine {
  id?: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: Money;
  discount: Money;
  taxRate: number;
  tax: Money;
  lineTotal: Money;
  returnedQty: number;
}
export interface PosPayment {
  id?: string;
  method: string;
  amount: Money;
  reference: string | null;
  cardScheme?: string | null;
  cardLast4?: string | null;
  paidAt: string | null;
}
export interface PosSale {
  id: string;
  saleNo: string;
  registerId: string;
  shiftId: string;
  clientId: string | null;
  customerName: string | null;
  type: string;
  originalSaleId: string | null;
  status: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  paid: Money;
  change: Money;
  cogs: Money;
  refunded: Money;
  soldAt: string | null;
  notes: string | null;
  lines?: PosSaleLine[];
  payments?: PosPayment[];
}
export interface PosBranding {
  storeName: string | null;
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
  hasLogo: boolean;
}
export interface PosDailySummary {
  date: string | null;
  saleCount: number;
  returnCount: number;
  grossSalesMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossMarginMinor: number;
  tenders: { method: string; amountMinor: number }[];
}

// ── Manufacturing / Production ────────────────────────────────────────────────
export interface WorkCenter {
  id: string;
  name: string;
  code: string | null;
  costPerHour: Money;
  status: string;
  notes: string | null;
}
export interface BomLine {
  id?: string;
  componentProductId: string;
  componentName?: string | null;
  quantity: number;
  scrapPct: number;
  componentCost?: Money;
  notes?: string | null;
}
export interface BomOperation {
  id?: string;
  workCenterId: string | null;
  workCenterName?: string | null;
  sequence: number;
  name: string;
  runMinutes: number;
  notes?: string | null;
}
export interface Bom {
  id: string;
  bomNo: string;
  productId: string;
  productName?: string | null;
  name: string;
  outputQty: number;
  version: number;
  status: string;
  overheadPct: number;
  notes: string | null;
  lines?: BomLine[];
  operations?: BomOperation[];
}
export interface ProductionAttribute {
  id: string;
  attrKey: string;
  label: string;
  dataType: string;
  options: string | null;
  required: boolean;
  sort: number;
}
export interface OrderMaterial {
  id: string;
  componentProductId: string;
  componentName: string | null;
  requiredQty: number;
  issuedQty: number;
  onHand?: number;
  unitCost: Money;
  cost: Money;
}
export interface OrderOperation {
  id: string;
  workCenterId: string | null;
  workCenterName: string | null;
  sequence: number;
  name: string;
  plannedMinutes: number;
  actualMinutes: number;
  cost: Money;
  status: string;
}
export interface OrderAttribute {
  attributeId: string;
  attrKey: string;
  label: string;
  dataType: string;
  options: string | null;
  required: boolean;
  value: string | null;
}
export interface ProductionOrder {
  id: string;
  orderNo: string;
  productId: string;
  productName: string | null;
  bomId: string | null;
  warehouseId: string | null;
  plannedQty: number;
  producedQty: number;
  status: string;
  priority: string;
  overheadPct: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  materialCost: Money;
  operationCost: Money;
  overhead: Money;
  totalCost: Money;
  unitCost: Money;
  notes: string | null;
  materials?: OrderMaterial[];
  operations?: OrderOperation[];
  attributes?: OrderAttribute[];
}
export interface ProductionOutputRow {
  productId: string;
  productName: string | null;
  orders: number;
  producedQty: number;
  totalCost: Money;
}
export interface MaterialShortage {
  componentProductId: string;
  componentName: string | null;
  needed: number;
  onHand: number;
  shortBy: number;
}

// ── Enterprise CRM ────────────────────────────────────────────────────────────
export interface CrmAccount {
  id: string;
  accountNo: string | null;
  companyName: string;
  industry: string | null;
  website: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  ownerId: string | null;
  annualRevenueMinor: number | string | null;
}

export interface CrmContact {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface Deal {
  id: string;
  clientId: string;
  title: string;
  value: Money;
  stage: string;
  expectedCloseDate: string | null;
  assignedTo: string | null;
  probability: number;
  ownerId: string | null;
  source: string | null;
  weighted: Money;
}

export interface PipelineStage {
  stage: string;
  count: number;
  total: Money;
  weighted: Money;
}

export interface Lead {
  id: string;
  leadNo: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  rating: string;
  estValue: Money;
  ownerId: string | null;
  notes: string | null;
  convertedClientId: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
}

export interface Activity {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completed: boolean;
  completedAt: string | null;
  clientId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  ownerId: string | null;
  outcome: string | null;
  createdAt: string | null;
}

export interface ForecastReport {
  stages: { stage: string; count: number; total: Money; weighted: Money }[];
  openTotal: Money;
  weightedTotal: Money;
}

export interface WinLossReport {
  won: { count: number; value: Money };
  lost: { count: number; value: Money };
  winRate: number;
}

export interface SalesByOwnerRow {
  ownerId: string | null;
  wonCount: number;
  wonValue: Money;
}

export interface LeadFunnelRow {
  status: string;
  count: number;
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
  /** Scannable code on the packaging — null until recorded or minted. */
  barcode: string | null;
  name: string;
  category: string | null;
  unit: string;
  costPrice: Money;
  sellPrice: Money;
  minStock: number;
  onHand: number;
  categoryId: string | null;
  /** Names from the top of the category tree down to the product's category. */
  categoryPath: string[];
  primaryImageId?: string | null;
  imageCount?: number;
}

export interface ProductImage {
  id: string;
  attachmentId: string;
  sort: number;
  isPrimary: boolean;
  contentType: string;
  byteSize: number;
  fileName: string | null;
}

// ── Inventory: product categories (3-level tree) ─────────────────────────────
export interface Category {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  level: number;
  childCount: number;
  productCount: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

// ── Inventory: enterprise documents ──────────────────────────────────────────
export interface StockReportLine {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  onHand: number;
  minStock: number;
  unitCost: Money;
  value: Money;
  belowReorder: boolean;
}
export interface StockReport {
  lines: StockReportLine[];
  totals: { items: number; value: Money };
}
export interface ReorderLine {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  minStock: number;
  suggestedQty: number;
}
export interface LedgerEntry {
  id: string;
  docType: string;
  docNo: string | null;
  qtyIn: number;
  qtyOut: number;
  unitCost: Money;
  balanceQty: number;
  balanceValue: Money;
  occurredOn: string | null;
  narration: string | null;
}
export interface Requisition {
  id: string;
  req_no: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'ISSUED' | 'CANCELLED';
  requested_by: string | null;
  department: string | null;
  needed_by: string | null;
  warehouse: string | null;
  item_count: number;
}
export interface PurchaseOrder {
  id: string;
  po_no: string;
  status: 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  currency: string;
  total_minor: number;
  expected_on: string | null;
  vendor: string | null;
  ordered_qty: number;
  received_qty: number;
}
export interface GatePass {
  id: string;
  gp_no: string;
  direction: 'INWARD' | 'OUTWARD';
  returnable: boolean;
  party: string | null;
  vehicle_no: string | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  issued_on: string | null;
  item_count: number;
}

export interface GrnRow {
  id: string; grn_no: string; status: string; received_on: string | null;
  po_no: string | null; vendor: string | null; warehouse: string | null; qty: number; value_minor: number;
}
export interface IssueRow {
  id: string; issue_no: string; status: string; issued_on: string | null;
  issued_to: string | null; department: string | null; req_no: string | null; warehouse: string | null; qty: number; value_minor: number;
}
export interface MrnRow {
  id: string; mrn_no: string; status: string; returned_on: string | null;
  returned_by: string | null; issue_no: string | null; warehouse: string | null; qty: number; value_minor: number;
}

// ── Notifications ─────────────────────────────────────────────────────────────
export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  severity: NotificationSeverity;
  category: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
}
export interface NotificationPreference {
  category: string;
  inApp: boolean;
  email: boolean;
}

// ── Fixed Assets ──────────────────────────────────────────────────────────────
export interface AssetCategory {
  id: string;
  name: string;
  code: string | null;
  method: string;
  usefulLifeMonths: number;
  salvagePct: number;
  status: string;
}
export interface AssetDepreciationEntry {
  id: string;
  period: string | null;
  amount: Money;
  accumulatedAfter: Money;
  bookValueAfter: Money;
  method: string;
}
export interface AssetMaintenance {
  id: string;
  assetId: string;
  assetName?: string | null;
  maintDate: string | null;
  type: string;
  description: string | null;
  cost: Money;
  vendor: string | null;
  nextDueDate: string | null;
}
export interface Asset {
  id: string;
  assetNo: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  status: string;
  acquisitionDate: string | null;
  acquisitionCost: Money;
  salvageValue: Money;
  usefulLifeMonths: number;
  method: string;
  depreciationStart: string | null;
  accumulatedDepreciation: Money;
  bookValue: Money;
  location: string | null;
  branchId: string | null;
  branchName: string | null;
  custodianEmployeeId: string | null;
  custodianName: string | null;
  serialNo: string | null;
  supplier: string | null;
  disposalDate: string | null;
  disposalProceeds: Money | null;
  disposalGain: Money | null;
  notes: string | null;
  depreciation?: AssetDepreciationEntry[];
  maintenance?: AssetMaintenance[];
}
export interface AssetDepreciationRun {
  id: string;
  runNo: string;
  period: string | null;
  status: string;
  assetCount: number;
  total: Money;
  notes: string | null;
}
export interface AssetScheduleRow {
  period: number;
  amount: Money;
  accumulated: Money;
  bookValue: Money;
}
export interface AssetRegisterRow {
  category: string;
  count: number;
  cost: Money;
  accumulated: Money;
  bookValue: Money;
}

export interface AssetGlConfig {
  expenseAccountId: string | null;
  accumulatedAccountId: string | null;
}

// ── Projects & Timesheets ─────────────────────────────────────────────────────
export interface ProjectMember {
  id: string;
  employeeId: string;
  employeeName: string | null;
  role: string | null;
  costRate: Money;
  billRate: Money;
}
export interface ProjectTask {
  id: string;
  projectId: string;
  name: string;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  status: string;
  priority: string;
  estimateMinutes: number;
  dueDate: string | null;
  sort: number;
  description: string | null;
}
export interface ProjectTimeEntry {
  id: string;
  projectId: string;
  taskId: string | null;
  employeeId: string;
  employeeName: string | null;
  entryDate: string | null;
  minutes: number;
  billable: boolean;
  status: string;
  cost: Money;
  bill: Money;
  description: string | null;
}
export interface ProjectExpense {
  id: string;
  projectId: string;
  expenseDate: string | null;
  category: string | null;
  amount: Money;
  billable: boolean;
  employeeId: string | null;
  description: string | null;
}
export interface ProjectCosting {
  budget: Money;
  laborCost: Money;
  expenseCost: Money;
  totalCost: Money;
  billable: Money;
  remaining: Money;
  hours: number;
}
export interface Project {
  id: string;
  projectNo: string;
  name: string;
  code: string | null;
  clientId: string | null;
  clientName: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  status: string;
  billingType: string;
  startDate: string | null;
  endDate: string | null;
  budget: Money;
  description: string | null;
  members?: ProjectMember[];
  tasks?: ProjectTask[];
  costing?: ProjectCosting;
}
export interface PortfolioRow {
  id: string;
  projectNo: string;
  name: string;
  status: string;
  budget: Money;
  cost: Money;
  billable: Money;
  remaining: Money;
  hours: number;
}
export interface TimesheetRow {
  employeeId: string;
  employeeName: string | null;
  hours: number;
  cost: Money;
  billable: Money;
}

// ── Ecommerce (admin) ───────────────────────────────────────────────────────────
export interface EcStore {
  configured: boolean;
  storefrontSlug: string | null;
  name?: string;
  tagline?: string | null;
  description?: string | null;
  currency?: string;
  accentColor?: string;
  hasLogo?: boolean;
  hasHero?: boolean;
  heroHeadline?: string | null;
  heroSubtext?: string | null;
  supportEmail?: string | null;
  supportPhone?: string | null;
  address?: string | null;
  defaultTaxRate?: number;
  shippingFlat?: Money;
  freeShippingOver?: Money | null;
  published?: boolean;
}

export interface EcCollection {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sort: number;
  isFeatured: boolean;
  productCount?: number;
}

export interface EcProduct {
  id: string;
  productId: string | null;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status: string;
  isFeatured: boolean;
  sort: number;
  taxRate: number;
  price: Money;
  compareAt: Money | null;
  sku: string | null;
  onHand: number | null;
  primaryImageId: string | null;
  imageCount?: number;
  collectionIds?: string[];
  variants?: EcVariant[];
}

export interface EcProductImage {
  id: string;
  attachmentId: string;
  sort: number;
  isPrimary: boolean;
}

export interface EcVariant {
  id: string;
  productId: string;
  inventoryProductId: string;
  label: string;
  status: string;
  sort: number;
  isDefault: boolean;
  price: Money;
  compareAt: Money | null;
  sku: string | null;
  onHand: number | null;
}

export interface EcReview {
  id: string;
  productId: string;
  productTitle: string | null;
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  verified: boolean;
  createdAt: string | null;
}

export interface EcShippingZone {
  id: string;
  name: string;
  countries: string[];
  rate: Money;
  freeOver: Money | null;
  sort: number;
  enabled: boolean;
}

export interface EcDiscount {
  id: string;
  code: string;
  type: string;
  value: number;
  active: boolean;
  minSubtotalMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
}

export interface EcOrderLine {
  id: string;
  productId: string | null;
  title: string;
  quantity: number;
  unitPrice: Money;
  tax: Money;
  lineTotal: Money;
}

export interface EcOrder {
  id: string;
  orderNo: string;
  clientId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  shipping: Money;
  total: Money;
  cogs: Money;
  discountCode: string | null;
  placedAt: string | null;
  createdAt: string | null;
  lines?: EcOrderLine[];
}

// ── Help Desk ───────────────────────────────────────────────────────────────────
export interface HdMessage {
  id: string;
  ticketId: string;
  authorType: 'AGENT' | 'CUSTOMER' | 'SYSTEM';
  authorId: string | null;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: string | null;
}

export interface HdTicket {
  id: string;
  ticketNo: string;
  subject: string;
  requesterName: string;
  requesterEmail: string;
  clientId: string | null;
  orderId: string | null;
  channel: string;
  category: string | null;
  priority: string;
  status: string;
  assignedTo: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamName: string | null;
  tags: string[];
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  slaPaused: boolean;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  reopenedCount: number;
  csatRating: number | null;
  csatComment: string | null;
  messageCount?: number;
  lastActivityAt: string | null;
  createdAt: string | null;
  messages?: HdMessage[];
}

export interface HdTeam { id: string; name: string; description: string | null; memberCount?: number; memberIds?: string[]; }
export interface HdSlaPolicy { id: string; priority: string; firstResponseMins: number; resolutionMins: number; active: boolean; }
export interface HdCannedResponse { id: string; title: string; body: string; }
export interface HdAgent { id: string; email: string; }
export interface HdOverview { byStatus: Record<string, number>; open: number; unassigned: number; breached: number; csatAvg: number | null; csatCount: number; }

// ── Subscriptions & recurring billing ────────────────────────────────────────────
export interface SubPlan {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  price: Money;
  taxRate: number;
  billingInterval: string;
  intervalCount: number;
  trialDays: number;
  setupFee: Money;
  status: string;
  activeSubscriptions?: number;
}

export interface SubInvoice {
  id: string;
  invoiceNo: string;
  subscriptionId: string;
  subscriptionNo: string | null;
  clientId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amount: Money;
  tax: Money;
  total: Money;
  status: string;
  dueDate: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  attemptCount: number;
  paymentRef: string | null;
}

export interface Subscription {
  id: string;
  subscriptionNo: string;
  planId: string;
  planName: string | null;
  clientId: string | null;
  customerName: string;
  customerEmail: string;
  quantity: number;
  collectionMode: string;
  status: string;
  amount: Money;
  taxRate: number;
  billingInterval: string;
  intervalCount: number;
  startDate: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  failedAttempts: number;
  mrr: Money;
  invoiceCount?: number;
  createdAt: string | null;
  invoices?: SubInvoice[];
}

export interface SubMetrics {
  mrr: Money;
  arr: Money;
  active: number;
  trialing: number;
  pastDue: number;
  churned30: number;
  churnRate: number;
  byPlan: { name: string; count: number; mrr: Money }[];
}

export interface SubGlConfig {
  clearingAccountId: string | null;
  revenueAccountId: string | null;
  taxAccountId: string | null;
}
