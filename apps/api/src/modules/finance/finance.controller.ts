import {
  Body,
  Controller,
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
  CreateAccountDto,
  CreateInvoiceDto,
  CreateTransactionDto,
  ListInvoicesQueryDto,
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

  // Transactions
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
