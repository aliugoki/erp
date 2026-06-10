import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateMovementDto, CreateProductDto, CreateWarehouseDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

const WRITE = [Role.INVENTORY_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Inventory module — gated by the `inventory` feature; writes require an inventory manager (or admin). */
@Controller('inventory')
@RequiresFeature('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.inventory.listWarehouses();
  }

  @Post('warehouses')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.inventory.createWarehouse(dto);
  }

  @Get('products')
  listProducts() {
    return this.inventory.listProducts();
  }

  /** Products below their reorder point. Declared before `products/:id` so it isn't shadowed. */
  @Get('products/low-stock')
  lowStock() {
    return this.inventory.listLowStock();
  }

  @Post('products')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createProduct(@Body() dto: CreateProductDto) {
    return this.inventory.createProduct(dto);
  }

  @Get('products/:id')
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getProduct(id);
  }

  @Get('products/:id/movements')
  movements(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.listMovements(id);
  }

  @Post('movements')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createMovement(@Body() dto: CreateMovementDto) {
    return this.inventory.createMovement(dto);
  }
}
