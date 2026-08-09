import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  EVENT_TYPES,
  type RestaurantDeliveryAssignedV1,
  type RestaurantDeliveryCompletedV1,
} from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  AggregatorUpdateDto,
  AssignDriverDto,
  CompleteDeliveryDto,
  CreateDeliveryDto,
  FailDeliveryDto,
  ListDeliveriesQueryDto,
  TrackLocationDto,
} from './dto/restaurant.dto';
import {
  DOC_PREFIX,
  type DeliveryStatus,
  type Row,
  canTransitionDelivery,
  formatDocNo,
} from './restaurant.util';

type Mgr = EntityManager;
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const TENANT = `current_setting('app.tenant_id')::uuid`;
const ACTIVE = ['ASSIGNED', 'PICKED_UP', 'EN_ROUTE'];

/**
 * Delivery dispatch + live tracking (ADR-011 §Online delivery). Own-fleet: create a job for an order,
 * assign a driver, drop GPS breadcrumbs, and complete against an OTP the customer reads to the rider.
 * Aggregators (Foodpanda/Careem/Uber Eats/Talabat) are represented by a provider + external ref, with
 * an ingest seam for their status webhooks. Emits `delivery_assigned` / `delivery_completed` via the
 * outbox for notifications + realtime. Tenant-scoped (RLS).
 */
