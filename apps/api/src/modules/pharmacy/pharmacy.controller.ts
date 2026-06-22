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
  DispenseDto,
  ExpiryQueryDto,
  ListDrugsQueryDto,
  ReceiveBatchDto,
  ReturnDispenseDto,
  ReturnToVendorDto,
  SetPharmacyConfigDto,
  SetPharmacyGlConfigDto,
  UpdateDrugDto,
  WriteOffDto,
  WriteOffExpiredDto,
} from './dto/pharmacy.dto';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockService } from './pharmacy-stock.service';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { PharmacyAdjustmentService } from './pharmacy-adjustment.service';

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
}
