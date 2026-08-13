'use client';
import { useState } from 'react';
import { Loader2, UtensilsCrossed } from 'lucide-react';
import type { Money } from '@/lib/types';

// ── API response shapes (match apps/api restaurant services) ─────────────────────
export interface Branch {
  id: string;
  name: string;
  code: string | null;
  isHeadOffice: boolean;
  active: boolean;
  configured: boolean;
}

export interface RestaurantConfig {
  branchId: string | null;
  serviceModel: string;
  channels: string[];
  defaultWarehouseId: string | null;
  currency: string;
  defaultTaxBp: number;
  serviceChargeBp: number;
  autoFireKitchen: boolean;
  tipEnabled: boolean;
  roundingEnabled: boolean;
  timezone: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  imageKey: string | null;
  itemCount: number;
}

export interface MenuItem {
  id: string;
  categoryId: string | null;
  category: string | null;
  productId: string | null;
  sku: string | null;
  /** Scannable product code — null until one is minted or recorded. */
  barcode: string | null;
  name: string;
  basePrice: Money;
  effectivePrice: Money;
  currency: string;
  taxBp: number | null;
  prepMinutes: number;
  stationKey: string | null;
  isCombo: boolean;
  imageKey: string | null;
  available: boolean;
  status: string;
}

export interface RestTable {
  id: string;
  areaId: string | null;
  area: string | null;
  branchId: string | null;
  code: string;
  capacity: number;
  shape: string;
  position: { x: number; y: number; width: number; height: number; rotation: number };
  status: string;
  mergedIntoId: string | null;
  active: boolean;
}

export interface FloorArea {
  id: string;
  name: string;
  branchId: string | null;
  sortOrder: number;
  tableCount: number;
}

export interface KdsTicket {
  id: string;
  orderId: string;
  orderNo: string;
  stationKey: string;
  ticketNo: string;
  priority: number;
  status: string;
  channel: string;
  table: string | null;
  guestCount: number;
  chefEmployeeId: string | null;
  targetMinutes: number | null;
  elapsedSeconds: number;
  firedAt: string | null;
  items: Array<{ name: string; qty: number; modifiers: string | null; status: string }>;
}

export interface OrderRow {
  id: string;
  orderNo: string;
  branchId: string | null;
  channel: string;
  status: string;
  table: string | null;
  guestCount: number;
  itemCount: number;
  total: Money;
}

export interface OrderLine {
  id: string;
  itemId: string | null;
  name: string;
  stationKey: string | null;
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
  status: string;
}

export interface OrderDetail {
  id: string;
  orderNo: string;
  channel: string;
  tableId: string | null;
  table: string | null;
  guestCount: number;
  status: string;
  currency: string;
  totals: {
    subtotal: Money; discount: Money; serviceCharge: Money; tax: Money;
    tip: Money; rounding: Money; total: Money; paid: Money;
  };
  items: OrderLine[];
}

/** Order statuses at which the bill can still be settled (open, not yet closed/void). */
export const SETTLEABLE = ['CONFIRMED', 'IN_PROGRESS', 'READY', 'SERVED'];
export const PAYMENT_METHODS = ['CASH', 'CARD', 'WALLET', 'ONLINE'] as const;

export interface DeliveryRow {
  id: string;
  deliveryNo: string;
  orderId: string;
  orderNo: string;
  branchId: string | null;
  provider: string;
  driverEmployeeId: string | null;
  driverId: string | null;
  /** The rider as a person — a board should print a name, never a UUID. */
  driver: { id: string; name: string; phone: string | null; vehicleType: string } | null;
  status: string;
  address: string | null;
  etaMinutes: number | null;
  assignedAt: string | null;
  deliveredAt: string | null;
}

export interface ReservationRow {
  id: string;
  reservationNo: string;
  branchId: string | null;
  customerId: string | null;
  tableId: string | null;
  table: string | null;
  guestName: string | null;
  guestPhone: string | null;
  partySize: number;
  reservedFor: string;
  durationMinutes: number;
  status: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number | null;
  required: boolean;
  sortOrder: number;
  modifierCount: number;
}

