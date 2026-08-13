import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const SERVICE_MODELS = ['DINE_IN', 'QSR', 'CAFE', 'CLOUD_KITCHEN', 'FOOD_COURT', 'BUFFET', 'DRIVE_THRU'] as const;
export const CHANNELS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'DRIVE_THRU', 'AGGREGATOR'] as const;
export const AREA_KINDS = ['INDOOR', 'OUTDOOR', 'VIP', 'TERRACE', 'GARDEN', 'PRIVATE_ROOM'] as const;
export const TABLE_SHAPES = ['SQUARE', 'ROUND', 'RECT', 'OVAL'] as const;
export const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'WAITING'] as const;
export const ITEM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

// ── Configuration ────────────────────────────────────────────────────────────────
export class SetRestaurantConfigDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(SERVICE_MODELS) serviceModel?: (typeof SERVICE_MODELS)[number];
  @IsOptional() @IsArray() @IsIn(CHANNELS, { each: true }) channels?: (typeof CHANNELS)[number][];
  @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) defaultTaxBp?: number;
  @IsOptional() @IsInt() @Min(0) serviceChargeBp?: number;
  @IsOptional() @IsInt() @Min(0) buffetPriceMinor?: number;
  @IsOptional() @IsBoolean() autoFireKitchen?: boolean;
  @IsOptional() @IsBoolean() tipEnabled?: boolean;
  @IsOptional() @IsBoolean() roundingEnabled?: boolean;
  @IsOptional() @IsString() timezone?: string;
  /** Fire a station ticket to the kitchen printer automatically when an order is confirmed. */
  @IsOptional() @IsBoolean() autoPrintKot?: boolean;
  /** Print the guest bill automatically on settlement (off by default — most tills print on demand). */
  @IsOptional() @IsBoolean() autoPrintBill?: boolean;
  @IsOptional() @IsString() receiptHeader?: string;
  @IsOptional() @IsString() receiptFooter?: string;
  @IsOptional() @IsBoolean() receiptShowQr?: boolean;
  /** NTN / STRN printed on the bill for the tax authority. */
  @IsOptional() @IsString() taxNumber?: string;
}

// ── Menu: categories ─────────────────────────────────────────────────────────────
export class CreateMenuCategoryDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() imageKey?: string;
}
export class UpdateMenuCategoryDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() imageKey?: string;
}

// ── Menu: items ──────────────────────────────────────────────────────────────────
export class CreateMenuItemDto {
  @IsOptional() @IsUUID() categoryId?: string;
  /** Link to an existing inventory product (for recipe/COGS), optional for pure services. */
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() sku?: string;
  /** Scannable barcode (EAN/UPC) for packaged goods — the POS scan-to-add key. */
  @IsOptional() @IsString() barcode?: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) basePriceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) taxBp?: number;
  @IsOptional() @IsInt() @Min(0) prepMinutes?: number;
  @IsOptional() @IsString() stationKey?: string;
  @IsOptional() @IsInt() @Min(0) calories?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) allergens?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() imageKey?: string;
  @IsOptional() @IsString() videoKey?: string;
  @IsOptional() @IsBoolean() isCombo?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
}
export class UpdateMenuItemDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) basePriceMinor?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() @Min(0) taxBp?: number;
  @IsOptional() @IsInt() @Min(0) prepMinutes?: number;
  @IsOptional() @IsString() stationKey?: string;
  @IsOptional() @IsInt() @Min(0) calories?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) allergens?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() imageKey?: string;
  @IsOptional() @IsString() videoKey?: string;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsIn(ITEM_STATUSES) status?: (typeof ITEM_STATUSES)[number];
}

export class ListMenuItemsQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(['true', 'false']) available?: 'true' | 'false';
}

export class SetItemBranchPriceDto {
  @IsUUID() branchId!: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number;
  @IsOptional() @IsBoolean() available?: boolean;
}

// ── Menu: modifier groups + modifiers ────────────────────────────────────────────
export class CreateModifierGroupDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() @Min(0) minSelect?: number;
  @IsOptional() @IsInt() @Min(0) maxSelect?: number;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
