/** Shared helpers for the restaurant vertical (integer minor units everywhere; ADR-007). */

export type Row = Record<string, unknown>;

/**
 * Normalise what TypeORM's postgres driver hands back from a raw query.
 *
 * For SELECT and INSERT…RETURNING it returns the rows array; for **UPDATE and DELETE it returns
 * `[rows, rowCount]`** instead. That difference is silent and dangerous: `rows[0]` on an UPDATE is the
 * rows *array*, so `if (!rows[0]) throw new NotFoundException()` never fires (an empty array is
 * truthy) and reading `rows[0].status` yields undefined. Every raw UPDATE/DELETE…RETURNING in this
 * module goes through here so "nothing matched" is actually detected.
 */
export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as Row[];
  }
  return (Array.isArray(result) ? result : []) as Row[];
}

/** Wrap a stored minor-unit amount as the API Money envelope. */
export function money(v: unknown, currency = 'PKR') {
  return { amountMinor: Number(v ?? 0), currency };
}

/** Format a per-tenant document number, e.g. ORD-000004. */
export function formatDocNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/** Doc-type → number prefix for the running counter (restaurant_doc_seq). */
export const DOC_PREFIX = {
  ORD: 'ORD', // order
  KOT: 'KOT', // kitchen ticket
  RES: 'RES', // reservation
  DLV: 'DLV', // delivery job
  INV: 'RINV', // fiscal / customer invoice
} as const;

export type ServiceModel = 'DINE_IN' | 'QSR' | 'CAFE' | 'CLOUD_KITCHEN' | 'FOOD_COURT' | 'BUFFET' | 'DRIVE_THRU';
export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | 'WAITING';

/**
 * Legal table-status transitions. Design edits (via the floor designer) set status directly, but the
 * operational endpoint uses this to reject impossible jumps (e.g. CLEANING → OCCUPIED without seating),
 * mirroring the state-machine guards used across the ERP verticals.
 */
export const TABLE_STATUS_TRANSITIONS: Record<TableStatus, TableStatus[]> = {
  AVAILABLE: ['OCCUPIED', 'RESERVED', 'WAITING', 'CLEANING'],
  RESERVED: ['OCCUPIED', 'WAITING', 'AVAILABLE', 'CLEANING'],
  WAITING: ['OCCUPIED', 'AVAILABLE', 'CLEANING'],
  OCCUPIED: ['CLEANING', 'AVAILABLE'],
  CLEANING: ['AVAILABLE'],
};

export function canTransitionTable(from: TableStatus, to: TableStatus): boolean {
  if (from === to) return true;
  return (TABLE_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

export type DeliveryStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'EN_ROUTE'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

/**
 * Legal delivery-job transitions keyed by destination → allowed source states (the shape the service
 * needs when validating a requested move). Own-fleet flow: PENDING → ASSIGNED → PICKED_UP → EN_ROUTE →
 * DELIVERED. A job may be (re)ASSIGNED while PENDING/ASSIGNED, FAILED from any live state, or CANCELLED
 * before pickup. DELIVERED / FAILED / CANCELLED are terminal. Single source of truth for Phase 6.
 */
export const DELIVERY_STATUS_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: [],
  ASSIGNED: ['PENDING', 'ASSIGNED'],
  PICKED_UP: ['ASSIGNED'],
  EN_ROUTE: ['PICKED_UP'],
  DELIVERED: ['PICKED_UP', 'EN_ROUTE'],
  FAILED: ['PENDING', 'ASSIGNED', 'PICKED_UP', 'EN_ROUTE'],
  CANCELLED: ['PENDING', 'ASSIGNED'],
};

/** True when a delivery job may move `from` → `to`. Terminal states have no outgoing moves. */
export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return (DELIVERY_STATUS_TRANSITIONS[to] ?? []).includes(from);
}

/**
 * True when placing an order of this channel should open an own-fleet delivery job.
 *
 * Only `DELIVERY`. `AGGREGATOR` is deliberately excluded even though that food also reaches a
 * doorstep: the rider belongs to Foodpanda/Careem, the job is created carrying their provider and
 * `externalRef` when their integration ingests it, and minting an `OWN` job alongside would put a
 * phantom run on the branch's board with an OTP no customer will ever be told. `TAKEAWAY`,
 * `DRIVE_THRU` and `DINE_IN` leave with the guest.
 */
export function opensDeliveryJob(channel: string): boolean {
  return channel === 'DELIVERY';
}

/** Pakistan's country code — the default for a bare local number. */
const DEFAULT_COUNTRY_CODE = '92';

/**
 * Reduce a typed phone number to the single form a customer is keyed on.
 *
 * A customer is identified by phone, so every spelling of one number must collapse to one value or
 * the same person becomes three records and loses their history and saved addresses between orders.
 * Real inputs for a single Lahore mobile: `0300 123 4567`, `+92 300 1234567`, `92-300-1234567`,
 * `(0300) 1234567`.
 *
 * Rules: drop everything that is not a digit; a leading `00` is the international prefix and goes; a
 * leading `0` is the national trunk prefix and is replaced by the country code; a number already
 * carrying the country code is left alone. Stored as `+<digits>`.
 *
 * Returns null for anything too short or too long to dial, so a typo is a clean rejection rather than
 * a customer record nobody can match again.
 */
