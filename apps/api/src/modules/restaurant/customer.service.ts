import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { RestaurantOrderService } from './order.service';
import type {
  BlockCustomerDto,
  CreateCustomerAddressDto,
  CreateCustomerDto,
  ListCustomersQueryDto,
  PlaceCustomerOrderDto,
  UpdateCustomerAddressDto,
  UpdateCustomerDto,
} from './dto/restaurant.dto';
import { type Row, money, normalisePhone, phoneSearchKey, rowsOf } from './restaurant.util';

type Mgr = EntityManager;
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Customers and their address book.
 *
 * Two callers with very different rights use this: staff on the console (who may list everyone,
 * correct a name, block a nuisance caller) and a signed-in customer on the app (who may only ever
 * touch their own record). The separation is enforced at the controller by which surface the route
 * lives on, and reinforced here by every self-service method taking the customer id from the token
 * rather than from the request body — there is no method that lets a caller name the customer they
 * are acting as.
 *
 * The address book is the part that earns its keep. A returning customer picking "Home" instead of
 * retyping a Gulberg address with a landmark is the difference between a thirty-second reorder and an
 * abandoned basket, and it is why `restaurant_customer_address` carries `directions` — the free text
 * that stops a rider circling a block.
 */
@Injectable()
export class RestaurantCustomerService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly orderService: RestaurantOrderService,
  ) {}

  // ── Staff surface ─────────────────────────────────────────────────────────────
  async create(dto: CreateCustomerDto) {
    const phone = normalisePhone(dto.phone);
    if (!phone) throw new UnprocessableEntityException('That does not look like a phone number');
    return this.tenantTx.run(async (m) => {
      const existing = (await m.query(`SELECT id FROM restaurant_customer WHERE phone=$1 AND deleted_at IS NULL`, [phone])) as Row[];
      // Counter staff taking a phone order should land on the existing customer, not be stopped by a
      // duplicate error and end up making a second record with a typo'd name.
      if (existing[0]) return this.getInTx(m, existing[0].id as string);
      const rows = (await m.query(
        `INSERT INTO restaurant_customer (tenant_id, phone, name, email, marketing_opt_in, notes)
         VALUES (${TENANT}, $1,$2,$3, COALESCE($4,false), $5) RETURNING id`,
        [phone, dto.name?.trim() ?? null, dto.email?.trim() ?? null, dto.marketingOptIn ?? null, dto.notes?.trim() ?? null],
      )) as Row[];
      return this.getInTx(m, rows[0]!.id as string);
    });
  }

  async update(customerId: string, dto: UpdateCustomerDto) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, customerId);
      const sets: string[] = [];
      const params: unknown[] = [customerId];
      const set = (col: string, v: unknown) => {
        if (v === undefined) return;
        sets.push(`${col} = $${params.push(v)}`);
      };
      set('name', dto.name?.trim());
      set('email', dto.email?.trim());
      set('marketing_opt_in', dto.marketingOptIn);
      set('notes', dto.notes?.trim());
      if (dto.phone !== undefined) {
        const phone = normalisePhone(dto.phone);
        if (!phone) throw new UnprocessableEntityException('That does not look like a phone number');
        const clash = (await m.query(
          `SELECT id FROM restaurant_customer WHERE phone=$1 AND id <> $2 AND deleted_at IS NULL`,
          [phone, customerId],
        )) as Row[];
        if (clash[0]) throw new UnprocessableEntityException('Another customer already uses that number');
        set('phone', phone);
      }
      if (sets.length) {
        await m.query(`UPDATE restaurant_customer SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      }
      return this.getInTx(m, customerId);
    });
  }

  /** Block or unblock. Blocking stops new orders; it never hides the history a dispute needs. */
  async setBlocked(customerId: string, dto: BlockCustomerDto) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, customerId);
      await m.query(
        `UPDATE restaurant_customer SET blocked=$2, blocked_reason=$3, updated_at=now() WHERE id=$1`,
        [customerId, dto.blocked, dto.blocked ? (dto.reason?.trim() ?? null) : null],
      );
      return this.getInTx(m, customerId);
    });
  }

  async list(query: ListCustomersQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['c.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.blocked !== undefined) conds.push(`c.blocked = $${params.push(query.blocked)}`);
      if (query.search?.trim()) {
        // Either half of how staff know a customer: the name on the order, or the number ringing the
        // counter. The phone side matches on the *national* number via phoneSearchKey, because staff
        // type "0300 123" while the stored value is +923001234567 — the raw digits of the former are
        // not a substring of the latter, so a naive digit match silently finds nothing.
        const raw = query.search.trim();
        const key = phoneSearchKey(raw);
        const clauses = [`lower(coalesce(c.name,'')) LIKE $${params.push(`%${raw.toLowerCase()}%`)}`];
        if (key) clauses.push(`replace(c.phone,'+','') LIKE $${params.push(`%${key}%`)}`);
        conds.push(`(${clauses.join(' OR ')})`);
      }
      const rows = (await m.query(
        `SELECT c.id, c.phone, c.name, c.email, c.marketing_opt_in, c.blocked, c.blocked_reason,
                c.notes, c.last_order_at, c.last_login_at, c.created_at,
                COALESCE(o.orders, 0)::int AS orders_count,
                COALESCE(o.spend, 0)::bigint AS lifetime_minor,
                COALESCE(a.n, 0)::int AS address_count
           FROM restaurant_customer c
           LEFT JOIN LATERAL (
             SELECT count(*) AS orders, sum(total_minor) AS spend FROM restaurant_order
              WHERE customer_id = c.id AND status = 'SETTLED' AND deleted_at IS NULL
           ) o ON true
           LEFT JOIN LATERAL (
             SELECT count(*) AS n FROM restaurant_customer_address
              WHERE customer_id = c.id AND deleted_at IS NULL
           ) a ON true
          WHERE ${conds.join(' AND ')}
          ORDER BY COALESCE(c.last_order_at, c.created_at) DESC
          LIMIT ${Math.min(query.limit ?? 100, 200)}`,
        params,
      )) as Row[];
      return rows.map((r) => this.view(r));
    });
  }

  async get(customerId: string) {
    return this.tenantTx.run((m) => this.getInTx(m, customerId));
  }

  // ── Self-service surface (customer id always comes from the token) ─────────────
  async profile(customerId: string) {
    return this.tenantTx.run((m) => this.getInTx(m, customerId));
  }

  async updateProfile(customerId: string, dto: UpdateCustomerDto) {
    // A customer may correct their own name and email. Phone is excluded on purpose: it is the
    // identity they authenticated with, and changing it here would silently move the account.
    return this.update(customerId, { name: dto.name, email: dto.email, marketingOptIn: dto.marketingOptIn });
  }

  async addresses(customerId: string) {
    return this.tenantTx.run(async (m) => this.addressesInTx(m, customerId));
  }

  async addAddress(customerId: string, dto: CreateCustomerAddressDto) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, customerId);
      const count = (await m.query(
        `SELECT count(*)::int AS n FROM restaurant_customer_address WHERE customer_id=$1 AND deleted_at IS NULL`,
        [customerId],
      )) as Array<{ n: number }>;
      if (count[0]!.n >= 20) throw new UnprocessableEntityException('That is a lot of addresses — delete one first');
      // First address is the default with no ceremony; nobody wants to tick a box on their first order.
      const makeDefault = dto.isDefault ?? count[0]!.n === 0;
      if (makeDefault) await this.clearDefault(m, customerId);
      const rows = (await m.query(
        `INSERT INTO restaurant_customer_address
           (tenant_id, customer_id, label, address, geo_lat, geo_lng, directions, is_default)
         VALUES (${TENANT}, $1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [customerId, dto.label ?? 'HOME', dto.address.trim(), dto.geoLat ?? null, dto.geoLng ?? null, dto.directions?.trim() ?? null, makeDefault],
      )) as Row[];
      return this.addressView(await this.loadAddress(m, customerId, rows[0]!.id as string));
    });
  }

  async updateAddress(customerId: string, addressId: string, dto: UpdateCustomerAddressDto) {
    return this.tenantTx.run(async (m) => {
      await this.loadAddress(m, customerId, addressId);
      if (dto.isDefault) await this.clearDefault(m, customerId);
      const sets: string[] = [];
      const params: unknown[] = [addressId];
      const set = (col: string, v: unknown) => {
        if (v === undefined) return;
        sets.push(`${col} = $${params.push(v)}`);
      };
      set('label', dto.label);
      set('address', dto.address?.trim());
      set('geo_lat', dto.geoLat);
      set('geo_lng', dto.geoLng);
      set('directions', dto.directions?.trim());
      set('is_default', dto.isDefault);
      if (sets.length) {
        await m.query(`UPDATE restaurant_customer_address SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      }
      return this.addressView(await this.loadAddress(m, customerId, addressId));
    });
  }

  async removeAddress(customerId: string, addressId: string) {
    return this.tenantTx.run(async (m) => {
      const addr = await this.loadAddress(m, customerId, addressId);
      await m.query(`UPDATE restaurant_customer_address SET deleted_at=now(), is_default=false, updated_at=now() WHERE id=$1`, [addressId]);
      // Losing the default silently would leave the next order with nowhere to go by default.
      if (addr.is_default) {
        await m.query(
          `UPDATE restaurant_customer_address SET is_default=true, updated_at=now()
            WHERE id = (SELECT id FROM restaurant_customer_address
                         WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1)`,
          [customerId],
        );
      }
      return { id: addressId, deleted: true };
    });
  }

  /** A customer's own order history, newest first. */
  async orders(customerId: string, limit = 50) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT o.id, o.order_no, o.channel, o.status, o.currency, o.total_minor, o.placed_at, o.created_at,
                o.delivery_address,
                d.id AS delivery_id, d.delivery_no, d.status AS delivery_status, d.eta_minutes,
                dr.display_name AS driver_name, dr.phone AS driver_phone, dr.vehicle_type
           FROM restaurant_order o
           LEFT JOIN restaurant_delivery d ON d.order_id = o.id AND d.deleted_at IS NULL
           LEFT JOIN restaurant_driver dr ON dr.id = d.driver_id
          WHERE o.customer_id = $1 AND o.deleted_at IS NULL
          ORDER BY o.created_at DESC LIMIT ${Math.min(limit, 100)}`,
        [customerId],
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, orderNo: r.order_no, channel: r.channel, status: r.status,
        total: money(r.total_minor, r.currency as string),
        address: r.delivery_address ?? null,
        placedAt: r.placed_at ?? r.created_at,
        delivery: r.delivery_id
          ? {
              id: r.delivery_id, deliveryNo: r.delivery_no, status: r.delivery_status,
              etaMinutes: r.eta_minutes == null ? null : Number(r.eta_minutes),
              // The rider's name and number, which is what a waiting customer actually wants. Their
              // location is deliberately not here — that belongs to the live tracking endpoint.
              driver: r.driver_name ? { name: r.driver_name, phone: r.driver_phone ?? null, vehicleType: r.vehicle_type } : null,
            }
          : null,
      }));
    });
  }

  /**
   * Place an order as the signed-in customer — browse, basket, checkout, in one call.
   *
   * Deliberately one round trip rather than the staff sequence of create → add items → place. A phone
   * on a patchy mobile connection that completes two of those three legs leaves a DRAFT order the
   * customer believes they placed and the kitchen never sees; the failure mode of a single call is
   * simply "it did not go through", which the app can retry honestly.
   *
   * It is still three service calls underneath, because that is where the pricing, KDS routing and
   * outbox logic lives and duplicating it here would be far worse. What this adds is the cleanup: if
   * the order cannot be placed after items are on it, the draft is voided rather than left behind.
   */
  async placeOrder(customerId: string, dto: PlaceCustomerOrderDto) {
    const destination = await this.resolveDestination(customerId, dto);

    const created = await this.orderService.create({
      branchId: dto.branchId,
      channel: dto.channel,
      customerId,
      guestCount: 1,
      notes: dto.notes,
      address: destination?.address,
      geoLat: destination?.lat,
      geoLng: destination?.lng,
    });
    const orderId = (created as { id: string }).id;

    try {
      await this.orderService.addItems(orderId, { items: dto.items });
      const placed = await this.orderService.place(orderId);
      await this.tenantTx.run((m) => this.noteOrder(m, customerId));
      if (destination?.save) await this.addAddress(customerId, { address: destination.address!, geoLat: destination.lat, geoLng: destination.lng });
      return placed;
    } catch (err) {
      // Do not leave a half-built order the customer thinks exists and the kitchen cannot see.
      await this.orderService.void(orderId, { reason: 'Abandoned — checkout failed' }).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Where the food is going, and whether the customer may order at all.
   *
   * A delivery with no address is refused here rather than at the door: an order nobody can deliver
   * is worse than a checkout that asks one more question.
   */
  private async resolveDestination(customerId: string, dto: PlaceCustomerOrderDto) {
    await this.tenantTx.run((m) => this.assertOrderable(m, customerId));
    if (dto.channel !== 'DELIVERY') return null;

    if (dto.addressId) {
      const saved = await this.tenantTx.run((m) => this.loadAddress(m, customerId, dto.addressId!));
      return {
        address: saved.address as string,
        lat: saved.geo_lat == null ? undefined : Number(saved.geo_lat),
        lng: saved.geo_lng == null ? undefined : Number(saved.geo_lng),
        save: false,
      };
    }
    if (dto.address?.trim()) {
      return { address: dto.address.trim(), lat: dto.geoLat, lng: dto.geoLng, save: dto.saveAddress ?? false };
    }
    throw new UnprocessableEntityException('A delivery order needs an address — pick a saved one or type it in');
  }

  /** A blocked customer may still sign in and read their history, but cannot place a new order. */
  private async assertOrderable(m: Mgr, customerId: string) {
    const rows = (await m.query(
      `SELECT blocked, blocked_reason FROM restaurant_customer WHERE id=$1 AND deleted_at IS NULL`,
      [customerId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Customer not found');
    if (rows[0].blocked) {
      throw new UnprocessableEntityException(
        (rows[0].blocked_reason as string) || 'This account cannot place orders. Please call the restaurant.',
      );
    }
  }

  /** One order of the customer's own, for the tracking screen. Scoped — never another customer's. */
  async order(customerId: string, orderId: string) {
    const all = await this.orders(customerId, 100);
    const found = all.find((o) => o.id === orderId);
    if (!found) throw new NotFoundException('Order not found');
    return found;
  }

  /** Stamp recency when an order is placed, so the console's "recent customers" ordering is true. */
  async noteOrder(m: Mgr, customerId: string | null | undefined) {
    if (!customerId) return;
    await m.query(`UPDATE restaurant_customer SET last_order_at=now(), updated_at=now() WHERE id=$1`, [customerId]);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────
  private async clearDefault(m: Mgr, customerId: string) {
    await m.query(
      `UPDATE restaurant_customer_address SET is_default=false, updated_at=now()
        WHERE customer_id=$1 AND is_default AND deleted_at IS NULL`,
      [customerId],
    );
  }

  private async loadAddress(m: Mgr, customerId: string, addressId: string): Promise<Row> {
    const rows = (await m.query(
      `SELECT id, customer_id, label, address, geo_lat, geo_lng, directions, is_default
         FROM restaurant_customer_address WHERE id=$1 AND customer_id=$2 AND deleted_at IS NULL`,
      [addressId, customerId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Address not found');
    return rows[0];
  }

  private async addressesInTx(m: Mgr, customerId: string) {
    const rows = (await m.query(
      `SELECT id, customer_id, label, address, geo_lat, geo_lng, directions, is_default
         FROM restaurant_customer_address WHERE customer_id=$1 AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at`,
      [customerId],
    )) as Row[];
    return rows.map((r) => this.addressView(r));
  }

  private addressView(r: Row) {
    return {
      id: r.id, label: r.label, address: r.address,
      location: r.geo_lat == null ? null : { lat: Number(r.geo_lat), lng: Number(r.geo_lng) },
      directions: r.directions ?? null, isDefault: Boolean(r.is_default),
    };
  }

  private async loadHeader(m: Mgr, customerId: string) {
    const rows = (await m.query(
      `SELECT id, phone, name, blocked FROM restaurant_customer WHERE id=$1 AND deleted_at IS NULL`,
      [customerId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Customer not found');
    return rows[0];
  }

  private async getInTx(m: Mgr, customerId: string) {
    const rows = (await m.query(
      `SELECT c.id, c.phone, c.name, c.email, c.marketing_opt_in, c.blocked, c.blocked_reason, c.notes,
              c.last_order_at, c.last_login_at, c.created_at,
              COALESCE(o.orders, 0)::int AS orders_count,
              COALESCE(o.spend, 0)::bigint AS lifetime_minor,
              COALESCE(o.cur, 'PKR') AS currency
         FROM restaurant_customer c
         LEFT JOIN LATERAL (
           SELECT count(*) AS orders, sum(total_minor) AS spend, min(currency) AS cur
             FROM restaurant_order
            WHERE customer_id = c.id AND status = 'SETTLED' AND deleted_at IS NULL
         ) o ON true
        WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [customerId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Customer not found');
    return { ...this.view(rows[0]), addresses: await this.addressesInTx(m, customerId) };
  }

  private view(r: Row) {
    return {
      id: r.id as string,
      phone: r.phone as string,
      name: (r.name as string) ?? null,
      email: (r.email as string) ?? null,
      marketingOptIn: Boolean(r.marketing_opt_in),
      blocked: Boolean(r.blocked),
      blockedReason: (r.blocked_reason as string) ?? null,
      notes: (r.notes as string) ?? null,
      ordersCount: Number(r.orders_count ?? 0),
      /** Settled spend only — an unpaid or void order is not money the customer has spent. */
      lifetimeValue: money(r.lifetime_minor ?? 0, (r.currency as string) ?? 'PKR'),
      addressCount: r.address_count == null ? undefined : Number(r.address_count),
      lastOrderAt: r.last_order_at ?? null,
      lastLoginAt: r.last_login_at ?? null,
      createdAt: r.created_at ?? null,
    };
  }

  protected rows(result: unknown): Row[] {
    return rowsOf(result);
  }
}
