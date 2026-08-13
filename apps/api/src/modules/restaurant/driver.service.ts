import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type {
  CreateDriverDto,
  ListDriversQueryDto,
  SetDutyStatusDto,
  UpdateDriverDto,
} from './dto/restaurant.dto';
import { type Row, rowsOf } from './restaurant.util';

type Mgr = EntityManager;
const TENANT = `current_setting('app.tenant_id')::uuid`;
/** Statuses that mean a rider is holding the job — the ones that count against their capacity. */
const HELD = `('ASSIGNED','PICKED_UP','EN_ROUTE')`;

/**
 * The rider roster and the duty state machine behind dispatch.
 *
 * Before this existed, assigning a delivery meant typing an employee UUID into a text box: there was
 * no list of riders, no notion of who was on shift, and no way for the system to know that the person
 * being assigned had gone home an hour ago. Everything here exists to answer one question a counter
 * asks fifty times a night — *who can take this?*
 *
 * Duty is `OFF_DUTY → AVAILABLE → ON_RUN`, and the last transition is not a human decision: it is a
 * consequence of holding work. `ON_RUN` is derived from live job count rather than set by hand,
 * because any status a human has to remember to update is a status that is wrong by the middle of a
 * dinner rush. A rider goes `AVAILABLE`, the system moves them to `ON_RUN` when a job lands, and back
 * when their last one closes.
 */
