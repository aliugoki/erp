import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  EVENT_TYPES,
  type RestaurantBillSettledV1,
  type RestaurantOrderConfirmedV1,
  type RestaurantOrderPlacedV1,
  type RestaurantOrderVoidedV1,
} from '@metaxperts/shared';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { InventoryDocsService } from '../inventory/inventory-docs.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  AddOrderItemsDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  SettleOrderDto,
  VoidOrderDto,
} from './dto/restaurant.dto';
import { DOC_PREFIX, type Row, computeMenuLine, formatDocNo, money, opensDeliveryJob, recipeConsumedMilli, rowsOf } from './restaurant.util';
import { RestaurantDeliveryService } from './delivery.service';
import { RestaurantMenuService } from './menu.service';
import { RestaurantPrintService } from './printing/print.service';

type Mgr = EntityManager;

const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const TENANT = `current_setting('app.tenant_id')::uuid`;
const EDITABLE = ['DRAFT', 'PLACED', 'CONFIRMED', 'IN_PROGRESS'];
const SETTLEABLE = ['PLACED', 'CONFIRMED', 'IN_PROGRESS', 'READY', 'SERVED'];
const DEFAULT_STATION = 'MAIN';

/**
 * The restaurant order lifecycle (ADR-011 §5): DRAFT → PLACED → CONFIRMED → … → SETTLED, plus VOID.
 * All money is integer minor units; lines are priced with {@link computeMenuLine}. Confirming an order
 * routes its items to per-station KDS tickets (the KDS service drives them ready/bumped). Settlement
 * records payments and emits the rich `restaurant.bill_settled` event that GL posting, inventory
 * deduction and fiscalization consume in later phases — via the transactional outbox, never inline.
 */
