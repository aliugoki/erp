import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { AddToCartDto, ApplyCouponDto, CheckoutDto, UpdateCartItemDto } from './dto/ecommerce.dto';
import { EcommerceService } from './ecommerce.service';
import { StorefrontService } from './storefront.service';

/**
 * Public, unauthenticated storefront — reached by the tenant slug (`/shop/:slug/...`). Every handler
 * resolves the slug to a tenant + published store first (StorefrontService), then reads through the
 * normal RLS path. Marked `@Public()` so the JWT guard lets it through; no feature/role guards apply
 * (those need an authenticated tenant context).
 */
@Public()
@Controller('shop/:slug')
export class StorefrontController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly ec: EcommerceService,
  ) {}

  @Get()
  async home(@Param('slug') slug: string) {
    await this.storefront.resolve(slug);
    return this.ec.storefrontHome();
  }

  @Get('products')
  async products(
    @Param('slug') slug: string,
    @Query('collection') collection?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
  ) {
    await this.storefront.resolve(slug);
    return this.ec.storefrontProducts({ collection, q, sort });
  }

  @Get('products/:productSlug')
  async product(@Param('slug') slug: string, @Param('productSlug') productSlug: string) {
    await this.storefront.resolve(slug);
    return this.ec.storefrontProduct(productSlug);
  }

  @Get('images/:imageId')
  @Header('Cache-Control', 'public, max-age=3600')
  async image(@Param('slug') slug: string, @Param('imageId', ParseUUIDPipe) imageId: string): Promise<StreamableFile> {
    await this.storefront.resolve(slug);
    const img = await this.ec.getProductImage(imageId);
    if (!img) throw new NotFoundException('Image not found');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  @Get('logo')
  @Header('Cache-Control', 'public, max-age=3600')
  async logo(@Param('slug') slug: string): Promise<StreamableFile> {
    await this.storefront.resolve(slug);
    const img = await this.ec.getStoreImage('logo');
    if (!img) throw new NotFoundException('No logo');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  @Get('hero')
  @Header('Cache-Control', 'public, max-age=3600')
  async hero(@Param('slug') slug: string): Promise<StreamableFile> {
    await this.storefront.resolve(slug);
    const img = await this.ec.getStoreImage('hero');
    if (!img) throw new NotFoundException('No hero image');
    return new StreamableFile(img.data, { type: img.contentType, disposition: 'inline' });
  }

  // ── Cart ──────────────────────────────────────────────────────────────────────
  @Post('cart')
  @HttpCode(HttpStatus.CREATED)
  async createCart(@Param('slug') slug: string) {
    await this.storefront.resolve(slug);
    return this.ec.createCart();
  }

  @Get('cart/:token')
  async getCart(@Param('slug') slug: string, @Param('token') token: string) {
    await this.storefront.resolve(slug);
    return this.ec.getCart(token);
  }

  @Post('cart/:token/items')
  async addItem(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: AddToCartDto) {
    await this.storefront.resolve(slug);
    return this.ec.addToCart(token, dto);
  }

  @Patch('cart/:token/items/:productId')
  async updateItem(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    await this.storefront.resolve(slug);
    return this.ec.updateCartItem(token, productId, dto.quantity);
  }

  @Post('cart/:token/coupon')
  async coupon(@Param('slug') slug: string, @Param('token') token: string, @Body() dto: ApplyCouponDto) {
    await this.storefront.resolve(slug);
    return this.ec.applyCoupon(token, dto.code);
  }

  // ── Checkout ────────────────────────────────────────────────────────────────────
  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  async checkout(@Param('slug') slug: string, @Body() dto: CheckoutDto) {
    await this.storefront.resolve(slug);
    return this.ec.placeOrder(dto);
  }

  @Get('orders/:orderNo')
  async order(@Param('slug') slug: string, @Param('orderNo') orderNo: string) {
    await this.storefront.resolve(slug);
    return this.ec.storefrontOrder(orderNo);
  }
}
