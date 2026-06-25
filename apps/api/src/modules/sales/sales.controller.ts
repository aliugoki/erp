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
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateOrderDto, CreateQuotationDto, UpdateQuotationStatusDto } from './dto/sales.dto';
import { SalesService } from './sales.service';


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
  @Permissions('sales:quotation:write')
  @HttpCode(HttpStatus.CREATED)
  createQuotation(@Body() dto: CreateQuotationDto) {
    return this.sales.createQuotation(dto);
  }

  @Get('quotations/:id')
  getQuotation(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getQuotation(id);
  }

  @Patch('quotations/:id/status')
  @Permissions('sales:quotation:write')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuotationStatusDto) {
    return this.sales.setQuotationStatus(id, dto.status);
  }

  @Post('quotations/:id/convert')
  @Permissions('sales:quotation:write')
  convert(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.convertToOrder(id);
  }

  @Get('orders')
  listOrders() {
    return this.sales.listOrders();
  }

  @Post('orders')
  @Permissions('sales:order:write')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@Body() dto: CreateOrderDto) {
    return this.sales.createOrder(dto);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getOrder(id);
  }

  @Patch('orders/:id/fulfill')
  @Permissions('sales:order:write')
  fulfill(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.fulfillOrder(id);
  }

  @Patch('orders/:id/cancel')
  @Permissions('sales:order:write')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.cancelOrder(id);
  }
}
