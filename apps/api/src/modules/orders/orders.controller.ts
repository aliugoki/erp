import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { CreateOrderDto } from './dto/orders.dto';
import { OrdersService } from './orders.service';

/**
 * Order-to-cash (Chunk 7.3). `POST /orders` runs the saga (reserve → invoice → pay) and returns the
 * resulting order — `status: 'PAID'` on success or `'COMPENSATED'` if a step failed (with the
 * failure step recorded). Auth + tenant scoped; writes require a sales/admin role.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles(Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getOrder(id);
  }
}