export class UpdateModifierGroupDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(0) minSelect?: number;
  @IsOptional() @IsInt() @Min(0) maxSelect?: number;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
export class CreateModifierDto {
  @IsUUID() groupId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsInt() priceDeltaMinor?: number;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() available?: boolean;
}
export class UpdateModifierDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() priceDeltaMinor?: number;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() available?: boolean;
}
export class AttachModifierGroupDto {
  @IsUUID() groupId!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

// ── Menu: combos ─────────────────────────────────────────────────────────────────
export class ComboComponentDto {
  @IsUUID() componentItemId!: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
  @IsOptional() @IsInt() priceDeltaMinor?: number;
}
export class SetComboComponentsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ComboComponentDto) components!: ComboComponentDto[];
}

// ── Floor: areas ─────────────────────────────────────────────────────────────────
export class CreateAreaDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsIn(AREA_KINDS) kind?: (typeof AREA_KINDS)[number];
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() layout?: Record<string, unknown>;
}
export class UpdateAreaDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(AREA_KINDS) kind?: (typeof AREA_KINDS)[number];
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() layout?: Record<string, unknown>;
}

// ── Floor: tables ────────────────────────────────────────────────────────────────
export class CreateTableDto {
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(TABLE_SHAPES) shape?: (typeof TABLE_SHAPES)[number];
  @IsOptional() @IsInt() posX?: number;
  @IsOptional() @IsInt() posY?: number;
  @IsOptional() @IsInt() @Min(1) width?: number;
  @IsOptional() @IsInt() @Min(1) height?: number;
  @IsOptional() @IsInt() rotation?: number;
}
export class UpdateTableDto {
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsString() @MinLength(1) code?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsIn(TABLE_SHAPES) shape?: (typeof TABLE_SHAPES)[number];
  @IsOptional() @IsInt() posX?: number;
  @IsOptional() @IsInt() posY?: number;
  @IsOptional() @IsInt() @Min(1) width?: number;
  @IsOptional() @IsInt() @Min(1) height?: number;
  @IsOptional() @IsInt() rotation?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class SetTableStatusDto {
  @IsIn(TABLE_STATUSES) status!: (typeof TABLE_STATUSES)[number];
}
export class MergeTablesDto {
  /** Tables to merge; the first is the primary the others fold into. */
  @IsArray() @ArrayMinSize(2) @IsUUID('4', { each: true }) tableIds!: string[];
}
export class ListTablesQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsIn(TABLE_STATUSES) status?: (typeof TABLE_STATUSES)[number];
}

// ── Orders ───────────────────────────────────────────────────────────────────────
export const ORDER_STATUSES = ['DRAFT', 'PLACED', 'CONFIRMED', 'IN_PROGRESS', 'READY', 'SERVED', 'SETTLED', 'CLOSED', 'VOID', 'REFUNDED'] as const;
export const PAYMENT_METHODS = ['CASH', 'CARD', 'WALLET', 'GIFT_CARD', 'LOYALTY', 'ONLINE', 'ROOM_CHARGE', 'AGGREGATOR', 'SPLIT'] as const;
export const KDS_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'VIP', 'RUSH'] as const;

export class CreateOrderDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @IsOptional() @IsUUID() tableId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() waiterEmployeeId?: string;
  @IsOptional() @IsInt() @Min(1) guestCount?: number;
  @IsOptional() @IsString() notes?: string;
  // Where a DELIVERY-channel order is going. Optional on every channel (a dine-in order has no
  // destination), and carried onto the delivery job opened at place-time. Not validated as
  // "required for DELIVERY" here: an address is often taken by phone after the order is opened,
  // and refusing the order would lose the sale rather than the address.
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) geoLat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) geoLng?: number;
}

export class OrderItemModifierInputDto {
  @IsUUID() modifierId!: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
}

export class OrderItemInputDto {
  @IsUUID() itemId!: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
  @IsOptional() @IsInt() @Min(1) course?: number;
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @IsOptional() @IsString() kitchenNotes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemModifierInputDto) modifiers?: OrderItemModifierInputDto[];
}

