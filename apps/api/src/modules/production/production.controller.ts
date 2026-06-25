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
import { Permissions } from '../auth/decorators/permissions.decorator';
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
  @Permissions('production:write')
  @HttpCode(HttpStatus.CREATED)
  createWorkCenter(@Body() dto: CreateWorkCenterDto) {
    return this.production.createWorkCenter(dto);
  }

  @Patch('work-centers/:id')
  @Permissions('production:write')
  updateWorkCenter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkCenterDto) {
    return this.production.updateWorkCenter(id, dto);
  }

  @Delete('work-centers/:id')
  @Permissions('production:write')
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
  @Permissions('production:write')
  @HttpCode(HttpStatus.CREATED)
  createBom(@Body() dto: CreateBomDto) {
    return this.production.createBom(dto);
  }

  @Get('boms/:id')
  getBom(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.getBom(id);
  }

  @Patch('boms/:id')
  @Permissions('production:write')
  updateBom(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBomDto) {
    return this.production.updateBom(id, dto);
  }

  @Patch('boms/:id/status')
  @Permissions('production:write')
  setBomStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BomStatusDto) {
    return this.production.setBomStatus(id, dto.status);
  }

  @Delete('boms/:id')
  @Permissions('production:write')
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
  @Permissions('production:write')
  @HttpCode(HttpStatus.CREATED)
  createAttribute(@Body() dto: CreateAttributeDto) {
    return this.production.createAttribute(dto);
  }

  @Delete('attributes/:id')
  @Permissions('production:write')
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
  @Permissions('production:write')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.production.createOrder(dto);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.getOrder(id);
  }

  @Patch('orders/:id')
  @Permissions('production:write')
  updateOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.production.updateOrder(id, dto);
  }

  @Post('orders/:id/plan')
  @Permissions('production:write')
  @HttpCode(HttpStatus.OK)
  plan(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.setStatus(id, 'PLANNED');
  }

  @Post('orders/:id/release')
  @Permissions('production:write')
  @HttpCode(HttpStatus.OK)
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.production.setStatus(id, 'RELEASED');
  }

  @Post('orders/:id/issue')
  @Permissions('production:write')
  @HttpCode(HttpStatus.OK)
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueMaterialsDto) {
    return this.production.issueMaterials(id, dto);
  }

  @Post('orders/:id/complete')
  @Permissions('production:write')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteOrderDto) {
    return this.production.completeOrder(id, dto);
  }

  @Post('orders/:id/cancel')
  @Permissions('production:write')
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
  @Permissions('production:glconfig:read')
  getGlConfig() {
    return this.production.getGlConfig();
  }

  @Put('gl-config')
  @Permissions('production:glconfig:write')
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetProductionGlConfigDto) {
    return this.production.setGlConfig(dto);
  }
}
