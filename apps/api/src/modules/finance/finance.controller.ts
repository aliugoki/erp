import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AsOfQueryDto,
  AutoMatchDto,
  BudgetQueryDto,
  CashBookQueryDto,
  ConvertQueryDto,
  CreateAccountDto,
  ImportStatementDto,
  CreateBillDto,
  CreateBillPaymentDto,
  CreateCostCenterDto,
  CreateCurrencyDto,
  CreateInvoiceDto,
  CreatePeriodDto,
  CreateRecurringDto,
  CreateTransactionDto,
  CreateVendorDto,
  SetBudgetDto,
  SetRateDto,
  LedgerQueryDto,
  ListBillsQueryDto,
  ListInvoicesQueryDto,
  ListTransactionsQueryDto,
  PeriodQueryDto,
  ReconcileDto,
  UpdateAccountDto,
  UpdatePeriodDto,
  YearEndCloseDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

const WRITE = [Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Finance module — gated by the `finance` feature; writes require a finance manager (or admin). */
@Controller('finance')
@RequiresFeature('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // Chart of accounts
  @Get('accounts')
  listAccounts() {
    return this.finance.listAccounts();
  }

  @Post('accounts')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createAccount(@Body() dto: CreateAccountDto) {
    return this.finance.createAccount(dto);
  }

  @Patch('accounts/:id')
  @Roles(...WRITE)
  updateAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.finance.updateAccount(id, dto);
  }

  // Fiscal periods (posting is locked outside an open period)
  @Get('periods')
  listPeriods() {
    return this.finance.listPeriods();
  }

  @Post('periods')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createPeriod(@Body() dto: CreatePeriodDto) {
    return this.finance.createPeriod(dto);
  }

  @Patch('periods/:id')
  @Roles(...WRITE)
  updatePeriod(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePeriodDto) {
    return this.finance.updatePeriod(id, dto);
  }

  @Post('year-end-close')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  yearEndClose(@Body() dto: YearEndCloseDto) {
    return this.finance.yearEndClose(dto);
  }

  // Recurring vouchers
  @Get('recurring')
  listRecurring() {
    return this.finance.listRecurring();
  }

  @Post('recurring')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createRecurring(@Body() dto: CreateRecurringDto) {
    return this.finance.createRecurring(dto);
  }

  @Post('recurring/:id/run')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  runRecurring(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.runRecurring(id);
  }

  @Post('recurring/run-due')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  runDue() {
    return this.finance.runDue();
  }

  // Cash & Bank book
  @Get('cash-book')
  cashBook(@Query() query: CashBookQueryDto) {
    return this.finance.cashBook(query);
  }

  // Accounts-receivable aging
  @Get('ar-aging')
  arAging(@Query() query: AsOfQueryDto) {
    return this.finance.arAging(query);
  }

  // Accounts Payable — vendors, bills, payments
  @Get('vendors')
  listVendors() {
    return this.finance.listVendors();
  }

  @Post('vendors')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createVendor(@Body() dto: CreateVendorDto) {
    return this.finance.createVendor(dto);
  }

  @Get('bills')
  listBills(@Query() query: ListBillsQueryDto) {
    return this.finance.listBills(query);
  }

  @Post('bills')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createBill(@Body() dto: CreateBillDto) {
    return this.finance.createBill(dto);
  }

  @Get('bills/:id')
  getBill(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getBill(id);
  }

  @Post('bills/:id/payments')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  payBill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBillPaymentDto) {
    return this.finance.payBill(id, dto);
  }

  @Get('ap-aging')
  apAging(@Query() query: AsOfQueryDto) {
    return this.finance.apAging(query);
  }

  // Bank reconciliation
  @Get('reconciliation/:accountId')
  reconciliation(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.finance.reconciliation(accountId);
  }

  @Post('reconciliation')
  @Roles(...WRITE)
  setReconciled(@Body() dto: ReconcileDto) {
    return this.finance.setReconciled(dto);
  }

  @Get('bank-statements/:accountId')
  listStatement(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.finance.listStatement(accountId);
  }

  @Post('bank-statements/import')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  importStatement(@Body() dto: ImportStatementDto) {
    return this.finance.importStatement(dto);
  }

  @Post('bank-statements/auto-match')
  @Roles(...WRITE)
  autoMatch(@Body() dto: AutoMatchDto) {
    return this.finance.autoMatch(dto);
  }

  // Transactions (journal entries)
  @Get('transactions')
  listTransactions(@Query() query: ListTransactionsQueryDto) {
    return this.finance.listTransactions(query);
  }

  @Post('transactions')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.finance.createTransaction(dto);
  }

  @Get('transactions/:id')
  getTransaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getTransaction(id);
  }

  @Post('transactions/:id/reverse')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  reverseTransaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.reverseTransaction(id);
  }

  @Post('transactions/:id/post')
  @Roles(...WRITE)
  postTransaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.postTransaction(id);
  }

  @Delete('transactions/:id')
  @Roles(...WRITE)
  deleteDraft(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.deleteDraft(id);
  }

  // General ledger & financial statements (read-only)
  @Get('ledger/:accountId')
  ledger(@Param('accountId', ParseUUIDPipe) accountId: string, @Query() query: LedgerQueryDto) {
    return this.finance.getLedger(accountId, query);
  }

  @Get('trial-balance')
  trialBalance(@Query() query: AsOfQueryDto) {
    return this.finance.getTrialBalance(query);
  }

  @Get('statements/balance-sheet')
  balanceSheet(@Query() query: AsOfQueryDto) {
    return this.finance.getBalanceSheet(query);
  }

  @Get('statements/income')
  incomeStatement(@Query() query: PeriodQueryDto) {
    return this.finance.getIncomeStatement(query);
  }

  @Get('statements/cash-flow')
  cashFlow(@Query() query: PeriodQueryDto) {
    return this.finance.getCashFlow(query);
  }

  // Cost centers (analytical dimension)
  @Get('cost-centers')
  listCostCenters() {
    return this.finance.listCostCenters();
  }

  @Post('cost-centers')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createCostCenter(@Body() dto: CreateCostCenterDto) {
    return this.finance.createCostCenter(dto);
  }

  @Get('reports/cost-center')
  costCenterReport(@Query() query: PeriodQueryDto) {
    return this.finance.costCenterReport(query);
  }

  // Budgets
  @Post('budgets')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  setBudget(@Body() dto: SetBudgetDto) {
    return this.finance.setBudget(dto);
  }

  @Get('reports/budget-vs-actual')
  budgetVsActual(@Query() query: BudgetQueryDto) {
    return this.finance.budgetVsActual(query);
  }

  // Multi-currency
  @Get('currencies')
  listCurrencies() {
    return this.finance.listCurrencies();
  }

  @Post('currencies')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createCurrency(@Body() dto: CreateCurrencyDto) {
    return this.finance.createCurrency(dto);
  }

  @Get('exchange-rates')
  listRates() {
    return this.finance.listRates();
  }

  @Post('exchange-rates')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  setRate(@Body() dto: SetRateDto) {
    return this.finance.setRate(dto);
  }

  @Get('convert')
  convert(@Query() query: ConvertQueryDto) {
    return this.finance.convert(query);
  }

  // Invoices
  @Get('invoices')
  listInvoices(@Query() query: ListInvoicesQueryDto) {
    return this.finance.listInvoices(query);
  }

  @Post('invoices')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createInvoice(@Body() dto: CreateInvoiceDto) {
    return this.finance.createInvoice(dto);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getInvoice(id);
  }

  @Patch('invoices/:id/pay')
  @Roles(...WRITE)
  payInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.payInvoice(id);
  }
}
