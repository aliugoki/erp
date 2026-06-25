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
  Put,
  Query,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import type { UploadedFileLike } from '../storage/storage.service';
import {
  CreateProductDto,
  CreateVariantDto,
  SetEcGlConfigDto,
  SetPaymentConfigDto,
  SetReviewStatusDto,
  UpdateOrderStatusDto,
  UpdateProductDto,
  UpdateVariantDto,
  UpsertCollectionDto,
  UpsertDiscountDto,
  UpsertShippingZoneDto,
  UpsertStoreDto,
} from './dto/ecommerce.dto';
import { EcommerceService } from './ecommerce.service';
import { PaymentService } from './payment.service';

const IMG = { limits: { fileSize: 5 * 1024 * 1024 } };

/** Admin management for the online store — gated by the `ecommerce` feature entitlement (ADR-009). */
@Controller('ecommerce')
@RequiresFeature('ecommerce')
export class EcommerceController {
  constructor(
    private readonly ec: EcommerceService,
    private readonly payments: PaymentService,
  ) {}

  // ── Payment provider config ─────────────────────────────────────────────────────
  @Get('payment-config')
  @Permissions('ecommerce:manage')
  getPaymentConfig() {
    return this.payments.getConfig();
  }

  @Put('payment-config')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  setPaymentConfig(@Body() dto: SetPaymentConfigDto) {
    return this.payments.setConfig(dto);
  }

  // ── Store settings ──────────────────────────────────────────────────────────
  @Get('store')
  getStore() {
    return this.ec.getStore();
  }

  @Put('store')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  upsertStore(@Body() dto: UpsertStoreDto) {
    return this.ec.upsertStore(dto);
  }

  @Post('store/logo')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', IMG))
  uploadLogo(@UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('Image file required');
    return this.ec.uploadStoreImage('logo', file);
  }

  @Post('store/hero')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', IMG))
  uploadHero(@UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('Image file required');
    return this.ec.uploadStoreImage('hero', file);
  }

  @Get('store/logo')
  @Header('Cache-Control', 'private, max-age=300')
  async storeLogo(): Promise<StreamableFile> {
    const img = await this.ec.getStoreImage('logo');
    if (!img) throw new NotFoundException('No logo');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  @Get('store/hero')
  @Header('Cache-Control', 'private, max-age=300')
  async storeHero(): Promise<StreamableFile> {
    const img = await this.ec.getStoreImage('hero');
    if (!img) throw new NotFoundException('No hero image');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  // ── Collections ─────────────────────────────────────────────────────────────
  @Get('collections')
  listCollections() {
    return this.ec.listCollections();
  }

  @Post('collections')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  createCollection(@Body() dto: UpsertCollectionDto) {
    return this.ec.createCollection(dto);
  }

  @Patch('collections/:id')
  @Permissions('ecommerce:manage')
  updateCollection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCollectionDto) {
    return this.ec.updateCollection(id, dto);
  }

  @Delete('collections/:id')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCollection(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.deleteCollection(id);
  }

  // ── Products ────────────────────────────────────────────────────────────────
  @Get('products')
  listProducts(@Query('status') status?: string, @Query('q') q?: string) {
    return this.ec.listProducts({ status, q });
  }

  @Get('products/:id')
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.getProduct(id);
  }

  @Post('products')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  createProduct(@Body() dto: CreateProductDto) {
    return this.ec.createProduct(dto);
  }

  @Patch('products/:id')
  @Permissions('ecommerce:manage')
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.ec.updateProduct(id, dto);
  }

  @Delete('products/:id')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.deleteProduct(id);
  }

  // ── Product images ────────────────────────────────────────────────────────────
  @Post('products/:id/images')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', IMG))
  addImage(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('Image file required');
    return this.ec.addProductImage(id, file);
  }

  @Get('products/:id/images')
  listImages(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.listProductImages(id);
  }

  @Get('product-images/:imageId')
  @Header('Cache-Control', 'private, max-age=300')
  async image(@Param('imageId', ParseUUIDPipe) imageId: string): Promise<StreamableFile> {
    const img = await this.ec.getProductImage(imageId);
    if (!img) throw new NotFoundException('Image not found');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  @Post('products/:id/images/:imageId/primary')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  setPrimary(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.ec.setPrimaryImage(id, imageId);
  }

  @Delete('product-images/:imageId')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeImage(@Param('imageId', ParseUUIDPipe) imageId: string) {
    return this.ec.removeProductImage(imageId);
  }

  // ── Product variants ──────────────────────────────────────────────────────────
  @Get('products/:id/variants')
  listVariants(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.listVariants(id);
  }

  @Post('products/:id/variants')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  addVariant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVariantDto) {
    return this.ec.addVariant(id, dto);
  }

  @Patch('variants/:variantId')
  @Permissions('ecommerce:manage')
  updateVariant(@Param('variantId', ParseUUIDPipe) variantId: string, @Body() dto: UpdateVariantDto) {
    return this.ec.updateVariant(variantId, dto);
  }

  @Delete('variants/:variantId')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeVariant(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.ec.removeVariant(variantId);
  }

  // ── Reviews (moderation) ────────────────────────────────────────────────────
  @Get('reviews')
  listReviews(@Query('status') status?: string) {
    return this.ec.listReviews({ status });
  }

  @Patch('reviews/:id/status')
  @Permissions('ecommerce:manage')
  setReviewStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetReviewStatusDto) {
    return this.ec.setReviewStatus(id, dto);
  }

  @Delete('reviews/:id')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteReview(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.deleteReview(id);
  }

  // ── Shipping zones ──────────────────────────────────────────────────────────
  @Get('shipping-zones')
  listShippingZones() {
    return this.ec.listShippingZones();
  }

  @Post('shipping-zones')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  createShippingZone(@Body() dto: UpsertShippingZoneDto) {
    return this.ec.createShippingZone(dto);
  }

  @Patch('shipping-zones/:id')
  @Permissions('ecommerce:manage')
  updateShippingZone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertShippingZoneDto) {
    return this.ec.updateShippingZone(id, dto);
  }

  @Delete('shipping-zones/:id')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeShippingZone(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.removeShippingZone(id);
  }

  // ── Discounts ───────────────────────────────────────────────────────────────
  @Get('discounts')
  listDiscounts() {
    return this.ec.listDiscounts();
  }

  @Post('discounts')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.CREATED)
  createDiscount(@Body() dto: UpsertDiscountDto) {
    return this.ec.createDiscount(dto);
  }

  @Delete('discounts/:id')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDiscount(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.deleteDiscount(id);
  }

  // ── Orders ──────────────────────────────────────────────────────────────────
  @Get('orders')
  listOrders(@Query('status') status?: string) {
    return this.ec.listOrders({ status });
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.ec.getOrder(id);
  }

  @Patch('orders/:id/status')
  @Permissions('ecommerce:manage')
  updateOrderStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ec.updateOrderStatus(id, dto);
  }

  /** Cancel + restock card orders whose payment session lapsed unpaid (also runs automatically). */
  @Post('orders/release-expired')
  @Permissions('ecommerce:manage')
  @HttpCode(HttpStatus.OK)
  releaseExpired() {
    return this.ec.releaseExpired();
  }

  // ── GL posting config ───────────────────────────────────────────────────────
  @Get('gl-config')
  @Permissions('ecommerce:finance:write')
  getGlConfig() {
    return this.ec.getGlConfig();
  }

  @Put('gl-config')
  @Permissions('ecommerce:finance:write')
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetEcGlConfigDto) {
    return this.ec.setGlConfig(dto);
  }
}