export function normalisePhone(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!input) return null;
  let digits = input.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = countryCode + digits.replace(/^0+/, '');
  else if (!digits.startsWith(countryCode) && digits.length <= 10) digits = countryCode + digits;
  // E.164 caps a number at 15 digits; under 8 cannot be dialable once a country code is included.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Reduce a typed search term to digits that will actually match a stored phone.
 *
 * Staff search for the number the way the customer says it on the phone — "0300 123" — but the stored
 * form is `+923001234567`, where that leading `0` has already become `92`. The literal digits
 * `0300123` therefore appear nowhere in the stored value and a substring search finds nothing, which
 * is exactly what a counter would report as "the system can't find my customer".
 *
 * Stripping the international prefix, the country code and the trunk `0` leaves the national
 * significant number (`300123`), which IS a substring of the stored digits — so a partial search
 * works from either spelling. Returns null when the term has no digits, so a name search is not
 * silently turned into a phone search for nothing.
 */
export function phoneSearchKey(input: string | null | undefined, countryCode = DEFAULT_COUNTRY_CODE): string | null {
  if (!input) return null;
  let digits = input.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(countryCode)) digits = digits.slice(countryCode.length);
  digits = digits.replace(/^0+/, '');
  return digits || null;
}

export type ReservationStatus =
  | 'BOOKED'
  | 'WAITLIST'
  | 'CONFIRMED'
  | 'SEATED'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED';

/**
 * Legal reservation transitions keyed by destination → allowed source states. A booking is BOOKED (or
 * WAITLIST), may be CONFIRMED, then SEATED (also reachable directly via QR check-in), then COMPLETED. It
 * can be marked NO_SHOW or CANCELLED before seating. COMPLETED / NO_SHOW / CANCELLED are terminal.
 * Single source of truth for Phase 7 (imported by the reservation service and exercised by unit tests).
 */
export const RESERVATION_STATUS_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  BOOKED: [],
  WAITLIST: [],
  CONFIRMED: ['BOOKED', 'WAITLIST'],
  SEATED: ['BOOKED', 'CONFIRMED', 'WAITLIST'],
  COMPLETED: ['SEATED'],
  NO_SHOW: ['BOOKED', 'CONFIRMED'],
  CANCELLED: ['BOOKED', 'CONFIRMED', 'WAITLIST'],
};

/** True when a reservation may move `from` → `to`. Terminal states have no outgoing moves. */
export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return (RESERVATION_STATUS_TRANSITIONS[to] ?? []).includes(from);
}

export interface MenuLineInput {
  qty: number;
  unitPriceMinor: number;
  /** Sum of the selected modifiers' price deltas for one unit (can be negative). */
  modifierUnitMinor?: number;
  discountMinor?: number;
  taxBp?: number; // basis points, e.g. 1600 = 16% (typical PRA services rate)
}

export interface ComputedMenuLine {
  grossMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

/**
 * Price one menu line in integer minor units: unit = base price + per-unit modifier deltas (floored at
 * 0), gross = qty × unit, discount clamped to [0, gross], tax = floor(taxable × bp / 10000) on the
 * post-discount amount, line total = taxable + tax. Deterministic; no floats. Used by the order
 * service (Phase 4) and exercised directly by unit tests here.
 */
export function computeMenuLine(line: MenuLineInput): ComputedMenuLine {
  const unitMinor = Math.max(0, line.unitPriceMinor + (line.modifierUnitMinor ?? 0));
  const grossMinor = Math.max(0, Math.trunc(line.qty)) * unitMinor;
  const discountMinor = Math.min(Math.max(line.discountMinor ?? 0, 0), grossMinor);
  const taxableMinor = grossMinor - discountMinor;
  const taxMinor = Math.floor((taxableMinor * Math.max(0, line.taxBp ?? 0)) / 10000);
  return { grossMinor, discountMinor, taxableMinor, taxMinor, lineTotalMinor: taxableMinor + taxMinor };
}

/**
 * Resolve the effective price of a menu item at a branch: the per-branch override when set, otherwise
 * the item's base price. Availability is the AND of item- and branch-level availability.
 */
export function resolveMenuPrice(
  basePriceMinor: number,
  branchPriceMinor: number | null | undefined,
): number {
  return branchPriceMinor == null ? basePriceMinor : branchPriceMinor;
}

/**
 * Quantity of a recipe ingredient consumed by an order line, in **milli-units** (1000 = 1 stock unit).
 * A recipe yields `yieldQty` servings from `qtyPerYieldMilli` of the ingredient; an order line of
 * `lineQty` servings scales that pro-rata, then adds a `wasteBp` allowance (basis points). Integer
 * milli result (rounded) so downstream stock math stays exact. Used by recipe explosion at settlement
 * to decrement the shared inventory ledger and capture COGS.
 */
export function recipeConsumedMilli(
  qtyPerYieldMilli: number,
  lineQty: number,
  yieldQty: number,
  wasteBp = 0,
): number {
  const yieldSafe = Math.max(1, yieldQty);
  const base = (qtyPerYieldMilli * Math.max(0, lineQty)) / yieldSafe;
  const withWaste = (base * (10000 + Math.max(0, wasteBp))) / 10000;
  return Math.round(withWaste);
}
