import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type RestaurantKdsTicketReadyV1, type RestaurantOrderServedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { AssignChefDto, KdsBoardQueryDto, SetKdsPriorityDto } from './dto/restaurant.dto';
import { type Row, rowsOf } from './restaurant.util';

type Mgr = EntityManager;

/**
 * Kitchen Display System. Reads the live station queue and drives each ticket through its state
 * machine (QUEUED → PREPARING → READY → BUMPED), rolling the parent order's status up as its tickets
 * progress and emitting `restaurant.kds_ticket_ready` / `restaurant.order_served` via the outbox so the
 * realtime gateway can push updates to waiter and customer clients. Tenant-scoped (RLS).
 */
@Injectable()
export class RestaurantKdsService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  /** The kitchen board: active (non-terminal) tickets for a branch, optionally one station. */
  async board(query: KdsBoardQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ["t.status IN ('QUEUED','PREPARING','READY')", 't.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`t.branch_id = $${params.push(query.branchId)}`);
      if (query.stationKey) conds.push(`t.station_key = $${params.push(query.stationKey)}`);
      const tickets = (await m.query(
        `SELECT t.id, t.order_id, t.station_key, t.ticket_no, t.priority, t.status, t.chef_employee_id,
                t.target_minutes, t.fired_at, t.created_at,
                o.order_no, o.channel, o.guest_count, tb.code AS table_code,
                EXTRACT(EPOCH FROM (now() - COALESCE(t.fired_at, t.created_at)))::int AS elapsed_seconds
         FROM restaurant_kds_ticket t
         JOIN restaurant_order o ON o.id = t.order_id
         LEFT JOIN restaurant_table tb ON tb.id = o.table_id
         WHERE ${conds.join(' AND ')}
         ORDER BY CASE t.priority WHEN 'RUSH' THEN 0 WHEN 'VIP' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, t.created_at`,
        params,
      )) as Row[];
      const items = (await m.query(
        `SELECT ki.ticket_id, ki.name, ki.qty, ki.modifiers_text, ki.status
         FROM restaurant_kds_ticket_item ki
         WHERE ki.ticket_id IN (SELECT id FROM restaurant_kds_ticket t WHERE ${conds.join(' AND ')})`,
        params,
      )) as Row[];
      const byTicket = new Map<string, Row[]>();
      for (const i of items) (byTicket.get(i.ticket_id as string) ?? byTicket.set(i.ticket_id as string, []).get(i.ticket_id as string)!).push(i);
      return tickets.map((t) => ({
        id: t.id, orderId: t.order_id, orderNo: t.order_no, stationKey: t.station_key, ticketNo: t.ticket_no,
        priority: t.priority, status: t.status, channel: t.channel, table: t.table_code ?? null, guestCount: Number(t.guest_count),
        chefEmployeeId: t.chef_employee_id ?? null, targetMinutes: t.target_minutes == null ? null : Number(t.target_minutes),
        elapsedSeconds: Number(t.elapsed_seconds ?? 0), firedAt: t.fired_at ?? null,
        items: (byTicket.get(t.id as string) ?? []).map((i) => ({ name: i.name, qty: Number(i.qty), modifiers: i.modifiers_text ?? null, status: i.status })),
      }));
    });
  }

  async start(ticketId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.loadTicket(m, ticketId);
      if (t.status !== 'QUEUED') throw new UnprocessableEntityException(`Only a QUEUED ticket can be started (is ${t.status})`);
      await m.query(`UPDATE restaurant_kds_ticket SET status='PREPARING', fired_at=COALESCE(fired_at, now()), updated_at=now() WHERE id=$1`, [ticketId]);
      await m.query(`UPDATE restaurant_kds_ticket_item SET status='PREPARING', updated_at=now() WHERE ticket_id=$1 AND status='QUEUED'`, [ticketId]);
      // First activity moves a CONFIRMED order to IN_PROGRESS.
      await m.query(`UPDATE restaurant_order SET status='IN_PROGRESS', updated_at=now() WHERE id=$1 AND status='CONFIRMED'`, [t.orderId]);
      return this.loadTicketView(m, ticketId);
    });
  }

  async ready(ticketId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.loadTicket(m, ticketId);
      if (!['QUEUED', 'PREPARING'].includes(t.status)) throw new UnprocessableEntityException(`Cannot mark a ${t.status} ticket ready`);
      await m.query(`UPDATE restaurant_kds_ticket SET status='READY', fired_at=COALESCE(fired_at, now()), ready_at=now(), updated_at=now() WHERE id=$1`, [ticketId]);
      await m.query(`UPDATE restaurant_kds_ticket_item SET status='READY', updated_at=now() WHERE ticket_id=$1`, [ticketId]);
      await m.query(
        `UPDATE restaurant_order_item SET status='READY', updated_at=now()
         WHERE id IN (SELECT order_item_id FROM restaurant_kds_ticket_item WHERE ticket_id=$1) AND status='FIRED'`,
        [ticketId],
      );
      const ready: RestaurantKdsTicketReadyV1 = { orderId: t.orderId, ticketId, ticketNo: t.ticketNo, stationKey: t.stationKey, branchId: t.branchId };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_KDS_TICKET_READY, ready);
      // If every ticket of the order is READY (or already bumped), the order is READY to serve.
      if (await this.allTicketsAtLeast(m, t.orderId, ['READY', 'BUMPED'])) {
        await m.query(`UPDATE restaurant_order SET status='READY', updated_at=now() WHERE id=$1 AND status IN ('CONFIRMED','IN_PROGRESS')`, [t.orderId]);
      }
      return this.loadTicketView(m, ticketId);
    });
  }

  async bump(ticketId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.loadTicket(m, ticketId);
      if (t.status !== 'READY') throw new UnprocessableEntityException(`Only a READY ticket can be bumped (is ${t.status})`);
      await m.query(`UPDATE restaurant_kds_ticket SET status='BUMPED', bumped_at=now(), updated_at=now() WHERE id=$1`, [ticketId]);
      await m.query(
        `UPDATE restaurant_order_item SET status='SERVED', updated_at=now()
         WHERE id IN (SELECT order_item_id FROM restaurant_kds_ticket_item WHERE ticket_id=$1) AND status='READY'`,
        [ticketId],
      );
      // When all tickets are bumped, the whole order has left the kitchen → SERVED.
      if (await this.allTicketsAtLeast(m, t.orderId, ['BUMPED'])) {
        const upd = rowsOf(await m.query(
          `UPDATE restaurant_order SET status='SERVED', updated_at=now() WHERE id=$1 AND status IN ('CONFIRMED','IN_PROGRESS','READY') RETURNING order_no`,
          [t.orderId],
        ));
        if (upd[0]) {
          const served: RestaurantOrderServedV1 = { orderId: t.orderId, orderNo: upd[0].order_no as string, branchId: t.branchId };
          await this.outbox.write(m, EVENT_TYPES.RESTAURANT_ORDER_SERVED, served);
        }
      }
      return this.loadTicketView(m, ticketId);
    });
  }

  async setPriority(ticketId: string, dto: SetKdsPriorityDto) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_kds_ticket SET priority=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [ticketId, dto.priority],
      ));
      if (!res[0]) throw new NotFoundException('Ticket not found');
      return this.loadTicketView(m, ticketId);
    });
  }

  async assignChef(ticketId: string, dto: AssignChefDto) {
    return this.tenantTx.run(async (m) => {
      const res = rowsOf(await m.query(
        `UPDATE restaurant_kds_ticket SET chef_employee_id=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [ticketId, dto.chefEmployeeId],
      ));
      if (!res[0]) throw new NotFoundException('Ticket not found');
      return this.loadTicketView(m, ticketId);
    });
  }

  private async loadTicket(m: Mgr, ticketId: string) {
    const rows = (await m.query(
      `SELECT id, order_id, branch_id, station_key, ticket_no, status FROM restaurant_kds_ticket WHERE id=$1 AND deleted_at IS NULL`,
      [ticketId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Ticket not found');
    const r = rows[0];
    return { id: r.id as string, orderId: r.order_id as string, branchId: (r.branch_id as string) ?? null, stationKey: r.station_key as string, ticketNo: r.ticket_no as string, status: r.status as string };
  }

  private async loadTicketView(m: Mgr, ticketId: string) {
    const rows = (await m.query(
      `SELECT id, order_id, station_key, ticket_no, priority, status, chef_employee_id, target_minutes, fired_at, ready_at, bumped_at
       FROM restaurant_kds_ticket WHERE id=$1 AND deleted_at IS NULL`,
      [ticketId],
    )) as Row[];
    const r = rows[0]!;
    return {
      id: r.id, orderId: r.order_id, stationKey: r.station_key, ticketNo: r.ticket_no, priority: r.priority, status: r.status,
      chefEmployeeId: r.chef_employee_id ?? null, targetMinutes: r.target_minutes == null ? null : Number(r.target_minutes),
      firedAt: r.fired_at ?? null, readyAt: r.ready_at ?? null, bumpedAt: r.bumped_at ?? null,
    };
  }

  /** True when every non-cancelled ticket of the order is in one of `states`. */
  private async allTicketsAtLeast(m: Mgr, orderId: string, states: string[]): Promise<boolean> {
    const rows = (await m.query(
      `SELECT count(*) FILTER (WHERE status <> 'CANCELLED')::int AS total,
              count(*) FILTER (WHERE status = ANY($2))::int AS reached
       FROM restaurant_kds_ticket WHERE order_id=$1`,
      [orderId, states],
    )) as Array<{ total: number; reached: number }>;
    return rows[0]!.total > 0 && rows[0]!.reached >= rows[0]!.total;
  }
}