@Injectable()
export class RestaurantDriverService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async create(dto: CreateDriverDto) {
    return this.tenantTx.run(async (m) => {
      if (dto.employeeId) {
        const e = (await m.query(`SELECT id FROM hr_employee WHERE id=$1 AND deleted_at IS NULL`, [dto.employeeId])) as Row[];
        if (!e[0]) throw new BadRequestException('Unknown employee for this tenant');
      }
      if (dto.userId) {
        const u = (await m.query(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [dto.userId])) as Row[];
        if (!u[0]) throw new BadRequestException('Unknown user for this tenant');
        const taken = (await m.query(
          `SELECT id FROM restaurant_driver WHERE user_id=$1 AND deleted_at IS NULL`,
          [dto.userId],
        )) as Row[];
        if (taken[0]) throw new UnprocessableEntityException('That login is already linked to another rider');
      }
      try {
        const rows = (await m.query(
          `INSERT INTO restaurant_driver
             (tenant_id, branch_id, driver_code, display_name, phone, employee_id, user_id,
              vehicle_type, vehicle_plate, max_concurrent_runs, active)
           VALUES (${TENANT}, $1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,1), true) RETURNING id`,
          [
            dto.branchId ?? null, dto.driverCode.trim(), dto.displayName.trim(), dto.phone?.trim() ?? null,
            dto.employeeId ?? null, dto.userId ?? null, dto.vehicleType ?? 'BIKE',
            dto.vehiclePlate?.trim() ?? null, dto.maxConcurrentRuns ?? null,
          ],
        )) as Row[];
        return this.getInTx(m, rows[0]!.id as string);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new UnprocessableEntityException('A rider with that code already exists');
        }
        throw err;
      }
    });
  }

  async update(driverId: string, dto: UpdateDriverDto) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, driverId);
      const sets: string[] = [];
      const params: unknown[] = [driverId];
      const set = (col: string, value: unknown) => {
        if (value === undefined) return;
        sets.push(`${col} = $${params.push(value)}`);
      };
      set('display_name', dto.displayName?.trim());
      set('phone', dto.phone?.trim());
      set('vehicle_type', dto.vehicleType);
      set('vehicle_plate', dto.vehiclePlate?.trim());
      set('max_concurrent_runs', dto.maxConcurrentRuns);
      set('branch_id', dto.branchId);
      set('active', dto.active);
      if (dto.userId !== undefined) {
        const u = (await m.query(`SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL`, [dto.userId])) as Row[];
        if (!u[0]) throw new BadRequestException('Unknown user for this tenant');
        // One rider per login, or "my runs" cannot tell which rider the signed-in human is.
        const taken = (await m.query(
          `SELECT id FROM restaurant_driver WHERE user_id=$1 AND id <> $2 AND deleted_at IS NULL`,
          [dto.userId, driverId],
        )) as Row[];
        if (taken[0]) throw new UnprocessableEntityException('That login is already linked to another rider');
        set('user_id', dto.userId);
      }
      if (dto.employeeId !== undefined) {
        const e = (await m.query(`SELECT id FROM hr_employee WHERE id=$1 AND deleted_at IS NULL`, [dto.employeeId])) as Row[];
        if (!e[0]) throw new BadRequestException('Unknown employee for this tenant');
        set('employee_id', dto.employeeId);
      }
      if (!sets.length) return this.getInTx(m, driverId);
      // Deactivating a rider who is mid-run would strand the job on someone who is no longer on the
      // roster, so it is refused rather than silently accepted.
      if (dto.active === false && (await this.liveRunCount(m, driverId)) > 0) {
        throw new UnprocessableEntityException('That rider is holding live runs — reassign them before deactivating');
      }
      await m.query(`UPDATE restaurant_driver SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, params);
      if (dto.active === false) {
        await m.query(`UPDATE restaurant_driver SET duty_status='OFF_DUTY', on_duty_since=NULL WHERE id=$1`, [driverId]);
      }
      return this.getInTx(m, driverId);
    });
  }

  /**
   * Clock a rider on or off.
   *
   * `ON_RUN` is not accepted from a caller — it is the system's word for "holding work", and letting
   * it be set by hand would let a rider mark themselves busy to dodge the next drop. Going off duty
   * while holding a run is refused for the same reason deactivating is.
   */
  async setDuty(driverId: string, dto: SetDutyStatusDto, actingDriverId?: string) {
    return this.tenantTx.run(async (m) => {
      const d = await this.loadHeader(m, driverId);
      if (actingDriverId && actingDriverId !== driverId) throw new ForbiddenException('A rider can only set their own duty status');
      if (!d.active) throw new UnprocessableEntityException('That rider is not active');
      const live = await this.liveRunCount(m, driverId);
      if (dto.dutyStatus === 'OFF_DUTY' && live > 0) {
        throw new UnprocessableEntityException(`Cannot go off duty while holding ${live} run(s) — finish or hand them back first`);
      }
      // Asking to be AVAILABLE while already holding work is not an error; the honest answer is
      // ON_RUN, and saying so beats a 422 the rider cannot act on.
      const next = dto.dutyStatus === 'AVAILABLE' && live > 0 ? 'ON_RUN' : dto.dutyStatus;
      await m.query(
        `UPDATE restaurant_driver
            SET duty_status=$2,
                on_duty_since = CASE WHEN $2='OFF_DUTY' THEN NULL ELSE COALESCE(on_duty_since, now()) END,
                last_seen_at=now(), updated_at=now()
          WHERE id=$1`,
        [driverId, next],
      );
      return this.getInTx(m, driverId);
    });
  }

  /**
   * The roster a dispatcher picks from.
   *
   * Ordered the way the decision is actually made: riders who can take work right now, least loaded
   * first, then everyone else. `suggested` marks the top of that list — a hint, never an enforcement,
   * because the counter can see things the database cannot (who is nearest the door, who is owed a
   * break, whose bike is out of fuel).
   */
  async roster(query: ListDriversQueryDto) {
    return this.tenantTx.run(async (m) => {
      const conds = ['d.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.branchId) conds.push(`d.branch_id = $${params.push(query.branchId)}`);
      if (query.dutyStatus) conds.push(`d.duty_status = $${params.push(query.dutyStatus)}`);
      if (query.active !== undefined) conds.push(`d.active = $${params.push(query.active)}`);
      const rows = (await m.query(
        `SELECT d.id, d.driver_code, d.display_name, d.phone, d.branch_id, d.employee_id, d.user_id,
                d.vehicle_type, d.vehicle_plate, d.duty_status, d.max_concurrent_runs, d.active,
                d.geo_lat, d.geo_lng, d.last_seen_at, d.on_duty_since,
                COALESCE(r.live, 0)::int AS live_runs,
                COALESCE(r.done_today, 0)::int AS delivered_today
           FROM restaurant_driver d
           LEFT JOIN LATERAL (
             SELECT count(*) FILTER (WHERE status IN ${HELD}) AS live,
                    count(*) FILTER (WHERE status = 'DELIVERED' AND delivered_at >= date_trunc('day', now())) AS done_today
               FROM restaurant_delivery WHERE driver_id = d.id AND deleted_at IS NULL
           ) r ON true
          WHERE ${conds.join(' AND ')}
          ORDER BY d.active DESC,
                   CASE WHEN d.active AND d.duty_status <> 'OFF_DUTY'
                             AND COALESCE(r.live,0) < d.max_concurrent_runs THEN 0 ELSE 1 END,
                   COALESCE(r.live,0), d.display_name`,
        params,
      )) as Row[];
      const view = rows.map((r) => this.view(r));
      const first = view.find((v) => v.canTakeWork);
      return view.map((v) => ({ ...v, suggested: v.id === first?.id }));
    });
  }

  async get(driverId: string) {
    return this.tenantTx.run((m) => this.getInTx(m, driverId));
  }

  async remove(driverId: string) {
    return this.tenantTx.run(async (m) => {
      await this.loadHeader(m, driverId);
      if ((await this.liveRunCount(m, driverId)) > 0) {
        throw new UnprocessableEntityException('That rider is holding live runs — reassign them first');
      }
      // Soft delete: the rider's name is on historical deliveries, and those must keep resolving.
      await m.query(
        `UPDATE restaurant_driver SET deleted_at=now(), active=false, duty_status='OFF_DUTY', updated_at=now() WHERE id=$1`,
        [driverId],
      );
      return { id: driverId, deleted: true };
    });
  }

  /** Resolve the signed-in user to their rider record. The whole point of `user_id`. */
  async requireDriverForUser(m: Mgr, userId: string) {
    const rows = (await m.query(
      `SELECT id, driver_code, display_name, branch_id, active, duty_status
         FROM restaurant_driver WHERE user_id=$1 AND deleted_at IS NULL`,
      [userId],
    )) as Row[];
    if (!rows[0]) {
      throw new ForbiddenException('This login is not linked to a rider record — ask a manager to link it on the roster');
    }
    if (!rows[0].active) throw new ForbiddenException('This rider is not active');
    return { id: rows[0].id as string, displayName: rows[0].display_name as string, branchId: (rows[0].branch_id as string) ?? null };
  }

  async me(userId: string) {
    return this.tenantTx.run(async (m) => {
      const d = await this.requireDriverForUser(m, userId);
      return this.getInTx(m, d.id);
    });
  }

  /** Heartbeat + last known position, written by the driver app's GPS pings. */
  async touch(m: Mgr, driverId: string, geo?: { lat: number; lng: number }) {
    await m.query(
      `UPDATE restaurant_driver
          SET last_seen_at=now(),
              geo_lat=COALESCE($2, geo_lat), geo_lng=COALESCE($3, geo_lng), updated_at=now()
        WHERE id=$1`,
      [driverId, geo?.lat ?? null, geo?.lng ?? null],
    );
  }

  /**
   * Re-derive duty from live workload. Called after anything that changes what a rider is holding.
   *
   * Never touches an OFF_DUTY rider: going off shift is a human decision and a job closing should not
   * silently clock someone back on.
   */
  async syncDuty(m: Mgr, driverId: string | null | undefined) {
    if (!driverId) return;
    await m.query(
      `UPDATE restaurant_driver d
          SET duty_status = CASE WHEN (
                SELECT count(*) FROM restaurant_delivery
                 WHERE driver_id=d.id AND status IN ${HELD} AND deleted_at IS NULL
              ) > 0 THEN 'ON_RUN' ELSE 'AVAILABLE' END,
              updated_at = now()
        WHERE d.id=$1 AND d.duty_status <> 'OFF_DUTY'`,
      [driverId],
    );
  }

  /**
   * Check a rider may take another job, and return their identity for the delivery row.
   * Capacity is enforced here rather than in the UI because dispatch also happens from the API.
   */
  async assertCanTake(m: Mgr, driverId: string) {
    const d = await this.loadHeader(m, driverId);
    if (!d.active) throw new UnprocessableEntityException(`${d.displayName} is not an active rider`);
    if (d.dutyStatus === 'OFF_DUTY') throw new UnprocessableEntityException(`${d.displayName} is off duty`);
    const live = await this.liveRunCount(m, driverId);
    if (live >= d.maxConcurrentRuns) {
      throw new UnprocessableEntityException(`${d.displayName} is already holding ${live} run(s), their maximum`);
    }
    return d;
  }

  /** Legacy bridge: dispatch used to name an employee, not a rider. Resolve one to the other. */
  async driverIdForEmployee(m: Mgr, employeeId: string): Promise<string> {
    const rows = (await m.query(
      `SELECT id FROM restaurant_driver WHERE employee_id=$1 AND deleted_at IS NULL AND active ORDER BY created_at LIMIT 1`,
      [employeeId],
    )) as Row[];
    if (!rows[0]) {
      throw new BadRequestException('That employee has no rider record — add them to the rider roster first');
    }
    return rows[0].id as string;
  }

  private async liveRunCount(m: Mgr, driverId: string): Promise<number> {
    const rows = (await m.query(
      `SELECT count(*)::int AS n FROM restaurant_delivery
        WHERE driver_id=$1 AND status IN ${HELD} AND deleted_at IS NULL`,
      [driverId],
    )) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  private async loadHeader(m: Mgr, driverId: string) {
    const rows = (await m.query(
      `SELECT id, display_name, employee_id, user_id, duty_status, max_concurrent_runs, active, branch_id
         FROM restaurant_driver WHERE id=$1 AND deleted_at IS NULL`,
      [driverId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Rider not found');
    const r = rows[0];
    return {
      id: r.id as string, displayName: r.display_name as string, employeeId: (r.employee_id as string) ?? null,
      userId: (r.user_id as string) ?? null, dutyStatus: r.duty_status as string,
      maxConcurrentRuns: Number(r.max_concurrent_runs), active: Boolean(r.active), branchId: (r.branch_id as string) ?? null,
    };
  }

  private async getInTx(m: Mgr, driverId: string) {
    const rows = (await m.query(
      `SELECT d.id, d.driver_code, d.display_name, d.phone, d.branch_id, d.employee_id, d.user_id,
              d.vehicle_type, d.vehicle_plate, d.duty_status, d.max_concurrent_runs, d.active,
              d.geo_lat, d.geo_lng, d.last_seen_at, d.on_duty_since,
              (SELECT count(*) FROM restaurant_delivery
                WHERE driver_id=d.id AND status IN ${HELD} AND deleted_at IS NULL)::int AS live_runs,
              (SELECT count(*) FROM restaurant_delivery
                WHERE driver_id=d.id AND status='DELIVERED'
                  AND delivered_at >= date_trunc('day', now()) AND deleted_at IS NULL)::int AS delivered_today
         FROM restaurant_driver d WHERE d.id=$1 AND d.deleted_at IS NULL`,
      [driverId],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Rider not found');
    return this.view(rows[0]);
  }

  private view(r: Row) {
    const live = Number(r.live_runs ?? 0);
    const max = Number(r.max_concurrent_runs);
    const active = Boolean(r.active);
    const duty = r.duty_status as string;
    return {
      id: r.id as string,
      driverCode: r.driver_code as string,
      displayName: r.display_name as string,
      phone: (r.phone as string) ?? null,
      branchId: (r.branch_id as string) ?? null,
      employeeId: (r.employee_id as string) ?? null,
      userId: (r.user_id as string) ?? null,
      /** False when no login is linked yet — the roster shows it so someone can go and fix it. */
      hasLogin: r.user_id != null,
      vehicleType: r.vehicle_type as string,
      vehiclePlate: (r.vehicle_plate as string) ?? null,
      dutyStatus: duty,
      liveRuns: live,
      maxConcurrentRuns: max,
      deliveredToday: Number(r.delivered_today ?? 0),
      active,
      canTakeWork: active && duty !== 'OFF_DUTY' && live < max,
      location: r.geo_lat == null ? null : { lat: Number(r.geo_lat), lng: Number(r.geo_lng) },
      lastSeenAt: r.last_seen_at ?? null,
      onDutySince: r.on_duty_since ?? null,
    };
  }

  /** Exposed for the assign path, which needs the same shape after a write. */
  async viewById(m: Mgr, driverId: string) {
    return this.getInTx(m, driverId);
  }

  /** Rows helper kept local so callers do not need to import it. */
  protected rows(result: unknown): Row[] {
    return rowsOf(result);
  }
}
