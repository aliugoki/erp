import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// ── Admin: store settings ───────────────────────────────────────────────────────
export class UpsertStoreDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsHexColor() accentColor?: string;
  @IsOptional() @IsString() heroHeadline?: string;
  @IsOptional() @IsString() heroSubtext?: string;
  @IsOptional() @IsEmail() supportEmail?: string;
  @IsOptional() @IsString() supportPhone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) defaultTaxRate?: number;
  @IsOptional() @IsInt() @Min(0) shippingFlatMinor?: number;
  @IsOptional() @IsInt() @Min(0) freeShippingOverMinor?: number;
  @IsOptional() @IsBoolean() published?: boolean;
}

// ── Admin: collections ──────────────────────────────────────────────────────────
export class UpsertCollectionDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}

// ── Admin: products (online listing over an inventory product) ───────────────────
export class CreateProductDto {
  @IsUUID() productId!: string; // the inventory_product to list
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsInt() @Min(0) compareAtMinor?: number;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: string;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() seoTitle?: string;
  @IsOptional() @IsString() seoDescription?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) collectionIds?: string[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsInt() @Min(0) compareAtMinor?: number;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: string;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() seoTitle?: string;
  @IsOptional() @IsString() seoDescription?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) collectionIds?: string[];
}

// ── Admin: discount codes ───────────────────────────────────────────────────────
export class UpsertDiscountDto {
  @IsString() @MinLength(2) code!: string;
  @IsIn(['PERCENT', 'FIXED']) type!: string;
  @IsInt() @Min(1) value!: number; // PERCENT: 1-100; FIXED: minor units
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) minSubtotalMinor?: number;
  @IsOptional() @IsString() startsAt?: string;
  @IsOptional() @IsString() endsAt?: string;
  @IsOptional() @IsInt() @Min(1) usageLimit?: number;
}

// ── Admin: GL posting config ────────────────────────────────────────────────────
export class SetEcGlConfigDto {
  @IsOptional() @IsUUID() clearingAccountId?: string;
  @IsOptional() @IsUUID() revenueAccountId?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
  @IsOptional() @IsUUID() cogsAccountId?: string;
  @IsOptional() @IsUUID() inventoryAccountId?: string;
  @IsOptional() @IsUUID() shippingAccountId?: string;
}

// ── Admin: order fulfilment ─────────────────────────────────────────────────────
export class UpdateOrderStatusDto {
  @IsIn(['PENDING', 'PAID', 'FULFILLED', 'SHIPPED', 'CANCELLED', 'REFUNDED']) status!: string;
  @IsOptional() @IsString() paymentReference?: string;
}

// ── Admin: product variants ─────────────────────────────────────────────────────
export class CreateVariantDto {
  @IsUUID() inventoryProductId!: string; // the stocked SKU backing this variant
  @IsOptional() @IsString() @MinLength(1) label?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsInt() @Min(0) compareAtMinor?: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateVariantDto {
  @IsOptional() @IsString() @MinLength(1) label?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsInt() @Min(0) compareAtMinor?: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED']) status?: string;
}

// ── Storefront: cart ────────────────────────────────────────────────────────────
export class AddToCartDto {
  @IsUUID() productId!: string; // ec_product id
  @IsOptional() @IsUUID() variantId?: string; // ec_product_variant id (when the product has variants)
  @IsOptional() @IsInt() @Min(1) @Max(999) quantity?: number;
}

export class UpdateCartItemDto {
  @IsInt() @Min(0) @Max(999) quantity!: number; // 0 removes the line
  @IsOptional() @IsUUID() variantId?: string; // which variant line to change (when present)
}

export class ApplyCouponDto {
  @IsString() @MinLength(2) code!: string;
}

// ── Admin: shipping zones ───────────────────────────────────────────────────────
export class UpsertShippingZoneDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) countries?: string[];
  @IsOptional() @IsInt() @Min(0) rateMinor?: number;
  @IsOptional() @IsInt() @Min(0) freeOverMinor?: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

// ── Storefront: shipping quote ──────────────────────────────────────────────────
export class ShippingQuoteDto {
  @IsOptional() @IsString() country?: string;
  @IsInt() @Min(0) subtotalMinor!: number;
}

// ── Admin: payment provider config ──────────────────────────────────────────────
export class SetPaymentConfigDto {
  @IsIn(['SIMULATED', 'HTTP']) provider!: string;
  @IsOptional() @IsString() gatewayUrl?: string;
  @IsOptional() @IsString() webhookSecret?: string;
  @IsOptional() @IsString() publishableKey?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

// ── Storefront: payment ─────────────────────────────────────────────────────────
export class ConfirmPaymentDto {
  @IsString() @MinLength(8) clientSecret!: string;
}

export class PaymentWebhookDto {
  @IsUUID() paymentId!: string;
  @IsIn(['PAID', 'FAILED']) status!: string;
  @IsString() signature!: string;
  @IsOptional() @IsString() providerRef?: string;
}

// ── Storefront: customer accounts ───────────────────────────────────────────────
export class CustomerRegisterDto {
  @IsString() @MinLength(1) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() phone?: string;
}

export class CustomerLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

// ── Storefront: checkout ────────────────────────────────────────────────────────
export class CheckoutItemDto {
  @IsUUID() productId!: string; // ec_product id
  @IsOptional() @IsUUID() variantId?: string;
  @IsInt() @Min(1) @Max(999) quantity!: number;
}

export class CheckoutDto {
  @IsOptional() @IsString() cartToken?: string; // settle a server cart…
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CheckoutItemDto) items?: CheckoutItemDto[]; // …or pass items directly
  @IsString() @MinLength(1) customerName!: string;
  @IsEmail() customerEmail!: string;
  @IsOptional() @IsString() customerPhone?: string;
  @IsOptional() @IsString() shippingAddress?: string;
  @IsOptional() @IsString() shippingCity?: string;
  @IsOptional() @IsString() shippingCountry?: string;
  @IsIn(['COD', 'CARD']) paymentMethod!: string;
  @IsOptional() @IsString() discountCode?: string;
}
