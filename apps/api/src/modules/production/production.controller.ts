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
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  BomStatusDto,
  CompleteOrderDto,
  CreateAttributeDto,
  CreateBomDto,
  CreateOrderDto,
  CreateWorkCenterDto,
  IssueMaterialsDto,
  SetProductionGlConfigDto,
  UpdateBomDto,
  UpdateOrderDto,
  UpdateWorkCenterDto,
} from './dto/production.dto';
import { ProductionService } from './production.service';

/** Production writes require an inventory manager (manufacturing drives stock) or an admin. */
const WRITE = [Role.INVENTORY_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Manufacturing — gated by the `production` feature entitlement. */
@Controller('production')
@RequiresFeature('production')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  // ── Work centers ────────────────────────────────────────────────────────────
  @Get('work-centers')
  listWorkCenters() {
    return this.production.listWorkCenters();
  }

  @Post('work-centers')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createWorkCenter(@Body() dto: CreateWorkCenterDto) {
    return this.production.createWorkCenter(dto);
  }

  @Patch('work-centers/:id')
  @Roles(...WRITE)
  updateWorkCenter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkCenterDto) {
    return this.production.updateWorkCenter(id, dto);
  }

  @Delete('work-centers/:id')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteWorkCenter(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.deleteWorkCenter(id);
  }

  // ── BOMs ──────────────────────────────────────────────────────────────────────
  @Get('boms')
  listBoms() {
    return this.production.listBoms();
  }

  @Post('boms')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createBom(@Body() dto: CreateBomDto) {
    return this.production.createBom(dto);
  }

  @Get('boms/:id')
  getBom(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.getBom(id);
  }

  @Patch('boms/:id')
  @Roles(...WRITE)
  updateBom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBomDto) {
    return this.production.updateBom(id, dto);
  }

  @Patch('boms/:id/status')
  @Roles(...WRITE)
  setBomStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BomStatusDto) {
    return this.production.setBomStatus(id, dto.status);
  }

  @Delete('boms/:id')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBom(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.deleteBom(id);
  }

  // ── Custom attributes ───────────────────────────────────────────────────────
  @Get('attributes')
  listAttributes() {
    return this.production.listAttributes();
  }

  @Post('attributes')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createAttribute(@Body() dto: CreateAttributeDto) {
    return this.production.createAttribute(dto);
  }

  @Delete('attributes/:id')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAttribute(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.deleteAttribute(id);
  }

  // ── Production orders ───────────────────────────────────────────────────────
  @Get('orders')
  listOrders(@Query('status') status?: string) {
    return this.production.listOrders(status);
  }

  @Post('orders')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.production.createOrder(dto);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.getOrder(id);
  }

  @Patch('orders/:id')
  @Roles(...WRITE)
  updateOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.production.updateOrder(id, dto);
  }

  @Post('orders/:id/plan')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  plan(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.setStatus(id, 'PLANNED');
  }

  @Post('orders/:id/release')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.setStatus(id, 'RELEASED');
  }

  @Post('orders/:id/issue')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueMaterialsDto) {
    return this.production.issueMaterials(id, dto);
  }

  @Post('orders/:id/complete')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteOrderDto) {
    return this.production.completeOrder(id, dto);
  }

  @Post('orders/:id/cancel')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.cancelOrder(id);
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  @Get('reports/wip')
  wip() {
    return this.production.wipReport();
  }

  @Get('reports/output')
  output() {
    return this.production.outputReport();
  }

  @Get('reports/shortages')
  shortages() {
    return this.production.materialShortages();
  }

  // ── GL posting config ───────────────────────────────────────────────────────
  @Get('gl-config')
  @Roles(Role.FINANCE_MANAGER, Role.INVENTORY_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  getGlConfig() {
    return this.production.getGlConfig();
  }

  @Put('gl-config')
  @Roles(Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetProductionGlConfigDto) {
    return this.production.setGlConfig(dto);
  }
}