export interface Modifier {
  id: string;
  name: string;
  priceDelta: Money;
  available: boolean;
  sortOrder: number;
}

export interface ModifierGroupDetail extends Omit<ModifierGroup, 'modifierCount'> {
  modifiers: Modifier[];
}

/** Attached modifier group as returned on an item's detail. */
export interface ItemDetail extends MenuItem {
  description: string | null;
  modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number | null; required: boolean; sortOrder: number }>;
}

export interface InventoryProduct {
  id: string;
  sku: string;
  name: string;
  unit: string | null;
  onHand: number;
}

export interface RecipeIngredient {
  id: string;
  productId: string;
  sku: string;
  name: string;
  qtyPerYieldMilli: number;
  unit: string | null;
  wasteBp: number;
  unitCost: Money;
}

export interface Recipe {
  id: string;
  itemId: string;
  itemName: string;
  yieldQty: number;
  instructions: string | null;
  status: string;
  ingredients: RecipeIngredient[];
}

/** Estimated COGS for one serving: Σ ceil(qty × (1 + waste)) × per-unit cost, over ingredients. */
export function recipeCostMinor(recipe: Recipe): number {
  return recipe.ingredients.reduce((sum, i) => {
    const consumed = Math.round((i.qtyPerYieldMilli / Math.max(1, recipe.yieldQty)) * (1 + i.wasteBp / 10000));
    return sum + consumed * i.unitCost.amountMinor;
  }, 0);
}

export const DELIVERY_PROVIDERS = ['OWN', 'FOODPANDA', 'UBER_EATS', 'TALABAT', 'CAREEM'] as const;
export const ORDER_CHANNELS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'DRIVE_THRU', 'AGGREGATOR'] as const;
export const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'WAITING'] as const;
export const TABLE_SHAPES = ['SQUARE', 'ROUND', 'RECT', 'OVAL'] as const;
export const AREA_KINDS = ['INDOOR', 'OUTDOOR', 'VIP', 'TERRACE', 'GARDEN', 'PRIVATE_ROOM'] as const;

// ── Shared bits ─────────────────────────────────────────────────────────────────
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** One badge component for every restaurant state machine — table, order, KDS, delivery, reservation. */
const STATUS_TONE: Record<string, string> = {
  // Green — healthy / done
  AVAILABLE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  READY: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  DELIVERED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  SETTLED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  CLOSED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  CONFIRMED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  // Sky — in progress
  OCCUPIED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  PREPARING: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  EN_ROUTE: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  PICKED_UP: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  SEATED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  PLACED: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  // Amber — waiting / attention
  RESERVED: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  WAITING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  WAITLIST: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  QUEUED: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  CLEANING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  ASSIGNED: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  OPEN: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  BOOKED: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  // Rose — failed / cancelled
  VOID: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  FAILED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  CANCELLED: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
  NO_SHOW: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Spinner() {
  return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
}
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</p>;
}

/** True when a stored imageKey is already a full URL we can render directly (demo images / CDN). */
export function imageSrc(imageKey: string | null | undefined): string | null {
  if (!imageKey) return null;
  return /^https?:\/\//.test(imageKey) ? imageKey : null;
}

/**
 * A food thumbnail with a graceful, on-brand fallback: renders the photo when present (and not broken),
 * otherwise a warm gradient tile with the dish initial — so the menu always looks finished.
 */
export function FoodThumb({ src, name, size = 44, rounded = 'rounded-lg' }: { src: string | null; name: string; size?: number; rounded?: string }) {
  const [broken, setBroken] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '•';
  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className={`${rounded} shrink-0 object-cover ring-1 ring-border`}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className={`${rounded} flex shrink-0 items-center justify-center bg-gradient-to-br from-amber-100 to-orange-200 text-sm font-bold text-orange-700 ring-1 ring-border dark:from-amber-500/20 dark:to-orange-500/20 dark:text-orange-300`}
    >
      {size >= 40 ? initial : <UtensilsCrossed className="h-3.5 w-3.5" />}
    </div>
  );
}

/** A small pulsing "live" indicator for realtime views. */
export function LiveDot({ label = 'live' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {label}
    </span>
  );
}
