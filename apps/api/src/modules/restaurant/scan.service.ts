import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { ScanDto, ScanAddDto } from './dto/restaurant.dto';
import { type Row, money } from './restaurant.util';
import { RestaurantOrderService } from './order.service';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * What a scanned string can turn out to be. A single resolve endpoint keeps the client dumb: the
 * waiter app points its camera (or a USB wedge scanner types into a field) and the server decides
 * whether that string is a table sticker, a bill, a kitchen ticket, a booking, a delivery run, a
 * packaged product or an ingredient carton — then tells the client what to do next.
 */
export type ScanKind =
  | 'TABLE'
  | 'ORDER'
  | 'KDS_TICKET'
  | 'RESERVATION'
  | 'DELIVERY'
  | 'MENU_ITEM'
  | 'INVENTORY_PRODUCT';

/** Strip the scheme/prefix wrappers a QR payload may carry: `mx://table/<token>`, `TBL:<token>`, a URL. */
export function normalizeScan(raw: string): { code: string; hint: ScanKind | null } {
  let s = String(raw ?? '').trim();
  if (!s) return { code: '', hint: null };

  // A full URL from a table QR: .../t/<token> or ?table=<token>
  const urlMatch = /^https?:\/\/\S+$/i.test(s);
  if (urlMatch) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get('table') ?? u.searchParams.get('t');
      if (q) return { code: q.trim(), hint: 'TABLE' };
      const seg = u.pathname.split('/').filter(Boolean);
      const last = seg[seg.length - 1];
      if (last) return { code: last.trim(), hint: seg.includes('t') || seg.includes('table') ? 'TABLE' : null };
    } catch {
      /* fall through to the raw string */
    }
  }

  const prefixed = /^(mx:\/\/)?(table|tbl|order|ord|kot|ticket|res|reservation|dlv|delivery|item|sku)[:/]+(.+)$/i.exec(s);
  if (prefixed) {
    const kind = prefixed[2]!.toLowerCase();
    const rest = prefixed[3]!.trim();
    const hint: ScanKind | null =
      kind === 'table' || kind === 'tbl' ? 'TABLE'
      : kind === 'order' || kind === 'ord' ? 'ORDER'
      : kind === 'kot' || kind === 'ticket' ? 'KDS_TICKET'
      : kind === 'res' || kind === 'reservation' ? 'RESERVATION'
      : kind === 'dlv' || kind === 'delivery' ? 'DELIVERY'
      : kind === 'item' || kind === 'sku' ? 'MENU_ITEM'
      : null;
    // "ORD-000012" must not be mangled into "000012" by the ORD: prefix rule.
    if (!/^-/.test(rest)) s = rest;
    if (hint) return { code: s.replace(/^[:/]+/, '').trim(), hint };
  }
  return { code: s, hint: null };
}

/**
 * Barcode / QR resolution for the restaurant floor (ADR-011 §9). Reads only — resolving a code never
 * mutates anything, so a mis-scan is harmless; the caller decides what to do with the answer. Every
 * lookup is tenant-scoped through RLS, so a code from another restaurant simply doesn't resolve.
 */