@Injectable()
export class RestaurantOrderService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryDocsService,
    private readonly menu: RestaurantMenuService,
    private readonly print: RestaurantPrintService,
    private readonly delivery: RestaurantDeliveryService,
  ) {}

  private async nextDocNo(m: Mgr, docType: string, prefix: string): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO restaurant_doc_seq (tenant_id, doc_type, last_no) VALUES (${TENANT}, $1, 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = restaurant_doc_seq.last_no + 1 RETURNING last_no`,
      [docType],
    )) as Array<{ last_no: string }>;
    return formatDocNo(prefix, Number(seq[0]!.last_no));
  }

  private async branchConfig(m: Mgr, branchId: string | null) {
    const rows = (await m.query(
      `SELECT currency, default_tax_bp, service_charge_bp, rounding_enabled
       FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    const r = rows[0];
    return {
      currency: (r?.currency as string) ?? 'PKR',
      defaultTaxBp: r ? Number(r.default_tax_bp) : 0,
      serviceChargeBp: r ? Number(r.service_charge_bp) : 0,
      roundingEnabled: r ? Boolean(r.rounding_enabled) : false,
    };
  }

  // ── Create ──────────────────────────────────────────────────────────────────────
  async create(dto: CreateOrderDto) {
    return this.tenantTx.run(async (m) => {
      const branchId = dto.branchId ?? null;
      if (branchId) {
        const b = (await m.query(`SELECT id FROM branch WHERE id=$1 AND deleted_at IS NULL`, [branchId])) as Row[];
        if (!b[0]) throw new BadRequestException('Unknown branch for this tenant');
        await this.menu.ensureConfigForBranch(m, branchId);
      }
      const cfg = await this.branchConfig(m, branchId);
      const channel = dto.channel ?? 'DINE_IN';
      if (dto.tableId) {
        const t = (await m.query(`SELECT status, merged_into_id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`, [dto.tableId])) as Row[];
        if (!t[0]) throw new BadRequestException('Unknown table for this tenant');
        if (t[0].merged_into_id) throw new UnprocessableEntityException('Table is merged into another; open the order on the primary');
      }
      const orderNo = await this.nextDocNo(m, 'ORD', DOC_PREFIX.ORD);
      let id: string;
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_order
             (tenant_id, branch_id, order_no, channel, table_id, customer_id, waiter_employee_id, guest_count, status, currency, notes,
              delivery_address, delivery_geo_lat, delivery_geo_lng)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,$6, COALESCE($7,1), 'DRAFT', $8, $9, $10,$11,$12) RETURNING id`,
          [
            branchId, orderNo, channel, dto.tableId ?? null, dto.customerId ?? null, dto.waiterEmployeeId ?? null, dto.guestCount ?? null,
            cfg.currency, dto.notes ?? null, dto.address?.trim() || null, dto.geoLat ?? null, dto.geoLng ?? null,
          ],
        )) as Row[];
        id = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown table for this tenant');
        throw err;
      }
      if (dto.tableId) await this.setTableStatusRaw(m, dto.tableId, 'OCCUPIED');
      return this.getInTx(m, id);
    });
  }

  // ── Add items ─────────────────────────────────────────────────────────────────--
  async addItems(orderId: string, dto: AddOrderItemsDto) {
    return this.tenantTx.run(async (m) => {
      const order = await this.loadHeader(m, orderId);
      if (!EDITABLE.includes(order.status)) throw new UnprocessableEntityException(`Cannot add items to a ${order.status} order`);
      const cfg = await this.branchConfig(m, order.branchId);

      for (const line of dto.items) {
        const item = (await m.query(
          `SELECT i.id, i.name, i.base_price_minor, i.tax_bp, i.station_key, i.available, i.status,
                  b.price_minor AS branch_price_minor, b.available AS branch_available
           FROM restaurant_menu_item i
           LEFT JOIN restaurant_menu_item_branch b ON b.item_id = i.id AND b.branch_id IS NOT DISTINCT FROM $2
           WHERE i.id=$1 AND i.deleted_at IS NULL`,
          [line.itemId, order.branchId],
        )) as Row[];
        if (!item[0]) throw new BadRequestException(`Menu item ${line.itemId} not found for this tenant`);
        const it = item[0];
        if (it.status !== 'ACTIVE' || !it.available || it.branch_available === false) {
          throw new UnprocessableEntityException(`Menu item "${it.name}" is not available`);
        }
        const qty = line.qty ?? 1;
        const unitPriceMinor = it.branch_price_minor == null ? Number(it.base_price_minor) : Number(it.branch_price_minor);
        const taxBp = it.tax_bp == null ? cfg.defaultTaxBp : Number(it.tax_bp);

        // Resolve chosen modifiers → snapshot name + price delta (per unit).
        const chosen: Array<{ id: string; name: string; delta: number; qty: number }> = [];
        for (const mod of line.modifiers ?? []) {
          const mrow = (await m.query(
            `SELECT id, name, price_delta_minor, available FROM restaurant_modifier WHERE id=$1 AND deleted_at IS NULL`,
            [mod.modifierId],
          )) as Row[];
          if (!mrow[0]) throw new BadRequestException(`Modifier ${mod.modifierId} not found for this tenant`);
          if (!mrow[0].available) throw new UnprocessableEntityException(`Modifier "${mrow[0].name}" is not available`);
          chosen.push({ id: mrow[0].id as string, name: mrow[0].name as string, delta: Number(mrow[0].price_delta_minor), qty: mod.qty ?? 1 });
        }
        const modifierUnitMinor = chosen.reduce((s, c) => s + c.delta * c.qty, 0);
        const priced = computeMenuLine({ qty, unitPriceMinor, modifierUnitMinor, discountMinor: line.discountMinor, taxBp });

        const oi = (await m.query(
          `INSERT INTO restaurant_order_item
             (tenant_id, order_id, item_id, product_id, name, station_key, qty, course, unit_price_minor,
              modifier_total_minor, discount_minor, tax_minor, line_total_minor, status, kitchen_notes)
           VALUES (${TENANT}, $1,$2,(SELECT product_id FROM restaurant_menu_item WHERE id=$2),$3,$4,$5,COALESCE($6,1),$7,$8,$9,$10,$11,'NEW',$12)
           RETURNING id`,
          [
            orderId, line.itemId, it.name, (it.station_key as string) ?? null, qty, line.course ?? null,
            unitPriceMinor, modifierUnitMinor * qty, priced.discountMinor, priced.taxMinor, priced.lineTotalMinor, line.kitchenNotes ?? null,
          ],
        )) as Row[];
        const orderItemId = oi[0]!.id as string;
        for (const c of chosen) {
          await m.query(
            `INSERT INTO restaurant_order_item_modifier (tenant_id, order_item_id, modifier_id, name, price_delta_minor, qty)
             VALUES (${TENANT}, $1,$2,$3,$4,$5)`,
            [orderItemId, c.id, c.name, c.delta, c.qty],
          );
        }
      }
      await this.recomputeTotals(m, orderId, order.branchId);
      return this.getInTx(m, orderId);
    });
  }

  async voidItem(orderId: string, itemId: string) {
    return this.tenantTx.run(async (m) => {
      const order = await this.loadHeader(m, orderId);
      if (!EDITABLE.includes(order.status)) throw new UnprocessableEntityException(`Cannot modify a ${order.status} order`);
      const res = rowsOf(await m.query(
        `UPDATE restaurant_order_item SET status='VOID', updated_at=now() WHERE id=$1 AND order_id=$2 AND status <> 'VOID' RETURNING id`,
        [itemId, orderId],
      ));
      if (!res[0]) throw new NotFoundException('Order item not found');
      await this.recomputeTotals(m, orderId, order.branchId);
      return this.getInTx(m, orderId);
    });
  }

  // ── Place / confirm ───────────────────────────────────────────────────────────--
  async place(orderId: string) {
    return this.tenantTx.run(async (m) => {
      const order = await this.loadHeader(m, orderId);
      if (order.status !== 'DRAFT') throw new UnprocessableEntityException(`Only a DRAFT order can be placed (is ${order.status})`);
      const count = await this.itemCount(m, orderId);
      if (count === 0) throw new UnprocessableEntityException('Cannot place an empty order');
      await m.query(`UPDATE restaurant_order SET status='PLACED', placed_at=now(), updated_at=now() WHERE id=$1`, [orderId]);
      const placed: RestaurantOrderPlacedV1 = {
        orderId, orderNo: order.orderNo, branchId: order.branchId, channel: order.channel,
        tableId: order.tableId, guestCount: order.guestCount, totalMinor: order.totalMinor, currency: order.currency, itemCount: count,
      };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_ORDER_PLACED, placed);

      const autoFire = (await m.query(
        `SELECT auto_fire_kitchen FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
        [order.branchId],
      )) as Row[];
      if (!autoFire[0] || Boolean(autoFire[0].auto_fire_kitchen)) {
        await this.confirmInTx(m, orderId);
      }

      // Hand a delivery order to dispatch the moment it is placed. Nothing opened this job before —
      // `POST /restaurant/deliveries` existed but had no caller anywhere — so a DELIVERY order cooked,
      // reached SERVED when the kitchen bumped its last ticket, and then stopped: no row in
      // restaurant_delivery, nothing on the branch's delivery board, nothing on any rider's phone.
      //
      // Opened here rather than at SERVED so a dispatcher can put a rider's name against the job while
      // the food is still cooking; the job sits PENDING until they do, and the rider cannot pick up
      // before the kitchen has bumped it either way. Same transaction as the place, so an order and
      // its run commit together or not at all.
      if (opensDeliveryJob(order.channel)) {
        await this.delivery.openForOrderInTx(m, { orderId });
      }
      return this.getInTx(m, orderId);
    });
  }

  async confirm(orderId: string) {
    return this.tenantTx.run(async (m) => {
      await this.confirmInTx(m, orderId);
      return this.getInTx(m, orderId);
    });
  }

  /** Route the order's live items to per-station KDS tickets and advance to CONFIRMED. */
  private async confirmInTx(m: Mgr, orderId: string) {
    const order = await this.loadHeader(m, orderId);
    if (!['PLACED', 'CONFIRMED', 'IN_PROGRESS'].includes(order.status)) {
      throw new UnprocessableEntityException(`Cannot confirm a ${order.status} order`);
    }
    // Un-ticketed live items (NEW) grouped by station.
    const items = (await m.query(
      `SELECT oi.id, oi.name, oi.qty, COALESCE(oi.station_key, $2) AS station_key,
              COALESCE(mi.prep_minutes, 0) AS prep_minutes,
              (SELECT string_agg(md.name, ', ') FROM restaurant_order_item_modifier md WHERE md.order_item_id = oi.id) AS mods
       FROM restaurant_order_item oi LEFT JOIN restaurant_menu_item mi ON mi.id = oi.item_id
       WHERE oi.order_id=$1 AND oi.status='NEW'`,
      [orderId, DEFAULT_STATION],
    )) as Row[];
    const byStation = new Map<string, Row[]>();
    for (const it of items) {
      const key = it.station_key as string;
      (byStation.get(key) ?? byStation.set(key, []).get(key)!).push(it);
    }
    const stations: string[] = [];
    for (const [stationKey, rows] of byStation) {
      const ticketNo = await this.nextDocNo(m, 'KOT', DOC_PREFIX.KOT);
      const target = rows.reduce((mx, r) => Math.max(mx, Number(r.prep_minutes)), 0);
      const ticket = (await m.query(
        `INSERT INTO restaurant_kds_ticket (tenant_id, order_id, branch_id, station_key, ticket_no, priority, status, target_minutes)
         VALUES (${TENANT}, $1,$2,$3,$4,'NORMAL','QUEUED',$5) RETURNING id`,
        [orderId, order.branchId, stationKey, ticketNo, target || null],
      )) as Row[];
      const ticketId = ticket[0]!.id as string;
      for (const r of rows) {
        await m.query(
          `INSERT INTO restaurant_kds_ticket_item (tenant_id, ticket_id, order_item_id, name, qty, modifiers_text, status)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,'QUEUED')`,
          [ticketId, r.id, r.name, r.qty, (r.mods as string) ?? null],
        );
        await m.query(`UPDATE restaurant_order_item SET status='FIRED', updated_at=now() WHERE id=$1`, [r.id]);
      }
      stations.push(stationKey);
    }
    if (order.status === 'PLACED') {
      await m.query(`UPDATE restaurant_order SET status='CONFIRMED', updated_at=now() WHERE id=$1`, [orderId]);
    }
    const ticketCount = (await m.query(`SELECT count(*)::int AS n FROM restaurant_kds_ticket WHERE order_id=$1`, [orderId])) as Array<{ n: number }>;
    const confirmed: RestaurantOrderConfirmedV1 = { orderId, orderNo: order.orderNo, branchId: order.branchId, ticketCount: ticketCount[0]!.n, stations };
    await this.outbox.write(m, EVENT_TYPES.RESTAURANT_ORDER_CONFIRMED, confirmed);
    // Paper follows the screen: queue each new station ticket in the same transaction that created it,
    // so a KOT on the KDS board always has a matching print job (subject to the branch's auto-print
    // setting). The spool is claimed by the kitchen's print agent — nothing blocks the order here.
    await this.print.enqueueKotsInTx(m, orderId);
  }

  // ── Settle ──────────────────────────────────────────────────────────────────────
  async settle(orderId: string, dto: SettleOrderDto) {
    return this.tenantTx.run(async (m) => {
      const order = await this.loadHeader(m, orderId);
      if (!SETTLEABLE.includes(order.status)) throw new UnprocessableEntityException(`Cannot settle a ${order.status} order`);
      // Explode recipes → deduct the shared inventory ledger + capture weighted-average COGS (once, at
      // settlement) BEFORE totals are computed, so the emitted bill carries a real cogsMinor.
      await this.deductInventory(m, orderId, order.branchId, order.orderNo);
      const tip = dto.tipMinor ?? dto.payments.reduce((s, p) => s + (p.tipMinor ?? 0), 0);
      const totals = await this.recomputeTotals(m, orderId, order.branchId, { tipMinor: tip, extraDiscountMinor: dto.discountMinor ?? 0 });
      const paid = dto.payments.reduce((s, p) => s + p.amountMinor, 0);
      if (paid < totals.totalMinor) {
        throw new UnprocessableEntityException(`Payments (${paid}) are less than the total due (${totals.totalMinor})`);
      }
      for (const p of dto.payments) {
        await m.query(
          `INSERT INTO restaurant_payment (tenant_id, order_id, method, amount_minor, tip_minor, reference, status)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,'CAPTURED')`,
          [orderId, p.method, p.amountMinor, p.tipMinor ?? 0, p.reference ?? null],
        );
      }
      await m.query(
        `UPDATE restaurant_order SET status='SETTLED', paid_minor=$2, settled_at=now(), updated_at=now() WHERE id=$1`,
        [orderId, paid],
      );
      if (order.tableId) await this.setTableStatusRaw(m, order.tableId, 'CLEANING');

      const settled: RestaurantBillSettledV1 = {
        orderId, orderNo: order.orderNo, branchId: order.branchId, channel: order.channel, customerId: order.customerId,
        subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, serviceChargeMinor: totals.serviceChargeMinor,
        taxMinor: totals.taxMinor, tipMinor: totals.tipMinor, roundingMinor: totals.roundingMinor, totalMinor: totals.totalMinor,
        cogsMinor: totals.cogsMinor, currency: order.currency,
        payments: dto.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor, tipMinor: p.tipMinor ?? 0 })),
      };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_BILL_SETTLED, settled);
      // Guest bill — only when the branch asks for it automatically; tills that print on demand call
      // POST /orders/:id/print instead. Queued in-transaction so a settled bill and its receipt commit
      // together. NOTE: the fiscal number is stamped asynchronously, so an auto-printed slip may carry
      // the order barcode rather than the tax QR; the reprint after fiscalisation carries both.
      await this.print.enqueueBillInTx(m, orderId);
      return this.getInTx(m, orderId);
    });
  }

  // ── Void ────────────────────────────────────────────────────────────────────────
  async void(orderId: string, dto: VoidOrderDto) {
    return this.tenantTx.run(async (m) => {
      const order = await this.loadHeader(m, orderId);
      if (!EDITABLE.includes(order.status)) throw new UnprocessableEntityException(`Cannot void a ${order.status} order`);
      await m.query(`UPDATE restaurant_kds_ticket SET status='CANCELLED', updated_at=now() WHERE order_id=$1 AND status NOT IN ('BUMPED','CANCELLED')`, [orderId]);
      await m.query(`UPDATE restaurant_order_item SET status='VOID', updated_at=now() WHERE order_id=$1 AND status <> 'VOID'`, [orderId]);
      await m.query(`UPDATE restaurant_order SET status='VOID', updated_at=now() WHERE id=$1`, [orderId]);
      if (order.tableId) await this.setTableStatusRaw(m, order.tableId, 'CLEANING');
      const voided: RestaurantOrderVoidedV1 = { orderId, orderNo: order.orderNo, branchId: order.branchId, reason: dto.reason ?? null };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_ORDER_VOIDED, voided);
      return this.getInTx(m, orderId);
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────--
  async get(orderId: string) {
    return this.tenantTx.run((m) => this.getInTx(m, orderId));
  }

  async list(query: ListOrdersQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['o.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`o.branch_id = $${params.push(query.branchId)}`);
      if (query.status) conds.push(`o.status = $${params.push(query.status)}`);
      if (query.channel) conds.push(`o.channel = $${params.push(query.channel)}`);
      if (query.tableId) conds.push(`o.table_id = $${params.push(query.tableId)}`);
      const rows = (await m.query(
        `SELECT o.id, o.order_no, o.branch_id, o.channel, o.status, o.currency, o.guest_count, o.total_minor,
                t.code AS table_code, count(i.id) FILTER (WHERE i.status <> 'VOID')::int AS item_count
         FROM restaurant_order o
         LEFT JOIN restaurant_table t ON t.id = o.table_id
         LEFT JOIN restaurant_order_item i ON i.order_id = o.id
         WHERE ${conds.join(' AND ')} GROUP BY o.id, t.code ORDER BY o.created_at DESC LIMIT 200`,
        params,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, orderNo: r.order_no, branchId: r.branch_id ?? null, channel: r.channel, status: r.status,
        table: r.table_code ?? null, guestCount: Number(r.guest_count), itemCount: Number(r.item_count),
        total: money(r.total_minor, r.currency as string),
      }));
    });
  }

  private async getInTx(m: Mgr, orderId: string) {
    const h = (await m.query(
      `SELECT o.id, o.order_no, o.branch_id, o.channel, o.table_id, o.customer_id, o.waiter_employee_id,
              o.guest_count, o.status, o.currency, o.subtotal_minor, o.discount_minor, o.service_charge_minor,
              o.tax_minor, o.tip_minor, o.rounding_minor, o.total_minor, o.cogs_minor, o.paid_minor, o.notes,
              o.delivery_address, o.delivery_geo_lat, o.delivery_geo_lng,
              o.placed_at, o.settled_at, t.code AS table_code
       FROM restaurant_order o LEFT JOIN restaurant_table t ON t.id = o.table_id
       WHERE o.id=$1 AND o.deleted_at IS NULL`,
      [orderId],
    )) as Row[];
    if (!h[0]) throw new NotFoundException('Order not found');
    const o = h[0];
    const cur = o.currency as string;
    const items = (await m.query(
      `SELECT id, item_id, name, station_key, qty, course, unit_price_minor, modifier_total_minor,
              discount_minor, tax_minor, line_total_minor, status, kitchen_notes
       FROM restaurant_order_item WHERE order_id=$1 ORDER BY created_at`,
      [orderId],
    )) as Row[];
    const mods = (await m.query(
      `SELECT order_item_id, name, price_delta_minor, qty FROM restaurant_order_item_modifier
       WHERE order_item_id IN (SELECT id FROM restaurant_order_item WHERE order_id=$1)`,
      [orderId],
    )) as Row[];
    const tickets = (await m.query(
      `SELECT id, station_key, ticket_no, priority, status, chef_employee_id, target_minutes, fired_at, ready_at, bumped_at
       FROM restaurant_kds_ticket WHERE order_id=$1 ORDER BY created_at`,
      [orderId],
    )) as Row[];
    const payments = (await m.query(
      `SELECT id, method, amount_minor, tip_minor, reference, status FROM restaurant_payment WHERE order_id=$1 ORDER BY created_at`,
      [orderId],
    )) as Row[];
    const modsByItem = new Map<string, Row[]>();
    for (const md of mods) (modsByItem.get(md.order_item_id as string) ?? modsByItem.set(md.order_item_id as string, []).get(md.order_item_id as string)!).push(md);

    return {
      id: o.id, orderNo: o.order_no, branchId: o.branch_id ?? null, channel: o.channel, tableId: o.table_id ?? null,
      table: o.table_code ?? null, customerId: o.customer_id ?? null, waiterEmployeeId: o.waiter_employee_id ?? null,
      guestCount: Number(o.guest_count), status: o.status, currency: cur, notes: o.notes ?? null,
      address: o.delivery_address ?? null,
      location: o.delivery_geo_lat == null ? null : { lat: Number(o.delivery_geo_lat), lng: Number(o.delivery_geo_lng) },
      totals: {
        subtotal: money(o.subtotal_minor, cur), discount: money(o.discount_minor, cur), serviceCharge: money(o.service_charge_minor, cur),
        tax: money(o.tax_minor, cur), tip: money(o.tip_minor, cur), rounding: money(o.rounding_minor, cur),
        total: money(o.total_minor, cur), cogs: money(o.cogs_minor, cur), paid: money(o.paid_minor, cur),
      },
      placedAt: o.placed_at ?? null, settledAt: o.settled_at ?? null,
      items: items.map((i) => ({
        id: i.id, itemId: i.item_id ?? null, name: i.name, stationKey: i.station_key ?? null, qty: Number(i.qty),
        course: Number(i.course), unitPrice: money(i.unit_price_minor, cur), modifierTotal: money(i.modifier_total_minor, cur),
        discount: money(i.discount_minor, cur), tax: money(i.tax_minor, cur), lineTotal: money(i.line_total_minor, cur),
        status: i.status, kitchenNotes: i.kitchen_notes ?? null,
        modifiers: (modsByItem.get(i.id as string) ?? []).map((md) => ({ name: md.name, priceDelta: money(md.price_delta_minor, cur), qty: Number(md.qty) })),
      })),
      tickets: tickets.map((t) => ({
        id: t.id, stationKey: t.station_key, ticketNo: t.ticket_no, priority: t.priority, status: t.status,
        chefEmployeeId: t.chef_employee_id ?? null, targetMinutes: t.target_minutes == null ? null : Number(t.target_minutes),
        firedAt: t.fired_at ?? null, readyAt: t.ready_at ?? null, bumpedAt: t.bumped_at ?? null,
      })),
      payments: payments.map((p) => ({ id: p.id, method: p.method, amount: money(p.amount_minor, cur), tip: money(p.tip_minor, cur), reference: p.reference ?? null, status: p.status })),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────────────
  private async loadHeader(m: Mgr, orderId: string) {
    const rows = (await m.query(
      `SELECT id, order_no, branch_id, channel, table_id, customer_id, guest_count, status, currency, total_minor
       FROM restaurant_order WHERE id=$1 AND deleted_at IS NULL`,
      [orderId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Order not found');
    const r = rows[0];
    return {
      id: r.id as string, orderNo: r.order_no as string, branchId: (r.branch_id as string) ?? null, channel: r.channel as string,
      tableId: (r.table_id as string) ?? null, customerId: (r.customer_id as string) ?? null, guestCount: Number(r.guest_count),
      status: r.status as string, currency: r.currency as string, totalMinor: Number(r.total_minor),
    };
  }

  private async itemCount(m: Mgr, orderId: string): Promise<number> {
    const r = (await m.query(`SELECT count(*)::int AS n FROM restaurant_order_item WHERE order_id=$1 AND status <> 'VOID'`, [orderId])) as Array<{ n: number }>;
    return r[0]!.n;
  }

  /** Recompute order aggregates from live (non-void) items; optionally fold in tip + a settle discount. */
  private async recomputeTotals(m: Mgr, orderId: string, branchId: string | null, opts: { tipMinor?: number; extraDiscountMinor?: number } = {}) {
    const cfg = await this.branchConfig(m, branchId);
    const agg = (await m.query(
      `SELECT COALESCE(SUM(unit_price_minor*qty + modifier_total_minor),0)::bigint AS gross,
              COALESCE(SUM(discount_minor),0)::bigint AS discount,
              COALESCE(SUM(tax_minor),0)::bigint AS tax,
              COALESCE(SUM(cogs_minor),0)::bigint AS cogs
       FROM restaurant_order_item WHERE order_id=$1 AND status <> 'VOID'`,
      [orderId],
    )) as Row[];
    const gross = Number(agg[0]!.gross);
    const lineDiscount = Number(agg[0]!.discount);
    const tax = Number(agg[0]!.tax);
    const cogs = Number(agg[0]!.cogs);
    const taxable = gross - lineDiscount;
    const serviceCharge = Math.floor((taxable * cfg.serviceChargeBp) / 10000);
    const tip = Math.max(0, opts.tipMinor ?? 0);
    const extraDiscount = Math.min(Math.max(0, opts.extraDiscountMinor ?? 0), taxable + tax + serviceCharge);
    const preRound = taxable + tax + serviceCharge + tip - extraDiscount;
    const rounded = cfg.roundingEnabled ? Math.round(preRound / 100) * 100 : preRound;
    const rounding = rounded - preRound;
    const totalDiscount = lineDiscount + extraDiscount;
    await m.query(
      `UPDATE restaurant_order SET subtotal_minor=$2, discount_minor=$3, service_charge_minor=$4, tax_minor=$5,
              tip_minor=$6, rounding_minor=$7, total_minor=$8, cogs_minor=$9, updated_at=now() WHERE id=$1`,
      [orderId, gross, totalDiscount, serviceCharge, tax, tip, rounding, rounded, cogs],
    );
    return {
      subtotalMinor: gross, discountMinor: totalDiscount, serviceChargeMinor: serviceCharge, taxMinor: tax,
      tipMinor: tip, roundingMinor: rounding, totalMinor: rounded, cogsMinor: cogs,
    };
  }

  private async setTableStatusRaw(m: Mgr, tableId: string, status: string) {
    await m.query(`UPDATE restaurant_table SET status=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, [tableId, status]);
  }

  /**
   * Explode every live order line's recipe and decrement the shared inventory ledger (FEFO/weighted-avg
   * lives in InventoryDocsService), capturing COGS per line. Ingredient consumption scales pro-rata with
   * the ordered quantity + waste (recipeConsumedMilli). Lines without a recipe simply don't move stock.
   * Runs inside the settle transaction so stock, COGS and the bill commit atomically.
   */
  private async deductInventory(m: Mgr, orderId: string, branchId: string | null, orderNo: string) {
    const wh = (await m.query(
      `SELECT default_warehouse_id FROM restaurant_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    const warehouseId = (wh[0]?.default_warehouse_id as string) ?? null;

    const rows = (await m.query(
      `SELECT oi.id AS order_item_id, oi.qty, r.yield_qty, ri.product_id, ri.qty_per_yield_milli, ri.waste_bp
       FROM restaurant_order_item oi
       JOIN restaurant_recipe r ON r.item_id = oi.item_id AND r.deleted_at IS NULL
       JOIN restaurant_recipe_ingredient ri ON ri.recipe_id = r.id AND ri.deleted_at IS NULL
       WHERE oi.order_id=$1 AND oi.status <> 'VOID'`,
      [orderId],
    )) as Row[];

    const cogsByItem = new Map<string, number>();
    for (const r of rows) {
      const consumedMilli = recipeConsumedMilli(Number(r.qty_per_yield_milli), Number(r.qty), Number(r.yield_qty), Number(r.waste_bp));
      if (consumedMilli <= 0) continue;
      // The shared inventory ledger tracks whole integer units (ADR-011: `on_hand` is bigint, no
      // fractional stock). So restaurant ingredients are stocked in their smallest unit (g / ml /
      // piece) and the recipe's milli quantity IS the integer amount consumed in that unit — never a
      // fractional stock unit, which the ledger would reject.
      const qtyOut = consumedMilli;
      const moved = await this.inventory.applyStockMovement(m, {
        productId: r.product_id as string,
        warehouseId,
        docType: 'RESTAURANT_ORDER',
        docId: orderId,
        docNo: orderNo,
        qtyOut,
        narration: `Recipe consumption for ${orderNo}`,
      });
      const lineCost = Math.round(moved.unitCostMinor * qtyOut);
      const key = r.order_item_id as string;
      cogsByItem.set(key, (cogsByItem.get(key) ?? 0) + lineCost);
    }
    for (const [orderItemId, cogs] of cogsByItem) {
      await m.query(`UPDATE restaurant_order_item SET cogs_minor=$2, updated_at=now() WHERE id=$1`, [orderItemId, cogs]);
    }
  }
}