@Injectable()
export class RestaurantDeliveryService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  private async nextDocNo(m: Mgr): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO restaurant_doc_seq (tenant_id, doc_type, last_no) VALUES (${TENANT}, 'DLV', 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = restaurant_doc_seq.last_no + 1 RETURNING last_no`,
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX.DLV, Number(seq[0]!.last_no));
  }

  async create(dto: CreateDeliveryDto) {
    return this.tenantTx.run(async (m) => {
      const order = (await m.query(
        `SELECT id, branch_id, customer_id, status FROM restaurant_order WHERE id=$1 AND deleted_at IS NULL`,
        [dto.orderId],
      )) as Row[];
      if (!order[0]) throw new BadRequestException('Unknown order for this tenant');
      if (['VOID', 'CLOSED'].includes(order[0].status as string)) throw new UnprocessableEntityException('Cannot create a delivery for a closed/void order');
      const existing = (await m.query(`SELECT id FROM restaurant_delivery WHERE order_id=$1 AND status NOT IN ('CANCELLED','FAILED') AND deleted_at IS NULL`, [dto.orderId])) as Row[];
      if (existing[0]) throw new UnprocessableEntityException('An active delivery already exists for this order');

      const provider = dto.provider ?? 'OWN';
      const deliveryNo = await this.nextDocNo(m);
      const otp = provider === 'OWN' ? String(randomInt(100000, 1000000)) : null;
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_delivery
             (tenant_id, order_id, branch_id, delivery_no, provider, customer_id, address, geo_lat, geo_lng, otp_code, status, eta_minutes, external_ref)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11) RETURNING id`,
          [
            dto.orderId, order[0].branch_id ?? null, deliveryNo, provider, order[0].customer_id ?? null,
            dto.address ?? null, dto.geoLat ?? null, dto.geoLng ?? null, otp, dto.etaMinutes ?? null, dto.externalRef ?? null,
          ],
        )) as Row[];
        return this.getInTx(m, rows[0]!.id as string, true);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown order for this tenant');
        throw err;
      }
    });
  }

  async assign(deliveryId: string, dto: AssignDriverDto) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, deliveryId);
      if (!canTransitionDelivery(d.status as DeliveryStatus, 'ASSIGNED')) throw new UnprocessableEntityException(`Cannot assign a ${d.status} delivery`);
      await m.query(
        `UPDATE restaurant_delivery SET driver_employee_id=$2, eta_minutes=COALESCE($3, eta_minutes), status='ASSIGNED', assigned_at=now(), updated_at=now() WHERE id=$1`,
        [deliveryId, dto.driverEmployeeId, dto.etaMinutes ?? null],
      );
      const payload: RestaurantDeliveryAssignedV1 = {
        orderId: d.orderId, deliveryId, deliveryNo: d.deliveryNo, branchId: d.branchId, provider: d.provider,
        driverEmployeeId: dto.driverEmployeeId, customerId: d.customerId, etaMinutes: dto.etaMinutes ?? d.etaMinutes,
      };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_DELIVERY_ASSIGNED, payload);
      return this.getInTx(m, deliveryId);
    });
  }

  async pickup(deliveryId: string) {
    return this.advance(deliveryId, 'PICKED_UP', 'picked_up_at');
  }

  async enroute(deliveryId: string) {
    return this.advance(deliveryId, 'EN_ROUTE', null);
  }

  private async advance(deliveryId: string, to: DeliveryStatus, stampCol: string | null) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, deliveryId);
      if (!canTransitionDelivery(d.status as DeliveryStatus, to)) throw new UnprocessableEntityException(`Cannot move a ${d.status} delivery to ${to}`);
      const stamp = stampCol ? `, ${stampCol}=now()` : '';
      await m.query(`UPDATE restaurant_delivery SET status=$2${stamp}, updated_at=now() WHERE id=$1`, [deliveryId, to]);
      return this.getInTx(m, deliveryId);
    });
  }

  async track(deliveryId: string, dto: TrackLocationDto) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, deliveryId);
      if (!ACTIVE.includes(d.status)) throw new UnprocessableEntityException(`Cannot track a ${d.status} delivery`);
      await m.query(
        `INSERT INTO restaurant_delivery_track (tenant_id, delivery_id, geo_lat, geo_lng, speed_kph)
         VALUES (${TENANT}, $1,$2,$3,$4)`,
        [deliveryId, dto.geoLat, dto.geoLng, dto.speedKph ?? null],
      );
      await m.query(`UPDATE restaurant_delivery SET geo_lat=$2, geo_lng=$3, updated_at=now() WHERE id=$1`, [deliveryId, dto.geoLat, dto.geoLng]);
      return { deliveryId, recorded: true, geo: { lat: dto.geoLat, lng: dto.geoLng } };
    });
  }

  async complete(deliveryId: string, dto: CompleteDeliveryDto) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, deliveryId);
      if (!canTransitionDelivery(d.status as DeliveryStatus, 'DELIVERED')) throw new UnprocessableEntityException(`Cannot complete a ${d.status} delivery`);
      if (d.provider === 'OWN') {
        if (!d.otpCode || d.otpCode !== dto.otp) throw new UnprocessableEntityException('Invalid delivery OTP');
      }
      await m.query(`UPDATE restaurant_delivery SET status='DELIVERED', delivered_at=now(), updated_at=now() WHERE id=$1`, [deliveryId]);
      const payload: RestaurantDeliveryCompletedV1 = { orderId: d.orderId, deliveryId, deliveryNo: d.deliveryNo, branchId: d.branchId, provider: d.provider };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_DELIVERY_COMPLETED, payload);
      return this.getInTx(m, deliveryId);
    });
  }

  async fail(deliveryId: string, dto: FailDeliveryDto) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, deliveryId);
      if (!canTransitionDelivery(d.status as DeliveryStatus, 'FAILED')) throw new UnprocessableEntityException(`Cannot fail a ${d.status} delivery`);
      await m.query(`UPDATE restaurant_delivery SET status='FAILED', updated_at=now() WHERE id=$1`, [deliveryId]);
      return { deliveryId, status: 'FAILED', reason: dto.reason ?? null };
    });
  }

  /**
   * Ingest an aggregator status update (Foodpanda/Careem/…). In production this is driven by the
   * aggregator's signed webhook; here it maps an external ref + status onto the matching delivery. Real
   * per-aggregator signature verification + public routing is a follow-up (ADR-011 §10).
   */
  async ingestAggregatorUpdate(provider: string, dto: AggregatorUpdateDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, order_id, branch_id, delivery_no, provider, customer_id, status FROM restaurant_delivery
         WHERE external_ref=$1 AND provider=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [dto.externalRef, provider],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('No delivery matches that aggregator reference');
      const id = rows[0].id as string;
      await m.query(
        `UPDATE restaurant_delivery SET status=$2, eta_minutes=COALESCE($3, eta_minutes),
                geo_lat=COALESCE($4, geo_lat), geo_lng=COALESCE($5, geo_lng), updated_at=now() WHERE id=$1`,
        [id, dto.status, dto.etaMinutes ?? null, dto.geoLat ?? null, dto.geoLng ?? null],
      );
      if (dto.status === 'DELIVERED') {
        const payload: RestaurantDeliveryCompletedV1 = {
          orderId: rows[0].order_id as string, deliveryId: id, deliveryNo: rows[0].delivery_no as string,
          branchId: (rows[0].branch_id as string) ?? null, provider,
        };
        await this.outbox.write(m, EVENT_TYPES.RESTAURANT_DELIVERY_COMPLETED, payload);
      }
      return this.getInTx(m, id);
    });
  }

  async list(query: ListDeliveriesQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['d.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`d.branch_id = $${params.push(query.branchId)}`);
      if (query.status) conds.push(`d.status = $${params.push(query.status)}`);
      if (query.driverEmployeeId) conds.push(`d.driver_employee_id = $${params.push(query.driverEmployeeId)}`);
      const rows = (await m.query(
        `SELECT d.id, d.delivery_no, d.order_id, o.order_no, d.branch_id, d.provider, d.driver_employee_id,
                d.status, d.eta_minutes, d.assigned_at, d.delivered_at
         FROM restaurant_delivery d JOIN restaurant_order o ON o.id = d.order_id
         WHERE ${conds.join(' AND ')} ORDER BY d.created_at DESC LIMIT 200`,
        params,
      )) as Row[];
      return rows.map((r) => ({
        id: r.id, deliveryNo: r.delivery_no, orderId: r.order_id, orderNo: r.order_no, branchId: r.branch_id ?? null,
        provider: r.provider, driverEmployeeId: r.driver_employee_id ?? null, status: r.status,
        etaMinutes: r.eta_minutes == null ? null : Number(r.eta_minutes), assignedAt: r.assigned_at ?? null, deliveredAt: r.delivered_at ?? null,
      }));
    });
  }

  async get(deliveryId: string) {
    return this.tenantTx.run((m) => this.getInTx(m, deliveryId));
  }

  async trail(deliveryId: string) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, deliveryId);
      const rows = (await m.query(
        `SELECT geo_lat, geo_lng, speed_kph, recorded_at FROM restaurant_delivery_track
         WHERE delivery_id=$1 ORDER BY recorded_at`,
        [deliveryId],
      )) as Row[];
      return rows.map((r) => ({ lat: Number(r.geo_lat), lng: Number(r.geo_lng), speedKph: r.speed_kph == null ? null : Number(r.speed_kph), at: r.recorded_at }));
    });
  }

  private async loadHeader(m: Mgr, deliveryId: string) {
    const rows = (await m.query(
      `SELECT id, order_id, branch_id, delivery_no, provider, customer_id, status, otp_code, eta_minutes
       FROM restaurant_delivery WHERE id=$1 AND deleted_at IS NULL`,
      [deliveryId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Delivery not found');
    const r = rows[0];
    return {
      id: r.id as string, orderId: r.order_id as string, branchId: (r.branch_id as string) ?? null, deliveryNo: r.delivery_no as string,
      provider: r.provider as string, customerId: (r.customer_id as string) ?? null, status: r.status as string,
      otpCode: (r.otp_code as string) ?? null, etaMinutes: r.eta_minutes == null ? null : Number(r.eta_minutes),
    };
  }

  /** Full delivery view. `includeOtp` only on creation (so own-fleet dispatch can show the code to staff). */
  private async getInTx(m: Mgr, deliveryId: string, includeOtp = false) {
    const rows = (await m.query(
      `SELECT d.id, d.delivery_no, d.order_id, o.order_no, d.branch_id, d.provider, d.driver_employee_id,
              d.customer_id, d.address, d.geo_lat, d.geo_lng, d.otp_code, d.status, d.eta_minutes,
              d.assigned_at, d.picked_up_at, d.delivered_at, d.external_ref
       FROM restaurant_delivery d JOIN restaurant_order o ON o.id = d.order_id
       WHERE d.id=$1 AND d.deleted_at IS NULL`,
      [deliveryId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Delivery not found');
    const r = rows[0];
    return {
      id: r.id, deliveryNo: r.delivery_no, orderId: r.order_id, orderNo: r.order_no, branchId: r.branch_id ?? null,
      provider: r.provider, driverEmployeeId: r.driver_employee_id ?? null, customerId: r.customer_id ?? null,
      address: r.address ?? null,
      location: r.geo_lat == null ? null : { lat: Number(r.geo_lat), lng: Number(r.geo_lng) },
      status: r.status, etaMinutes: r.eta_minutes == null ? null : Number(r.eta_minutes),
      assignedAt: r.assigned_at ?? null, pickedUpAt: r.picked_up_at ?? null, deliveredAt: r.delivered_at ?? null,
      externalRef: r.external_ref ?? null,
      ...(includeOtp && r.otp_code ? { otp: r.otp_code } : {}),
    };
  }
}
