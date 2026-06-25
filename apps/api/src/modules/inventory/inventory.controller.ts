import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import type { UploadedFileLike } from '../storage/storage.service';
import {
  CreateCategoryDto,
  CreateMovementDto,
  CreateProductDto,
  CreateWarehouseDto,
  SetProductCategoryDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateWarehouseDto,
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
  @ShadowPermissions('inventory:category:write')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:category:write')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:category:write')
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.removeCategory(id);
  }

  @Get('warehouses')
  listWarehouses() {
    return this.inventory.listWarehouses();
  }

  @Post('warehouses')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:warehouse:write')
  @HttpCode(HttpStatus.CREATED)
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.inventory.createWarehouse(dto);
  }

  @Patch('warehouses/:id')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:warehouse:write')
  updateWarehouse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) {
    return this.inventory.updateWarehouse(id, dto);
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
  @ShadowPermissions('inventory:product:write')
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
  @ShadowPermissions('inventory:product:write')
  setProductCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProductCategoryDto) {
    return this.inventory.setProductCategory(id, dto.categoryId ?? null);
  }

  @Patch('products/:id')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:product:write')
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.inventory.updateProduct(id, dto);
  }

  @Delete('products/:id')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:product:write')
  @HttpCode(HttpStatus.OK)
  deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.deleteProduct(id);
  }

  @Get('products/:id/movements')
  movements(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.listMovements(id);
  }

  // ── Product images ────────────────────────────────────────────────────────────
  @Get('products/:id/images')
  listImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.listProductImages(id);
  }

  /** Upload an image for a product — multipart `file` field (image, ≤8 MiB). */
  @Post('products/:id/images')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:product:write')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('A multipart "file" field is required');
    return this.inventory.addProductImage(id, file);
  }

  /** Stream a product image's bytes (raw image; not enveloped). */
  @Get('products/:id/images/:imageId')
  @Header('Cache-Control', 'private, max-age=3600')
  async getImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<StreamableFile> {
    const img = await this.inventory.getProductImage(id, imageId);
    if (!img) throw new NotFoundException('Image not found');
    return new StreamableFile(img.data, { type: img.contentType, length: img.byteSize });
  }

  @Patch('products/:id/images/:imageId/primary')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:product:write')
  setPrimaryImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.inventory.setPrimaryImage(id, imageId);
  }

  @Delete('products/:id/images/:imageId')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:product:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.inventory.removeProductImage(id, imageId);
  }

  @Post('movements')
  @Roles(...WRITE)
  @ShadowPermissions('inventory:stock:write')
  @HttpCode(HttpStatus.CREATED)
  createMovement(@Body() dto: CreateMovementDto) {
    return this.inventory.createMovement(dto);
  }
}
