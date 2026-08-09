import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type RestaurantReservationCreatedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  CreateReservationDto,
  ListReservationsQueryDto,
  ReservationCheckinDto,
  SetReservationStatusDto,
} from './dto/restaurant.dto';
import {
  DOC_PREFIX,
  type ReservationStatus,
  type Row,
  canTransitionReservation,
  formatDocNo,
} from './restaurant.util';

type Mgr = EntityManager;
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Reservations + waitlist + QR check-in (ADR-011). A booking optionally holds a table and reserves it
 * for a time; seating marks the table OCCUPIED. Emits `reservation_created` (bridged to realtime for the
 * host stand; the notification worker turns it into SMS/email reminders). Tenant-scoped (RLS).
 */
@Injectable()
export class RestaurantReservationService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  private async nextDocNo(m: Mgr): Promise<string> {
    const seq = (await m.query(
      `INSERT INTO restaurant_doc_seq (tenant_id, doc_type, last_no) VALUES (${TENANT}, 'RES', 1)
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = restaurant_doc_seq.last_no + 1 RETURNING last_no`,
    )) as Array<{ last_no: string }>;
    return formatDocNo(DOC_PREFIX.RES, Number(seq[0]!.last_no));
  }

  async create(dto: CreateReservationDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.tableId) {
        const t = (await m.query(`SELECT id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`, [dto.tableId])) as Row[];
        if (!t[0]) throw new BadRequestException('Unknown table for this tenant');
      }
      const reservationNo = await this.nextDocNo(m);
      const checkinCode = randomBytes(3).toString('hex').toUpperCase();
      const status = dto.waitlist ? 'WAITLIST' : 'BOOKED';
      let id: string;
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_reservation
             (tenant_id, branch_id, reservation_no, customer_id, table_id, guest_name, guest_phone, party_size,
              reserved_for, duration_minutes, status, checkin_code, notes)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,$6, COALESCE($7,2), $8, COALESCE($9,90), $10, $11, $12) RETURNING id`,
          [
            dto.branchId ?? null, reservationNo, dto.customerId ?? null, dto.tableId ?? null, dto.guestName ?? null,
            dto.guestPhone ?? null, dto.partySize ?? null, dto.reservedFor, dto.durationMinutes ?? null, status, checkinCode, dto.notes ?? null,
          ],
        )) as Row[];
        id = rows[0]!.id as string;
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown table for this tenant');
        throw err;
      }
      // Reserve the held table so the floor reflects it.
      if (dto.tableId && status !== 'WAITLIST') {
        await m.query(`UPDATE restaurant_table SET status='RESERVED', updated_at=now() WHERE id=$1 AND status='AVAILABLE'`, [dto.tableId]);
      }
      const created = await this.getInTx(m, id);
      const payload: RestaurantReservationCreatedV1 = {
        reservationId: id, reservationNo, branchId: dto.branchId ?? null, customerId: dto.customerId ?? null,
        guestName: dto.guestName ?? null, guestPhone: dto.guestPhone ?? null, partySize: dto.partySize ?? 2, reservedFor: dto.reservedFor,
      };
      await this.outbox.write(m, EVENT_TYPES.RESTAURANT_RESERVATION_CREATED, payload);
      return created;
    });
  }

  async setStatus(id: string, dto: SetReservationStatusDto) {
    return this.tenantTx.run(async (m) => {
      const cur = await this.loadHeader(m, id);
      if (!canTransitionReservation(cur.status as ReservationStatus, dto.status as ReservationStatus)) {
        throw new UnprocessableEntityException(`Cannot move a ${cur.status} reservation to ${dto.status}`);
      }
      await m.query(`UPDATE restaurant_reservation SET status=$2, updated_at=now() WHERE id=$1`, [id, dto.status]);
      await this.applyTableSideEffect(m, cur.tableId, dto.status);
      return this.getInTx(m, id);
    });
  }

  /** QR check-in: find a booking by its code and seat it. */
  async checkin(dto: ReservationCheckinDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, status, table_id FROM restaurant_reservation WHERE checkin_code=$1 AND deleted_at IS NULL`,
        [dto.code.toUpperCase()],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('No reservation matches that check-in code');
      const status = rows[0].status as string;
      if (!['BOOKED', 'CONFIRMED', 'WAITLIST'].includes(status)) throw new UnprocessableEntityException(`Reservation is already ${status}`);
      await m.query(`UPDATE restaurant_reservation SET status='SEATED', updated_at=now() WHERE id=$1`, [rows[0].id]);
      await this.applyTableSideEffect(m, (rows[0].table_id as string) ?? null, 'SEATED');
      return this.getInTx(m, rows[0].id as string);
    });
  }

  private async applyTableSideEffect(m: Mgr, tableId: string | null, status: string) {
    if (!tableId) return;
    if (status === 'SEATED') {
      await m.query(`UPDATE restaurant_table SET status='OCCUPIED', updated_at=now() WHERE id=$1 AND status IN ('AVAILABLE','RESERVED')`, [tableId]);
    } else if (status === 'CANCELLED' || status === 'NO_SHOW' || status === 'COMPLETED') {
      await m.query(`UPDATE restaurant_table SET status='AVAILABLE', updated_at=now() WHERE id=$1 AND status='RESERVED'`, [tableId]);
    }
  }

  async list(query: ListReservationsQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['r.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`r.branch_id = $${params.push(query.branchId)}`);
      if (query.status) conds.push(`r.status = $${params.push(query.status)}`);
      if (query.from) conds.push(`r.reserved_for >= $${params.push(query.from)}`);
      if (query.to) conds.push(`r.reserved_for <= $${params.push(query.to)}`);
      const rows = (await m.query(
        `SELECT r.id, r.reservation_no, r.branch_id, r.customer_id, r.table_id, t.code AS table_code,
                r.guest_name, r.guest_phone, r.party_size, r.reserved_for, r.duration_minutes, r.status
         FROM restaurant_reservation r LEFT JOIN restaurant_table t ON t.id = r.table_id
         WHERE ${conds.join(' AND ')} ORDER BY r.reserved_for`,
        params,
      )) as Row[];
      return rows.map((r) => this.map(r));
    });
  }

  async get(id: string) {
    return this.tenantTx.run((m) => this.getInTx(m, id));
  }

  private async getInTx(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT r.id, r.reservation_no, r.branch_id, r.customer_id, r.table_id, t.code AS table_code,
              r.guest_name, r.guest_phone, r.party_size, r.reserved_for, r.duration_minutes, r.status, r.checkin_code, r.notes
       FROM restaurant_reservation r LEFT JOIN restaurant_table t ON t.id = r.table_id
       WHERE r.id=$1 AND r.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Reservation not found');
    return { ...this.map(rows[0]), checkinCode: rows[0].checkin_code ?? null, notes: rows[0].notes ?? null };
  }

  private async loadHeader(m: Mgr, id: string) {
    const rows = (await m.query(`SELECT id, status, table_id FROM restaurant_reservation WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Reservation not found');
    return { id: rows[0].id as string, status: rows[0].status as string, tableId: (rows[0].table_id as string) ?? null };
  }

  private map(r: Row) {
    return {
      id: r.id, reservationNo: r.reservation_no, branchId: r.branch_id ?? null, customerId: r.customer_id ?? null,
      tableId: r.table_id ?? null, table: r.table_code ?? null, guestName: r.guest_name ?? null, guestPhone: r.guest_phone ?? null,
      partySize: Number(r.party_size), reservedFor: r.reserved_for, durationMinutes: Number(r.duration_minutes), status: r.status,
    };
  }
}