export class AddOrderItemsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items!: OrderItemInputDto[];
}

export class OrderPaymentInputDto {
  @IsIn(PAYMENT_METHODS) method!: (typeof PAYMENT_METHODS)[number];
  @IsInt() @Min(0) amountMinor!: number;
  @IsOptional() @IsInt() @Min(0) tipMinor?: number;
  @IsOptional() @IsString() reference?: string;
}

export class SettleOrderDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderPaymentInputDto) payments!: OrderPaymentInputDto[];
  @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @IsOptional() @IsInt() @Min(0) tipMinor?: number;
}

export class VoidOrderDto {
  @IsOptional() @IsString() reason?: string;
}

export class ListOrdersQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(ORDER_STATUSES) status?: (typeof ORDER_STATUSES)[number];
  @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @IsOptional() @IsUUID() tableId?: string;
}

// ── KDS ──────────────────────────────────────────────────────────────────────────
export class KdsBoardQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() stationKey?: string;
}

export class SetKdsPriorityDto {
  @IsIn(KDS_PRIORITIES) priority!: (typeof KDS_PRIORITIES)[number];
}

export class AssignChefDto {
  @IsUUID() chefEmployeeId!: string;
}

// ── Delivery ─────────────────────────────────────────────────────────────────────
export const DELIVERY_PROVIDERS = ['OWN', 'FOODPANDA', 'UBER_EATS', 'TALABAT', 'CAREEM'] as const;
export const DELIVERY_STATUSES = ['PENDING', 'ASSIGNED', 'PICKED_UP', 'EN_ROUTE', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;

export class CreateDeliveryDto {
  @IsUUID() orderId!: string;
  @IsOptional() @IsIn(DELIVERY_PROVIDERS) provider?: (typeof DELIVERY_PROVIDERS)[number];
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() geoLat?: number;
  @IsOptional() @IsNumber() geoLng?: number;
  @IsOptional() @IsInt() @Min(0) etaMinutes?: number;
  @IsOptional() @IsString() externalRef?: string;
}

export class AssignDriverDto {
  @IsUUID() driverEmployeeId!: string;
  @IsOptional() @IsInt() @Min(0) etaMinutes?: number;
}

export class TrackLocationDto {
  @IsNumber() geoLat!: number;
  @IsNumber() geoLng!: number;
  @IsOptional() @IsNumber() speedKph?: number;
}

export class CompleteDeliveryDto {
  @IsString() @MinLength(4) otp!: string;
}

export class FailDeliveryDto {
  @IsOptional() @IsString() reason?: string;
}

export class ListDeliveriesQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(DELIVERY_STATUSES) status?: (typeof DELIVERY_STATUSES)[number];
  @IsOptional() @IsUUID() driverEmployeeId?: string;
}

export class AggregatorUpdateDto {
  @IsString() externalRef!: string;
  @IsIn(DELIVERY_STATUSES) status!: (typeof DELIVERY_STATUSES)[number];
  @IsOptional() @IsNumber() geoLat?: number;
  @IsOptional() @IsNumber() geoLng?: number;
  @IsOptional() @IsInt() @Min(0) etaMinutes?: number;
}

// ── Recipes ──────────────────────────────────────────────────────────────────────
export class RecipeIngredientInputDto {
  @IsUUID() productId!: string;
  /** Quantity of this ingredient per whole recipe yield, in milli-units (1000 = 1 stock unit). */
  @IsInt() @Min(0) qtyPerYieldMilli!: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(0) wasteBp?: number;
}

export class SetRecipeDto {
  @IsOptional() @IsInt() @Min(1) yieldQty?: number;
  @IsOptional() @IsString() instructions?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RecipeIngredientInputDto) ingredients!: RecipeIngredientInputDto[];
}

// ── Dynamic fiscalization config ─────────────────────────────────────────────────
export const FISCAL_AUTHORITIES = ['NONE', 'PRA', 'FBR', 'SRB', 'KPRA', 'BRA'] as const;
export const FISCAL_ENVIRONMENTS = ['sandbox', 'production'] as const;

