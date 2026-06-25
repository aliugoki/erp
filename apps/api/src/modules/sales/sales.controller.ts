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
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateOrderDto, CreateQuotationDto, UpdateQuotationStatusDto } from './dto/sales.dto';
import { SalesService } from './sales.service';

const WRITE = [Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Sales — quotations & sales orders. Gated by the `sales` feature; writes require a sales rep (or admin). */
@Controller('sales')
@RequiresFeature('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('quotations')
  listQuotations() {
    return this.sales.listQuotations();
  }

  @Post('quotations')
  @Roles(...WRITE)
  @ShadowPermissions('sales:quotation:write')
  @HttpCode(HttpStatus.CREATED)
  createQuotation(@Body() dto: CreateQuotationDto) {
    return this.sales.createQuotation(dto);
  }

  @Get('quotations/:id')
  getQuotation(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getQuotation(id);
  }

  @Patch('quotations/:id/status')
  @Roles(...WRITE)
  @ShadowPermissions('sales:quotation:write')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationStatusDto) {
    return this.sales.setQuotationStatus(id, dto.status);
  }

  @Post('quotations/:id/convert')
  @Roles(...WRITE)
  @ShadowPermissions('sales:quotation:write')
  convert(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.convertToOrder(id);
  }

  @Get('orders')
  listOrders() {
    return this.sales.listOrders();
  }

  @Post('orders')
  @Roles(...WRITE)
  @ShadowPermissions('sales:order:write')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.sales.createOrder(dto);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getOrder(id);
  }

  @Patch('orders/:id/fulfill')
  @Roles(...WRITE)
  @ShadowPermissions('sales:order:write')
  fulfill(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.fulfillOrder(id);
  }

  @Patch('orders/:id/cancel')
  @Roles(...WRITE)
  @ShadowPermissions('sales:order:write')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.cancelOrder(id);
  }
}