@Injectable()
export class RestaurantScanService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly orders: RestaurantOrderService,
  ) {}

  async resolve(dto: ScanDto) {
    return this.tenantTx.run(async (m) => {
      const { code, hint } = normalizeScan(dto.code);
      if (!code) throw new NotFoundException('Nothing was scanned');
      const branchId = dto.branchId ?? null;

      // Ordered by how a floor actually scans: table stickers and bills dominate, then the kitchen,
      // then bookings/runs, then products. A hint from the QR prefix jumps its own kind to the front.
      const lookups: Array<[ScanKind, () => Promise<unknown | null>]> = [
        ['TABLE', () => this.table(m, code, branchId)],
        ['ORDER', () => this.order(m, code)],
        ['KDS_TICKET', () => this.ticket(m, code)],
        ['RESERVATION', () => this.reservation(m, code)],
        ['DELIVERY', () => this.delivery(m, code)],
        ['MENU_ITEM', () => this.menuItem(m, code, branchId)],
        ['INVENTORY_PRODUCT', () => this.product(m, code)],
      ];
      if (hint) lookups.sort(([a], [b]) => (a === hint ? -1 : b === hint ? 1 : 0));

      for (const [kind, run] of lookups) {
        const found = await run();
        if (found) return { kind, code, ...(found as object) };
      }
      throw new NotFoundException(`Nothing matches the scanned code "${code}"`);
    });
  }

  /**
   * Scan-to-add at the till: resolve the code to a menu item and put it straight on the open order.
   * This is the packaged-goods path (bottled drinks, cigarettes, retail desserts) where a scanner
   * beats hunting through a menu grid.
   */
  async scanAdd(orderId: string, dto: ScanAddDto) {
    const { code } = normalizeScan(dto.code);
    const item = await this.tenantTx.run(async (m) => {
      const order = (await m.query(`SELECT branch_id FROM restaurant_order WHERE id=$1 AND deleted_at IS NULL`, [orderId])) as Row[];
      if (!order[0]) throw new NotFoundException('Order not found');
      const found = await this.menuItem(m, code, (order[0].branch_id as string) ?? null);
      if (!found) throw new NotFoundException(`No menu item has the barcode "${code}"`);
      return found.item;
    });
    // addItems runs its own transaction — it owns pricing, modifiers and total recomputation, and we
    // must not duplicate that logic here.
    const order = await this.orders.addItems(orderId, { items: [{ itemId: item.id, qty: dto.qty ?? 1 }] });
    return { scanned: code, added: item, order };
  }

  /** Issue (or rotate) a table's QR token — the sticker a guest scans to open that table. */
  async issueTableQr(tableId: string, rotate = false) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, code, qr_token, branch_id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`,
        [tableId],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Table not found');
      let token = (rows[0].qr_token as string) ?? null;
      if (!token || rotate) {
        token = randomBytes(9).toString('base64url'); // 12 opaque chars — not guessable from the table code
        await m.query(`UPDATE restaurant_table SET qr_token=$2, updated_at=now() WHERE id=$1`, [tableId, token]);
      }
      return {
        tableId, code: rows[0].code, branchId: (rows[0].branch_id as string) ?? null,
        token,
        /** What to encode in the QR sticker. Clients may wrap it in their own public ordering URL. */
        payload: `mx://table/${token}`,
      };
    });
  }

  // ── Individual lookups (each returns null when the code isn't theirs) ────────────

  private async table(m: Mgr, code: string, branchId: string | null) {
    const rows = (await m.query(
      `SELECT t.id, t.code, t.status, t.capacity, t.branch_id, a.name AS area_name
       FROM restaurant_table t LEFT JOIN restaurant_floor_area a ON a.id = t.area_id
       WHERE t.deleted_at IS NULL AND t.qr_token = $1 LIMIT 1`,
      [code],
    )) as Row[];
    const t = rows[0];
    if (!t) return null;
    // A table scan is only useful with its live tab attached — that's the whole point at the table.
    const open = (await m.query(
      `SELECT id, order_no, status, total_minor, currency FROM restaurant_order
       WHERE table_id=$1 AND deleted_at IS NULL AND status NOT IN ('SETTLED','VOID')
       ORDER BY created_at DESC LIMIT 1`,
      [t.id],
    )) as Row[];
    return {
      table: {
        id: t.id, code: t.code, status: t.status, capacity: Number(t.capacity),
        branchId: (t.branch_id as string) ?? null, area: (t.area_name as string) ?? null,
      },
      openOrder: open[0]
        ? { id: open[0].id, orderNo: open[0].order_no, status: open[0].status, total: money(open[0].total_minor, open[0].currency as string) }
        : null,
      branchMatches: branchId === null || (t.branch_id as string) === branchId,
    };
  }

  private async order(m: Mgr, code: string) {
    const rows = (await m.query(
      `SELECT o.id, o.order_no, o.status, o.channel, o.total_minor, o.currency, o.branch_id, t.code AS table_code
       FROM restaurant_order o LEFT JOIN restaurant_table t ON t.id = o.table_id
       WHERE o.deleted_at IS NULL AND upper(o.order_no) = upper($1) LIMIT 1`,
      [code],
    )) as Row[];
    const o = rows[0];
    if (!o) return null;
    return {
      order: {
        id: o.id, orderNo: o.order_no, status: o.status, channel: o.channel,
        table: (o.table_code as string) ?? null, branchId: (o.branch_id as string) ?? null,
        total: money(o.total_minor, o.currency as string),
      },
    };
  }

  private async ticket(m: Mgr, code: string) {
    const rows = (await m.query(
      `SELECT t.id, t.ticket_no, t.station_key, t.status, t.order_id, o.order_no
       FROM restaurant_kds_ticket t JOIN restaurant_order o ON o.id = t.order_id
       WHERE t.deleted_at IS NULL AND upper(t.ticket_no) = upper($1) LIMIT 1`,
      [code],
    )) as Row[];
    const t = rows[0];
    if (!t) return null;
    return { ticket: { id: t.id, ticketNo: t.ticket_no, stationKey: t.station_key, status: t.status, orderId: t.order_id, orderNo: t.order_no } };
  }

  private async reservation(m: Mgr, code: string) {
    const rows = (await m.query(
      `SELECT r.id, r.reservation_no, r.status, r.guest_name, r.party_size, r.reserved_for, t.code AS table_code
       FROM restaurant_reservation r LEFT JOIN restaurant_table t ON t.id = r.table_id
       WHERE r.deleted_at IS NULL AND (upper(r.checkin_code) = upper($1) OR upper(r.reservation_no) = upper($1)) LIMIT 1`,
      [code],
    )) as Row[];
    const r = rows[0];
    if (!r) return null;
    return {
      reservation: {
        id: r.id, reservationNo: r.reservation_no, status: r.status, guestName: (r.guest_name as string) ?? null,
        partySize: Number(r.party_size ?? 0), reservedFor: r.reserved_for, table: (r.table_code as string) ?? null,
      },
    };
  }

  private async delivery(m: Mgr, code: string) {
    const rows = (await m.query(
      `SELECT d.id, d.delivery_no, d.status, d.provider, d.address, o.order_no, e.first_name, e.last_name
       FROM restaurant_delivery d
       LEFT JOIN restaurant_order o ON o.id = d.order_id
       LEFT JOIN hr_employee e ON e.id = d.driver_employee_id
       WHERE d.deleted_at IS NULL AND (upper(d.delivery_no) = upper($1) OR upper(COALESCE(d.external_ref,'')) = upper($1)) LIMIT 1`,
      [code],
    )) as Row[];
    const d = rows[0];
    if (!d) return null;
    return {
      delivery: {
        id: d.id, deliveryNo: d.delivery_no, status: d.status, provider: d.provider,
        driverName: d.first_name ? `${d.first_name as string} ${(d.last_name as string) ?? ''}`.trim() : null,
        address: (d.address as string) ?? null,
        orderNo: (d.order_no as string) ?? null,
      },
    };
  }

  private async menuItem(m: Mgr, code: string, branchId: string | null) {
    const rows = (await m.query(
      `SELECT i.id, i.name, i.base_price_minor, i.currency, i.available, i.status, i.image_key, i.barcode, i.sku,
              b.price_minor AS branch_price_minor, b.available AS branch_available
       FROM restaurant_menu_item i
       LEFT JOIN restaurant_menu_item_branch b ON b.item_id = i.id AND b.branch_id IS NOT DISTINCT FROM $2
       WHERE i.deleted_at IS NULL AND (lower(i.barcode) = lower($1) OR lower(i.sku) = lower($1)) LIMIT 1`,
      [code, branchId],
    )) as Row[];
    const i = rows[0];
    if (!i) return null;
    const priceMinor = i.branch_price_minor == null ? Number(i.base_price_minor) : Number(i.branch_price_minor);
    return {
      item: {
        id: i.id as string, name: i.name as string, barcode: (i.barcode as string) ?? null, sku: (i.sku as string) ?? null,
        price: money(priceMinor, i.currency as string), imageKey: (i.image_key as string) ?? null,
        available: Boolean(i.available) && i.branch_available !== false && i.status === 'ACTIVE',
      },
    };
  }

  /**
   * An ingredient carton in the kitchen store. Resolving it here (rather than sending the user to the
   * inventory module) is what makes a single scan field usable everywhere in the restaurant. Matches
   * the shared catalogue's barcode first, then falls back to the SKU — older data recorded the EAN
   * in the SKU field, before products carried a barcode of their own.
   */
  private async product(m: Mgr, code: string) {
    const rows = (await m.query(
      `SELECT id, name, sku, barcode, unit, on_hand FROM inventory_product
       WHERE deleted_at IS NULL AND (lower(barcode) = lower($1) OR lower(sku) = lower($1)) LIMIT 1`,
      [code],
    )) as Row[];
    const p = rows[0];
    if (!p) return null;
    return {
      product: {
        id: p.id, name: p.name, sku: (p.sku as string) ?? null, barcode: (p.barcode as string) ?? null,
        unit: (p.unit as string) ?? null, onHand: Number(p.on_hand ?? 0),
      },
    };
  }
}