export class SetFiscalConfigDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(FISCAL_AUTHORITIES) authority?: (typeof FISCAL_AUTHORITIES)[number];
  @IsOptional() @IsIn(FISCAL_ENVIRONMENTS) environment?: (typeof FISCAL_ENVIRONMENTS)[number];
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() registrationNo?: string;
  @IsOptional() @IsString() ntn?: string;
  @IsOptional() @IsString() strn?: string;
  @IsOptional() @IsString() posId?: string;
  @IsOptional() @IsString() apiBaseUrl?: string;
  /** Secret API token — written but never returned by reads. */
  @IsOptional() @IsString() apiToken?: string;
}

// ── Reservations ─────────────────────────────────────────────────────────────────
export const RESERVATION_STATUSES = ['BOOKED', 'CONFIRMED', 'WAITLIST', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

export class CreateReservationDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() tableId?: string;
  @IsOptional() @IsString() guestName?: string;
  @IsOptional() @IsString() guestPhone?: string;
  @IsOptional() @IsInt() @Min(1) partySize?: number;
  @IsDateString() reservedFor!: string;
  @IsOptional() @IsInt() @Min(1) durationMinutes?: number;
  @IsOptional() @IsBoolean() waitlist?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class SetReservationStatusDto {
  @IsIn(['CONFIRMED', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED']) status!: 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
}

export class ReservationCheckinDto {
  @IsString() @MinLength(4) code!: string;
}

export class ListReservationsQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(RESERVATION_STATUSES) status?: (typeof RESERVATION_STATUSES)[number];
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// ── GL account mapping ─────────────────────────────────────────────────────────--
export class SetGlConfigDto {
  @IsOptional() @IsUUID() revenueAccountId?: string;
  @IsOptional() @IsUUID() taxAccountId?: string;
  @IsOptional() @IsUUID() cogsAccountId?: string;
  @IsOptional() @IsUUID() inventoryAccountId?: string;
  @IsOptional() @IsUUID() cashAccountId?: string;
  @IsOptional() @IsUUID() bankAccountId?: string;
  @IsOptional() @IsUUID() cardClearingAccountId?: string;
  @IsOptional() @IsUUID() walletClearingAccountId?: string;
  @IsOptional() @IsUUID() giftCardLiabilityAccountId?: string;
  @IsOptional() @IsUUID() discountAccountId?: string;
  @IsOptional() @IsUUID() serviceChargeAccountId?: string;
  @IsOptional() @IsUUID() tipsPayableAccountId?: string;
  @IsOptional() @IsUUID() roundingAccountId?: string;
  @IsOptional() @IsUUID() receivableAccountId?: string;
}

// ── Printing (peripherals) ───────────────────────────────────────────────────────
export const PRINTER_KINDS = ['RECEIPT', 'KITCHEN', 'LABEL', 'REPORT'] as const;
export const PRINTER_CONNECTIONS = ['NETWORK', 'USB', 'BLUETOOTH', 'BROWSER', 'CLOUD'] as const;
export const PRINT_JOB_KINDS = ['RECEIPT', 'KOT', 'BILL_PREVIEW', 'LABEL', 'TEST', 'REPORT'] as const;
export const PRINT_JOB_STATUSES = ['QUEUED', 'CLAIMED', 'PRINTED', 'FAILED', 'CANCELLED'] as const;

export class CreatePrinterDto {
  @IsOptional() @IsUUID() branchId?: string;
  /** Stable identifier the print agent is configured with, e.g. `till-1` or `kitchen-grill`. */
  @IsString() @MinLength(1) key!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsIn(PRINTER_KINDS) kind?: (typeof PRINTER_KINDS)[number];
  @IsOptional() @IsIn(PRINTER_CONNECTIONS) connection?: (typeof PRINTER_CONNECTIONS)[number];
  /** IP or hostname for a NETWORK printer (required for that connection). */
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) port?: number;
  /** Device node or MAC for USB/Bluetooth, e.g. /dev/usb/lp0. */
  @IsOptional() @IsString() devicePath?: string;
  /** Binds a KITCHEN printer to one station so its KOTs route here. */
  @IsOptional() @IsString() stationKey?: string;
  /** Printable columns: 32 for 58mm paper, 42 (or 48) for 80mm. */
  @IsOptional() @IsInt() @Min(16) charsPerLine?: number;
  @IsOptional() @IsString() codepage?: string;
  @IsOptional() @IsInt() @Min(1) copies?: number;
  @IsOptional() @IsBoolean() cut?: boolean;
  @IsOptional() @IsBoolean() cashDrawer?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdatePrinterDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(PRINTER_KINDS) kind?: (typeof PRINTER_KINDS)[number];
  @IsOptional() @IsIn(PRINTER_CONNECTIONS) connection?: (typeof PRINTER_CONNECTIONS)[number];
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) port?: number;
  @IsOptional() @IsString() devicePath?: string;
  @IsOptional() @IsString() stationKey?: string;
  @IsOptional() @IsInt() @Min(16) charsPerLine?: number;
  @IsOptional() @IsString() codepage?: string;
  @IsOptional() @IsInt() @Min(1) copies?: number;
  @IsOptional() @IsBoolean() cut?: boolean;
  @IsOptional() @IsBoolean() cashDrawer?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ListPrintersQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsIn(PRINTER_KINDS) kind?: (typeof PRINTER_KINDS)[number];
  @IsOptional() @IsBoolean() @Type(() => Boolean) active?: boolean;
}

export class PrintOrderDto {
  /** Send to a specific device instead of the branch default. */
  @IsOptional() @IsUUID() printerId?: string;
  /** Stamps a REPRINT banner so a duplicate is never mistaken for the original. */
  @IsOptional() @IsBoolean() reprint?: boolean;
  @IsOptional() @IsString() copyLabel?: string;
}

export class ClaimPrintJobDto {
  @IsOptional() @IsUUID() printerId?: string;
  /** Agents are usually configured with the human-readable key rather than a uuid. */
  @IsOptional() @IsString() printerKey?: string;
  /** Free-text agent identity recorded on the claim (host name, till number). */
  @IsOptional() @IsString() agent?: string;
}

export class CompletePrintJobDto {
  @IsOptional() @IsBoolean() ok?: boolean;
  @IsOptional() @IsString() error?: string;
}

export class ListPrintJobsQueryDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() printerId?: string;
  @IsOptional() @IsIn(PRINT_JOB_STATUSES) status?: (typeof PRINT_JOB_STATUSES)[number];
  @IsOptional() @IsIn(PRINT_JOB_KINDS) kind?: (typeof PRINT_JOB_KINDS)[number];
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) limit?: number;
}

// ── Scanning (barcode / QR) ──────────────────────────────────────────────────────
export class ScanDto {
  /** Whatever the scanner produced: a document number, a QR payload or a product barcode. */
  @IsString() @MinLength(1) code!: string;
  /** Scopes a table lookup to the outlet the device belongs to. */
  @IsOptional() @IsUUID() branchId?: string;
}

export class ScanAddDto {
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsInt() @Min(1) qty?: number;
}

// ── Code generation (barcodes / QR) ──────────────────────────────────────────────
export const BARCODE_SYMBOLOGIES = ['EAN13', 'CODE39'] as const;
export const CODE_FORMATS = ['svg', 'png'] as const;

export class GenerateBarcodeDto {
  /** Supply a real manufacturer's EAN to record it; omit to mint an internal one. */
  @IsOptional() @IsString() value?: string;
  /** GS1 in-store prefix (20–29) for minted codes. */
  @IsOptional() @IsString() prefix?: string;
  /** Replace an existing barcode (invalidates labels already printed). */
  @IsOptional() @IsBoolean() regenerate?: boolean;
}

export class PrintLabelDto {
  @IsOptional() @IsInt() @Min(1) copies?: number;
  @IsOptional() @IsString() caption?: string;
}
