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
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  CreateCategoryDto,
  CreateMovementDto,
  CreateProductDto,
  CreateWarehouseDto,
  SetProductCategoryDto,
  UpdateCategoryDto,
} from './dto/inventory.dto';
import { InventoryCategoriesService } from './inventory-categories.service';
import { InventoryService } from './inventory.service';

const WRITE = [Role.INVENTORY_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Inventory module — gated by the `inventory` feature; writes require an inventory manager (or admin). */
@Controller('inventory')
@RequiresFeature('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly categories: InventoryCategoriesService,
  ) {}

  // ── Categories (3-level tree) ───────────────────────────────────────────────
  @Get('categories')
  listCategories() {
    return this.categories.listCategories();
  }

  @Get('categories/tree')
  categoryTree() {
    return this.categories.getTree();
  }

  @Post('categories')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles(...WRITE)
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles(...WRITE)
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.removeCategory(id);
  }

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

  @Patch('products/:id/category')
  @Roles(...WRITE)
  setProductCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProductCategoryDto) {
    return this.inventory.setProductCategory(id, dto.categoryId ?? null);
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
