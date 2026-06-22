import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AdjustStockDto,
  CreateDrugDto,
  CreateSalesOrderDto,
  CreateWardRequisitionDto,
  DispenseDto,
  ExpiryQueryDto,
  FulfillSalesOrderDto,
  IssueWardRequisitionDto,
  ListDrugsQueryDto,
  ReceiveBatchDto,
  ReturnDispenseDto,
  ReturnToVendorDto,
  SetPharmacyConfigDto,
  SetPharmacyGlConfigDto,
  SetPriceTiersDto,
  UpdateDrugDto,
  WriteOffDto,
  WriteOffExpiredDto,
} from './dto/pharmacy.dto';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockService } from './pharmacy-stock.service';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { PharmacyAdjustmentService } from './pharmacy-adjustment.service';
import { PharmacyWardService } from './pharmacy-ward.service';
import { PharmacySalesOrderService } from './pharmacy-sales-order.service';
import { PharmacyReportsService } from './pharmacy-reports.service';

/** Pharmacists/store keepers operate; tenant admins configure. */
const OPERATE = [Role.INVENTORY_MANAGER, Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;
const ADMIN = [Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Pharmacy Management System — gated by the `pharmacy` feature entitlement (ADR-009). */
@Controller('pharmacy')
@RequiresFeature('pharmacy')
export class PharmacyController {
  constructor(
    private readonly pharmacy: PharmacyService,
    private readonly stock: PharmacyStockService,
    private readonly dispensing: PharmacyDispenseService,
    private readonly adjustments: PharmacyAdjustmentService,
    private readonly ward: PharmacyWardService,
    private readonly salesOrders: PharmacySalesOrderService,
    private readonly reports: PharmacyReportsService,
  ) {}

  // ── Configuration ─────────────────────────────────────────────────────────────
  @Get('config')
  getConfig() {
    return this.pharmacy.getConfig();
  }

  @Put('config')
  @Roles(...ADMIN)
  setConfig(@Body() dto: SetPharmacyConfigDto) {
    return this.pharmacy.setConfig(dto);
  }

  // ── Drug master ───────────────────────────────────────────────────────────────
  @Get('drugs')
  listDrugs(@Query() query: ListDrugsQueryDto) {
    return this.pharmacy.listDrugs(query);
  }

  @Post('drugs')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  createDrug(@Body() dto: CreateDrugDto) {
    return this.pharmacy.createDrug(dto);
  }

  @Get('drugs/:id')
  getDrug(@Param('id', ParseUUIDPipe) id: string) {
    return this.pharmacy.getDrug(id);
  }

  @Patch('drugs/:id')
  @Roles(...OPERATE)
  updateDrug(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDrugDto) {
    return this.pharmacy.updateDrug(id, dto);
  }

  @Delete('drugs/:id')
  @Roles(...OPERATE)
  deleteDrug(@Param('id', ParseUUIDPipe) id: string) {
    return this.pharmacy.deleteDrug(id);
  }

  // ── Stock: batch receipt + lots + FEFO preview ────────────────────────────────
  @Post('stock/receive')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  receiveBatch(@Body() dto: ReceiveBatchDto) {
    return this.stock.receiveBatch(dto);
  }

  @Get('stock/lots')
  listLots(@Query('productId') productId?: string) {
    return this.stock.listLots(productId);
  }

  @Get('stock/fefo')
  fefoPreview(@Query('productId', ParseUUIDPipe) productId: string, @Query('qty', ParseIntPipe) qty: number) {
    return this.stock.fefoPreview(productId, qty);
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  @Get('reports/near-expiry')
  nearExpiry(@Query() query: ExpiryQueryDto) {
    return this.stock.nearExpiry(query.days ?? 90);
  }

  @Get('reports/expired')
  expiredStock() {
    return this.stock.expiredStock();
  }

  // ── Dispensing & sales ────────────────────────────────────────────────────────
  @Post('dispense')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  dispense(@Body() dto: DispenseDto) {
    return this.dispensing.createDispense(dto);
  }

  @Get('dispenses')
  listDispenses(@Query('type') type?: string, @Query('status') status?: string) {
    return this.dispensing.listDispenses({ type, status });
  }

  @Get('dispenses/:id')
  getDispense(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispensing.getDispense(id);
  }

  @Post('dispenses/:id/return')
  @Roles(...OPERATE)
  returnDispense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDispenseDto) {
    return this.dispensing.returnDispense(id, dto);
  }

  // ── GL account map ────────────────────────────────────────────────────────────
  @Get('gl-config')
  getGlConfig() {
    return this.pharmacy.getGlConfig();
  }

  @Put('gl-config')
  @Roles(...ADMIN)
  setGlConfig(@Body() dto: SetPharmacyGlConfigDto) {
    return this.pharmacy.setGlConfig(dto as Record<string, string | undefined>);
  }

  // ── Controlled-substance register ──────────────────────────────────────────────
  @Get('reports/controlled')
  controlledRegister(@Query('productId') productId?: string) {
    return this.dispensing.controlledRegister(productId);
  }

  // ── Stock adjustments (return-to-vendor / write-off / adjust) ───────────────────
  @Post('rtv')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  returnToVendor(@Body() dto: ReturnToVendorDto) {
    return this.adjustments.returnToVendor(dto);
  }

  @Post('write-off')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  writeOff(@Body() dto: WriteOffDto) {
    return this.adjustments.writeOff(dto);
  }

  @Post('write-off-expired')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  writeOffExpired(@Body() dto: WriteOffExpiredDto) {
    return this.adjustments.writeOffExpired(dto);
  }

  @Post('adjust')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  adjust(@Body() dto: AdjustStockDto) {
    return this.adjustments.adjustStock(dto);
  }

  @Get('adjustments')
  listAdjustments(@Query('type') type?: string) {
    return this.adjustments.listAdjustments(type);
  }

  @Get('adjustments/:id')
  getAdjustment(@Param('id', ParseUUIDPipe) id: string) {
    return this.adjustments.getAdjustment(id);
  }

  // ── Quantity-break price tiers (per product) ────────────────────────────────────
  @Get('products/:productId/price-tiers')
  getPriceTiers(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.pharmacy.getPriceTiers(productId);
  }

  @Put('products/:productId/price-tiers')
  @Roles(...OPERATE)
  setPriceTiers(@Param('productId', ParseUUIDPipe) productId: string, @Body() dto: SetPriceTiersDto) {
    return this.pharmacy.setPriceTiers(productId, dto.tiers);
  }

  // ── Hospital: ward requisitions ─────────────────────────────────────────────────
  @Post('ward-requisitions')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  createWardRequisition(@Body() dto: CreateWardRequisitionDto) {
    return this.ward.create(dto);
  }

  @Get('ward-requisitions')
  listWardRequisitions(@Query('status') status?: string) {
    return this.ward.list(status);
  }

  @Get('ward-requisitions/:id')
  getWardRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.ward.get(id);
  }

  @Post('ward-requisitions/:id/submit')
  @Roles(...OPERATE)
  submitWardRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.ward.setStatus(id, 'SUBMITTED');
  }

  @Post('ward-requisitions/:id/approve')
  @Roles(...OPERATE)
  approveWardRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.ward.setStatus(id, 'APPROVED');
  }

  @Post('ward-requisitions/:id/cancel')
  @Roles(...OPERATE)
  cancelWardRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.ward.setStatus(id, 'CANCELLED');
  }

  @Post('ward-requisitions/:id/issue')
  @Roles(...OPERATE)
  issueWardRequisition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueWardRequisitionDto) {
    return this.ward.issue(id, dto);
  }

  // ── Wholesale: B2B sales orders ─────────────────────────────────────────────────
  @Post('sales-orders')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  createSalesOrder(@Body() dto: CreateSalesOrderDto) {
    return this.salesOrders.create(dto);
  }

  @Get('sales-orders')
  listSalesOrders(@Query('status') status?: string) {
    return this.salesOrders.list(status);
  }

  @Get('sales-orders/:id')
  getSalesOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesOrders.get(id);
  }

  @Post('sales-orders/:id/confirm')
  @Roles(...OPERATE)
  confirmSalesOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesOrders.setStatus(id, 'CONFIRMED');
  }

  @Post('sales-orders/:id/cancel')
  @Roles(...OPERATE)
  cancelSalesOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.salesOrders.setStatus(id, 'CANCELLED');
  }

  @Post('sales-orders/:id/fulfill')
  @Roles(...OPERATE)
  fulfillSalesOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FulfillSalesOrderDto) {
    return this.salesOrders.fulfill(id, dto);
  }

  // ── Reports & analytics ─────────────────────────────────────────────────────────
  @Get('reports/dashboard')
  reportDashboard() {
    return this.reports.dashboard();
  }

  @Get('reports/sales')
  reportSales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.sales(from, to);
  }

  @Get('reports/consumption')
  reportConsumption(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return this.reports.consumption(from, to, limit ? Number(limit) : 20);
  }

  @Get('reports/margin')
  reportMargin() {
    return this.reports.margin();
  }

  @Get('reports/abc')
  reportAbc() {
    return this.reports.abc();
  }

  @Get('reports/valuation')
  reportValuation() {
    return this.reports.valuation();
  }

  @Get('reports/expiry-summary')
  reportExpirySummary() {
    return this.reports.expirySummary();
  }
}
