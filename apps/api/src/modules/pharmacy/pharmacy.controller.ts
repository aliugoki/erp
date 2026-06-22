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
  CreateDrugDto,
  ExpiryQueryDto,
  ListDrugsQueryDto,
  ReceiveBatchDto,
  SetPharmacyConfigDto,
  UpdateDrugDto,
} from './dto/pharmacy.dto';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockService } from './pharmacy-stock.service';

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
}
