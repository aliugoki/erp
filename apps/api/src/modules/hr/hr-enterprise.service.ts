import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  AttendanceQueryDto,
  BulkAttendanceDto,
  CreateDocumentDto,
  CreateGoalDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  CreatePayrollRunDto,
  CreateReviewDto,
  CreateSalaryComponentDto,
  DecideLeaveDto,
  LifecycleEventDto,
  LogAttendanceDto,
  SetLeaveBalanceDto,
  UpdateGoalDto,
} from './dto/hr.dto';
import {
  type PayComponent,
  attendancePayableDays,
  computePayslip,
  inclusiveDays,
  nextHrDocNo,
  proratedBasicMinor,
  returningRows,
} from './hr.util';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
/** Format a DB `date` value (the driver may hand back a Date object or a string) as YYYY-MM-DD. */
const toDateStr = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Enterprise HCM: leave, payroll, performance, lifecycle and HR reports. Core employee/department
 * CRUD stays in {@link HrService}; this service layers the HCM workflows on top. Raw SQL through the
 * tenant-scoped tx (RLS); money is integer minor units. */
@Injectable()
export class HrEnterpriseService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Leave types & balances ──────────────────────────────────────────────────
  async createLeaveType(dto: CreateLeaveTypeDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_leave_type (tenant_id, name, code, days_per_year, paid, color)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
         RETURNING id, name, code, days_per_year, paid, color`,
        [dto.name, dto.code ?? null, dto.daysPerYear ?? 0, dto.paid ?? true, dto.color ?? null],
      )) as Row[];
      return mapLeaveType(rows[0]!);
    });
  }

  async listLeaveTypes() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, code, days_per_year, paid, color FROM hr_leave_type WHERE deleted_at IS NULL ORDER BY name`,
      )) as Row[];
      return rows.map(mapLeaveType);
    });
  }

  /** Set (upsert) an employee's annual entitlement for a leave type. */
  async setLeaveBalance(dto: SetLeaveBalanceDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_leave_balance (tenant_id, employee_id, leave_type_id, year, entitled_days, used_days)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,0)
           ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
           DO UPDATE SET entitled_days = EXCLUDED.entitled_days, updated_at = now()
           RETURNING id, employee_id, leave_type_id, year, entitled_days, used_days`,
          [dto.employeeId, dto.leaveTypeId, dto.year, dto.entitledDays],
        )) as Row[];
        return mapBalance(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee or leave type for this tenant');
        throw err;
      }
    });
  }

  async listLeaveBalances(employeeId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT b.id, b.employee_id, b.leave_type_id, b.year, b.entitled_days, b.used_days, t.name AS type_name
         FROM hr_leave_balance b JOIN hr_leave_type t ON t.id = b.leave_type_id
         WHERE b.employee_id = $1 AND b.deleted_at IS NULL ORDER BY b.year DESC, t.name`,
        [employeeId],
      )) as Row[];
      return rows.map((r) => ({ ...mapBalance(r), typeName: r.type_name as string }));
    });
  }

  // ── Leave requests ──────────────────────────────────────────────────────────
  async createLeaveRequest(dto: CreateLeaveRequestDto) {
    const days = inclusiveDays(dto.startDate, dto.endDate);
    if (days <= 0) throw new BadRequestException('End date must be on or after start date');
    return this.tenantTx.run(async (m) => {
      const leaveNo = await nextHrDocNo(m, 'LEAVE', 'LEAVE');
      try {
        const rows = (await m.query(
          `INSERT INTO hr_leave_request (tenant_id, leave_no, employee_id, leave_type_id, start_date, end_date, days, reason)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           RETURNING ${LEAVE_REQ_COLS}`,
          [leaveNo, dto.employeeId, dto.leaveTypeId, dto.startDate, dto.endDate, days, dto.reason ?? null],
        )) as Row[];
        return mapLeaveRequest(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee or leave type for this tenant');
        throw err;
      }
    });
  }

  async listLeaveRequests(status?: string) {
    const where = ['r.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${LEAVE_REQ_COLS_R}, e.first_name, e.last_name, t.name AS type_name
         FROM hr_leave_request r
         LEFT JOIN hr_employee e ON e.id = r.employee_id
         LEFT JOIN hr_leave_type t ON t.id = r.leave_type_id
         WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC`,
        params,
      )) as Row[];
      return rows.map((r) => ({
        ...mapLeaveRequest(r),
        employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
        typeName: (r.type_name as string) ?? null,
      }));
    });
  }

  /** Approve or reject a pending request. Approval consumes the employee's balance (creating one from
   * the type entitlement if absent) and emits `hr.leave_approved`. Idempotent: only acts on PENDING. */
  async decideLeave(id: string, dto: DecideLeaveDto, approverId?: string | null) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${LEAVE_REQ_COLS} FROM hr_leave_request WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Row[];
      const req = rows[0];
      if (!req) throw new NotFoundException('Leave request not found');
      if (req.status !== 'PENDING') throw new BadRequestException(`Request already ${String(req.status).toLowerCase()}`);

      const approve = dto.decision === 'APPROVE';
      const status = approve ? 'APPROVED' : 'REJECTED';
      await m.query(
        `UPDATE hr_leave_request SET status=$2, approver_id=$3, decided_at=now(), decision_note=$4, updated_at=now() WHERE id=$1`,
        [id, status, approverId ?? null, dto.note ?? null],
      );

      if (approve) {
        // Derive everything (incl. the year) from the request row in SQL — the `date` column comes
        // back from the driver as a Date object, so parsing the year in JS is fragile.
        await m.query(
          `INSERT INTO hr_leave_balance (tenant_id, employee_id, leave_type_id, year, entitled_days, used_days)
           SELECT current_setting('app.tenant_id')::uuid, lr.employee_id, lr.leave_type_id,
                  EXTRACT(YEAR FROM lr.start_date)::int, COALESCE(lt.days_per_year, 0), lr.days
           FROM hr_leave_request lr JOIN hr_leave_type lt ON lt.id = lr.leave_type_id
           WHERE lr.id = $1
           ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
           DO UPDATE SET used_days = hr_leave_balance.used_days + EXCLUDED.used_days, updated_at = now()`,
          [id],
        );
        await this.outbox.write(m, EVENT_TYPES.HR_LEAVE_APPROVED, {
          leaveRequestId: id,
          employeeId: req.employee_id as string,
          leaveTypeId: req.leave_type_id as string,
          days: num(req.days),
          startDate: toDateStr(req.start_date),
          endDate: toDateStr(req.end_date),
          approverId: approverId ?? null,
        });
      }
      return { id, status };
    });
  }

  // ── Payroll: components ─────────────────────────────────────────────────────
  async createComponent(dto: CreateSalaryComponentDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_salary_component (tenant_id, name, code, type, calc, value_minor, percent)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6)
           RETURNING id, name, code, type, calc, value_minor, percent, active`,
          [dto.name, dto.code, dto.type, dto.calc, dto.valueMinor ?? 0, dto.percent ?? 0],
        )) as Row[];
        return mapComponent(rows[0]!);
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Component code "${dto.code}" already exists`);
        throw err;
      }
    });
  }

  async listComponents() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, code, type, calc, value_minor, percent, active FROM hr_salary_component WHERE deleted_at IS NULL ORDER BY type, name`,
      )) as Row[];
      return rows.map(mapComponent);
    });
  }

  // ── Payroll: runs ───────────────────────────────────────────────────────────
  /** Generate a monthly payroll run: a payslip (+lines) per active, salaried employee. Basic pay is
   * **pro-rated by that month's attendance** (present/paid-leave = 1 day, half-day = 0.5, absent = 0)
   * against `workingDays`; components are then computed off the pro-rated basic. Employees with no
   * attendance recorded for the month are paid in full. One run per (year, month). */
  async createPayrollRun(dto: CreatePayrollRunDto) {
    const workingDays = dto.workingDays ?? 26;
    return this.tenantTx.run(async (m) => {
      const employees = (await m.query(
        `SELECT id, salary_amount_minor, salary_currency FROM hr_employee
         WHERE deleted_at IS NULL AND status='ACTIVE' AND salary_amount_minor IS NOT NULL`,
      )) as Row[];
      if (employees.length === 0) throw new BadRequestException('No active salaried employees to run payroll for');

      const compRows = (await m.query(
        `SELECT code, name, type, calc, value_minor, percent FROM hr_salary_component WHERE deleted_at IS NULL AND active=true`,
      )) as Row[];
      const components: PayComponent[] = compRows.map((c) => ({
        code: c.code as string,
        name: c.name as string,
        type: c.type as 'EARNING' | 'DEDUCTION',
        calc: c.calc as 'FIXED' | 'PCT_OF_BASIC',
        valueMinor: num(c.value_minor),
        percent: num(c.percent),
      }));
      const currency = (employees[0]!.salary_currency as string) ?? 'PKR';

      const runNo = await nextHrDocNo(m, 'PAYRUN', 'PAYRUN');
      let runId: string;
      try {
        const runRows = (await m.query(
          `INSERT INTO hr_payroll_run (tenant_id, run_no, period_year, period_month, currency, working_days, run_at)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5, now()) RETURNING id`,
          [runNo, dto.year, dto.month, currency, workingDays],
        )) as Row[];
        runId = runRows[0]!.id as string;
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Payroll for ${dto.year}-${String(dto.month).padStart(2, '0')} already exists`);
        throw err;
      }

      let gross = 0;
      let deduction = 0;
      let net = 0;
      for (const e of employees) {
        const att = (await m.query(
          `SELECT status FROM hr_attendance
           WHERE employee_id=$1 AND deleted_at IS NULL
             AND EXTRACT(YEAR FROM date)=$2 AND EXTRACT(MONTH FROM date)=$3`,
          [e.id, dto.year, dto.month],
        )) as Array<{ status: string }>;
        const hasAttendance = att.length > 0;
        const payableDays = attendancePayableDays(att);
        const fullBasic = num(e.salary_amount_minor);
        const basic = proratedBasicMinor(fullBasic, payableDays, workingDays, hasAttendance);

        const slip = computePayslip(basic, components);
        const payslipNo = await nextHrDocNo(m, 'PAYSLIP', 'PAYSLIP');
        const psRows = (await m.query(
          `INSERT INTO hr_payslip
             (tenant_id, payslip_no, run_id, employee_id, basic_minor, gross_minor, deduction_minor, net_minor, currency, working_days, payable_days)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [payslipNo, runId, e.id, slip.basicMinor, slip.grossMinor, slip.deductionMinor, slip.netMinor, currency, workingDays, hasAttendance ? payableDays : workingDays],
        )) as Row[];
        const payslipId = psRows[0]!.id as string;
        for (const line of slip.lines) {
          await m.query(
            `INSERT INTO hr_payslip_line (tenant_id, payslip_id, code, name, type, amount_minor)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)`,
            [payslipId, line.code, line.name, line.type, line.amountMinor],
          );
        }
        gross += slip.grossMinor;
        deduction += slip.deductionMinor;
        net += slip.netMinor;
      }

      await m.query(
        `UPDATE hr_payroll_run SET total_gross_minor=$2, total_deduction_minor=$3, total_net_minor=$4, employee_count=$5 WHERE id=$1`,
        [runId, gross, deduction, net, employees.length],
      );
      return this.getRunWith(m, runId);
    });
  }

  // ── Attendance ────────────────────────────────────────────────────────────────
  /** Log (upsert) one employee's attendance for a day. */
  async logAttendance(dto: LogAttendanceDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_attendance (tenant_id, employee_id, date, status, check_in, check_out, late, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id, employee_id, date) WHERE deleted_at IS NULL
           DO UPDATE SET status=EXCLUDED.status, check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out,
                         late=EXCLUDED.late, notes=EXCLUDED.notes, updated_at=now()
           RETURNING id, employee_id, date, status, check_in, check_out, late, notes`,
          [dto.employeeId, dto.date, dto.status, dto.checkIn ?? null, dto.checkOut ?? null, dto.late ?? false, dto.notes ?? null],
        )) as Row[];
        return mapAttendance(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  /** Mark a whole day's attendance for many employees at once (upsert). */
  async bulkLogAttendance(dto: BulkAttendanceDto) {
    return this.tenantTx.run(async (m) => {
      for (const entry of dto.entries) {
        await m.query(
          `INSERT INTO hr_attendance (tenant_id, employee_id, date, status, late)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
           ON CONFLICT (tenant_id, employee_id, date) WHERE deleted_at IS NULL
           DO UPDATE SET status=EXCLUDED.status, late=EXCLUDED.late, updated_at=now()`,
          [entry.employeeId, dto.date, entry.status, entry.late ?? false],
        );
      }
      return { date: dto.date, saved: dto.entries.length };
    });
  }

  /** Every employee's attendance status for a given day (the daily logging grid). */
  async dayAttendance(date: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT e.id AS employee_id, e.first_name, e.last_name, e.employee_code,
                a.id, a.status, a.check_in, a.check_out, a.late, a.notes
         FROM hr_employee e
         LEFT JOIN hr_attendance a ON a.employee_id = e.id AND a.date = $1 AND a.deleted_at IS NULL
         WHERE e.deleted_at IS NULL AND e.status='ACTIVE' ORDER BY e.first_name`,
        [date],
      )) as Row[];
      return rows.map((r) => ({
        employeeId: r.employee_id as string,
        employeeName: [r.first_name, r.last_name].filter(Boolean).join(' '),
        employeeCode: r.employee_code as string,
        status: (r.status as string) ?? null,
        late: (r.late as boolean) ?? false,
      }));
    });
  }

  /** Monthly attendance summary per employee: present / half / leave / absent day counts + payable. */
  async attendanceSummary(q: AttendanceQueryDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT e.id AS employee_id, e.first_name, e.last_name,
                count(*) FILTER (WHERE a.status='PRESENT')::int AS present,
                count(*) FILTER (WHERE a.status='HALF_DAY')::int AS half_day,
                count(*) FILTER (WHERE a.status='LEAVE')::int AS leave,
                count(*) FILTER (WHERE a.status='ABSENT')::int AS absent
         FROM hr_employee e
         LEFT JOIN hr_attendance a ON a.employee_id = e.id AND a.deleted_at IS NULL
            AND EXTRACT(YEAR FROM a.date)=$1 AND EXTRACT(MONTH FROM a.date)=$2
         WHERE e.deleted_at IS NULL AND e.status='ACTIVE'
         GROUP BY e.id, e.first_name, e.last_name ORDER BY e.first_name`,
        [q.year, q.month],
      )) as Row[];
      return rows.map((r) => {
        const present = num(r.present);
        const half = num(r.half_day);
        const leave = num(r.leave);
        return {
          employeeId: r.employee_id as string,
          employeeName: [r.first_name, r.last_name].filter(Boolean).join(' '),
          present, halfDay: half, leave, absent: num(r.absent),
          payableDays: present + leave + half * 0.5,
        };
      });
    });
  }

  async listPayrollRuns() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${RUN_COLS} FROM hr_payroll_run WHERE deleted_at IS NULL ORDER BY period_year DESC, period_month DESC`,
      )) as Row[];
      return rows.map(mapRun);
    });
  }

  /** Advance a run DRAFT→APPROVED→PAID. The first move to APPROVED emits `hr.payroll_run_completed`. */
  async updateRunStatus(id: string, status: 'APPROVED' | 'PAID') {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${RUN_COLS} FROM hr_payroll_run WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Row[];
      const run = rows[0];
      if (!run) throw new NotFoundException('Payroll run not found');
      const order = { DRAFT: 0, APPROVED: 1, PAID: 2 } as const;
      if (order[status] <= order[run.status as keyof typeof order]) {
        throw new BadRequestException(`Cannot move from ${String(run.status)} to ${status}`);
      }
      await m.query(`UPDATE hr_payroll_run SET status=$2, updated_at=now() WHERE id=$1`, [id, status]);

      if (status === 'APPROVED') {
        await this.outbox.write(m, EVENT_TYPES.HR_PAYROLL_RUN_COMPLETED, {
          runId: id,
          periodYear: num(run.period_year),
          periodMonth: num(run.period_month),
          employeeCount: num(run.employee_count),
          totalNetMinor: num(run.total_net_minor),
          currency: (run.currency as string) ?? 'PKR',
        });
      }
      return this.getRunWith(m, id);
    });
  }

  async listPayslips(runId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.id, p.payslip_no, p.run_id, p.employee_id, p.basic_minor, p.gross_minor, p.deduction_minor, p.net_minor, p.currency, p.working_days, p.payable_days,
                e.first_name, e.last_name, e.employee_code
         FROM hr_payslip p LEFT JOIN hr_employee e ON e.id = p.employee_id
         WHERE p.run_id = $1 AND p.deleted_at IS NULL ORDER BY e.first_name`,
        [runId],
      )) as Row[];
      return rows.map((r) => ({
        ...mapPayslip(r),
        employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
        employeeCode: (r.employee_code as string) ?? null,
      }));
    });
  }

  async getPayslip(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, payslip_no, run_id, employee_id, basic_minor, gross_minor, deduction_minor, net_minor, currency, working_days, payable_days
         FROM hr_payslip WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Payslip not found');
      const lines = (await m.query(
        `SELECT code, name, type, amount_minor FROM hr_payslip_line WHERE payslip_id=$1 AND deleted_at IS NULL ORDER BY created_at`,
        [id],
      )) as Row[];
      return {
        ...mapPayslip(rows[0]),
        lines: lines.map((l) => ({ code: l.code as string, name: l.name as string, type: l.type as string, amountMinor: num(l.amount_minor) })),
      };
    });
  }

  // ── Performance ─────────────────────────────────────────────────────────────
  async createReview(dto: CreateReviewDto) {
    return this.tenantTx.run(async (m) => {
      const reviewNo = await nextHrDocNo(m, 'REV', 'REV');
      try {
        const rows = (await m.query(
          `INSERT INTO hr_performance_review (tenant_id, review_no, employee_id, period, reviewer_id, rating, strengths, improvements)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           RETURNING ${REVIEW_COLS}`,
          [reviewNo, dto.employeeId, dto.period, dto.reviewerId ?? null, dto.rating ?? null, dto.strengths ?? null, dto.improvements ?? null],
        )) as Row[];
        return mapReview(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  async listReviews(employeeId?: string) {
    const where = ['r.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (employeeId) {
      params.push(employeeId);
      where.push(`r.employee_id = $${params.length}`);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${REVIEW_COLS_R}, e.first_name, e.last_name FROM hr_performance_review r
         LEFT JOIN hr_employee e ON e.id = r.employee_id
         WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC`,
        params,
      )) as Row[];
      return rows.map((r) => ({ ...mapReview(r), employeeName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null }));
    });
  }

  async submitReview(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = returningRows<Row>(
        await m.query(
          `UPDATE hr_performance_review SET status='SUBMITTED', submitted_at=now(), updated_at=now()
           WHERE id=$1 AND deleted_at IS NULL AND status='DRAFT' RETURNING ${REVIEW_COLS}`,
          [id],
        ),
      );
      if (!rows[0]) throw new NotFoundException('Review not found or already submitted');
      return mapReview(rows[0]);
    });
  }

  async createGoal(dto: CreateGoalDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_goal (tenant_id, employee_id, title, description, target_date)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4) RETURNING ${GOAL_COLS}`,
          [dto.employeeId, dto.title, dto.description ?? null, dto.targetDate ?? null],
        )) as Row[];
        return mapGoal(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  async listGoals(employeeId?: string) {
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    if (employeeId) {
      params.push(employeeId);
      where.push(`employee_id = $${params.length}`);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${GOAL_COLS} FROM hr_goal WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
        params,
      )) as Row[];
      return rows.map(mapGoal);
    });
  }

  async updateGoal(id: string, dto: UpdateGoalDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (dto.progress !== undefined) {
      params.push(dto.progress);
      sets.push(`progress = $${params.length}`);
    }
    // Reaching 100% auto-completes unless an explicit status is given.
    const status = dto.status ?? (dto.progress === 100 ? 'COMPLETED' : undefined);
    if (status !== undefined) {
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (sets.length === 0) throw new BadRequestException('Nothing to update');
    sets.push('updated_at = now()');
    params.push(id);
    return this.tenantTx.run(async (m) => {
      const rows = returningRows<Row>(
        await m.query(
          `UPDATE hr_goal SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${GOAL_COLS}`,
          params,
        ),
      );
      if (!rows[0]) throw new NotFoundException('Goal not found');
      return mapGoal(rows[0]);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  /** Apply a lifecycle change to an employee (department/position/salary/status) and record an audit
   * row, in one transaction. */
  async recordLifecycleEvent(employeeId: string, dto: LifecycleEventDto, actorId?: string | null) {
    return this.tenantTx.run(async (m) => {
      const empRows = (await m.query(
        `SELECT department_id, position_id, salary_amount_minor, salary_currency, status FROM hr_employee WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [employeeId],
      )) as Row[];
      const emp = empRows[0];
      if (!emp) throw new NotFoundException('Employee not found');

      const sets: string[] = [];
      const params: unknown[] = [];
      let fromValue: string | null = null;
      let toValue: string | null = null;
      const push = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (dto.departmentId !== undefined) push('department_id', dto.departmentId);
      if (dto.positionId !== undefined) push('position_id', dto.positionId);
      if (dto.status !== undefined) {
        fromValue = String(emp.status);
        toValue = dto.status;
        push('status', dto.status);
      }
      if (dto.salary !== undefined) {
        fromValue = String(num(emp.salary_amount_minor));
        toValue = String(dto.salary.amountMinor);
        push('salary_amount_minor', dto.salary.amountMinor);
        push('salary_currency', dto.salary.currency);
      }
      if (sets.length > 0) {
        sets.push('updated_at = now()');
        params.push(employeeId);
        try {
          await m.query(`UPDATE hr_employee SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
        } catch (err) {
          if (isFk(err)) throw new BadRequestException('Unknown department or position for this tenant');
          throw err;
        }
      }

      const histRows = (await m.query(
        `INSERT INTO hr_employment_history (tenant_id, employee_id, event_type, effective_date, detail, from_value, to_value, created_by)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2, COALESCE($3, current_date), $4,$5,$6,$7)
         RETURNING id, employee_id, event_type, effective_date, detail, from_value, to_value`,
        [employeeId, dto.eventType, dto.effectiveDate ?? null, dto.note ?? null, fromValue, toValue, actorId ?? null],
      )) as Row[];
      return mapHistory(histRows[0]!);
    });
  }

  async listHistory(employeeId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, employee_id, event_type, effective_date, detail, from_value, to_value FROM hr_employment_history
         WHERE employee_id = $1 AND deleted_at IS NULL ORDER BY effective_date DESC, created_at DESC`,
        [employeeId],
      )) as Row[];
      return rows.map(mapHistory);
    });
  }

  async addDocument(dto: CreateDocumentDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_document (tenant_id, employee_id, doc_type, title, file_ref, note)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
           RETURNING id, employee_id, doc_type, title, file_ref, note`,
          [dto.employeeId, dto.docType ?? null, dto.title, dto.fileRef ?? null, dto.note ?? null],
        )) as Row[];
        return mapDocument(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown employee for this tenant');
        throw err;
      }
    });
  }

  async listDocuments(employeeId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, employee_id, doc_type, title, file_ref, note FROM hr_document
         WHERE employee_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [employeeId],
      )) as Row[];
      return rows.map(mapDocument);
    });
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  async headcount() {
    return this.tenantTx.run(async (m) => {
      const byDept = (await m.query(
        `SELECT COALESCE(d.name, 'Unassigned') AS department, count(*)::int AS count
         FROM hr_employee e LEFT JOIN hr_department d ON d.id = e.department_id
         WHERE e.deleted_at IS NULL GROUP BY d.name ORDER BY count DESC`,
      )) as Row[];
      const byStatus = (await m.query(
        `SELECT status, count(*)::int AS count FROM hr_employee WHERE deleted_at IS NULL GROUP BY status`,
      )) as Row[];
      const statusMap = new Map(byStatus.map((r) => [r.status as string, num(r.count)]));
      const total = byDept.reduce((s, r) => s + num(r.count), 0);
      return {
        total,
        byDepartment: byDept.map((r) => ({ department: r.department as string, count: num(r.count) })),
        byStatus: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'].map((status) => ({ status, count: statusMap.get(status) ?? 0 })),
      };
    });
  }

  async payrollSummary() {
    return this.tenantTx.run(async (m) => {
      const runRows = (await m.query(
        `SELECT ${RUN_COLS} FROM hr_payroll_run WHERE deleted_at IS NULL ORDER BY period_year DESC, period_month DESC LIMIT 1`,
      )) as Row[];
      const latest = runRows[0] ? mapRun(runRows[0]) : null;
      let byComponent: Array<{ name: string; type: string; totalMinor: number }> = [];
      if (runRows[0]) {
        const comp = (await m.query(
          `SELECT l.name, l.type, COALESCE(sum(l.amount_minor),0)::bigint AS total_minor
           FROM hr_payslip_line l JOIN hr_payslip p ON p.id = l.payslip_id
           WHERE p.run_id = $1 AND l.deleted_at IS NULL GROUP BY l.name, l.type ORDER BY total_minor DESC`,
          [runRows[0].id],
        )) as Row[];
        byComponent = comp.map((c) => ({ name: c.name as string, type: c.type as string, totalMinor: num(c.total_minor) }));
      }
      return { latest, byComponent };
    });
  }

  async leaveSummary() {
    return this.tenantTx.run(async (m) => {
      const pending = (await m.query(
        `SELECT count(*)::int AS n FROM hr_leave_request WHERE deleted_at IS NULL AND status='PENDING'`,
      )) as Array<{ n: number }>;
      const byType = (await m.query(
        `SELECT t.name, COALESCE(sum(r.days),0)::int AS approved_days, count(*) FILTER (WHERE r.status='APPROVED')::int AS approved_count
         FROM hr_leave_type t LEFT JOIN hr_leave_request r ON r.leave_type_id = t.id AND r.status='APPROVED' AND r.deleted_at IS NULL
         WHERE t.deleted_at IS NULL GROUP BY t.name ORDER BY approved_days DESC`,
      )) as Row[];
      return {
        pendingCount: num(pending[0]?.n),
        byType: byType.map((r) => ({ name: r.name as string, approvedDays: num(r.approved_days), approvedCount: num(r.approved_count) })),
      };
    });
  }

  // ── private ─────────────────────────────────────────────────────────────────
  private async getRunWith(m: EntityManager, id: string) {
    const rows = (await m.query(`SELECT ${RUN_COLS} FROM hr_payroll_run WHERE id=$1`, [id])) as Row[];
    return mapRun(rows[0]!);
  }
}

// ── column lists ────────────────────────────────────────────────────────────────
const LEAVE_REQ_COLS =
  'id, leave_no, employee_id, leave_type_id, start_date, end_date, days, reason, status, approver_id, decided_at, decision_note';
const LEAVE_REQ_COLS_R =
  'r.id, r.leave_no, r.employee_id, r.leave_type_id, r.start_date, r.end_date, r.days, r.reason, r.status, r.approver_id, r.decided_at, r.decision_note';
const RUN_COLS =
  'id, run_no, period_year, period_month, status, currency, total_gross_minor, total_deduction_minor, total_net_minor, employee_count, working_days, run_at';
const REVIEW_COLS =
  'id, review_no, employee_id, period, reviewer_id, rating, strengths, improvements, status, submitted_at';
const REVIEW_COLS_R =
  'r.id, r.review_no, r.employee_id, r.period, r.reviewer_id, r.rating, r.strengths, r.improvements, r.status, r.submitted_at';
const GOAL_COLS = 'id, employee_id, title, description, target_date, status, progress';

// ── mappers ───────────────────────────────────────────────────────────────────
function mapLeaveType(r: Row) {
  return { id: r.id as string, name: r.name as string, code: (r.code as string) ?? null, daysPerYear: num(r.days_per_year), paid: r.paid as boolean, color: (r.color as string) ?? null };
}
function mapBalance(r: Row) {
  return {
    id: r.id as string, employeeId: r.employee_id as string, leaveTypeId: r.leave_type_id as string,
    year: num(r.year), entitledDays: num(r.entitled_days), usedDays: num(r.used_days),
    remainingDays: num(r.entitled_days) - num(r.used_days),
  };
}
function mapLeaveRequest(r: Row) {
  return {
    id: r.id as string, leaveNo: r.leave_no as string, employeeId: r.employee_id as string,
    leaveTypeId: r.leave_type_id as string, startDate: r.start_date as string, endDate: r.end_date as string,
    days: num(r.days), reason: (r.reason as string) ?? null, status: r.status as string,
    approverId: (r.approver_id as string) ?? null, decidedAt: (r.decided_at as string) ?? null,
    decisionNote: (r.decision_note as string) ?? null,
  };
}
function mapComponent(r: Row) {
  return {
    id: r.id as string, name: r.name as string, code: r.code as string, type: r.type as string,
    calc: r.calc as string, valueMinor: num(r.value_minor), percent: num(r.percent), active: r.active as boolean,
  };
}
function mapRun(r: Row) {
  const currency = (r.currency as string) ?? 'PKR';
  return {
    id: r.id as string, runNo: r.run_no as string, periodYear: num(r.period_year), periodMonth: num(r.period_month),
    status: r.status as string, employeeCount: num(r.employee_count), workingDays: num(r.working_days),
    totalGross: { amountMinor: num(r.total_gross_minor), currency },
    totalDeduction: { amountMinor: num(r.total_deduction_minor), currency },
    totalNet: { amountMinor: num(r.total_net_minor), currency },
    runAt: (r.run_at as string) ?? null,
  };
}
function mapPayslip(r: Row) {
  const currency = (r.currency as string) ?? 'PKR';
  return {
    id: r.id as string, payslipNo: r.payslip_no as string, runId: r.run_id as string, employeeId: r.employee_id as string,
    basic: { amountMinor: num(r.basic_minor), currency },
    gross: { amountMinor: num(r.gross_minor), currency },
    deduction: { amountMinor: num(r.deduction_minor), currency },
    net: { amountMinor: num(r.net_minor), currency },
    workingDays: r.working_days === undefined ? null : num(r.working_days),
    payableDays: r.payable_days === undefined ? null : num(r.payable_days),
  };
}
function mapAttendance(r: Row) {
  return {
    id: r.id as string, employeeId: r.employee_id as string,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : (r.date as string),
    status: r.status as string,
    checkIn: (r.check_in as string) ?? null, checkOut: (r.check_out as string) ?? null,
    late: (r.late as boolean) ?? false, notes: (r.notes as string) ?? null,
  };
}
function mapReview(r: Row) {
  return {
    id: r.id as string, reviewNo: r.review_no as string, employeeId: r.employee_id as string, period: r.period as string,
    reviewerId: (r.reviewer_id as string) ?? null, rating: r.rating === null ? null : num(r.rating),
    strengths: (r.strengths as string) ?? null, improvements: (r.improvements as string) ?? null,
    status: r.status as string, submittedAt: (r.submitted_at as string) ?? null,
  };
}
function mapGoal(r: Row) {
  return {
    id: r.id as string, employeeId: r.employee_id as string, title: r.title as string,
    description: (r.description as string) ?? null, targetDate: (r.target_date as string) ?? null,
    status: r.status as string, progress: num(r.progress),
  };
}
function mapHistory(r: Row) {
  return {
    id: r.id as string, employeeId: r.employee_id as string, eventType: r.event_type as string,
    effectiveDate: r.effective_date as string, detail: (r.detail as string) ?? null,
    fromValue: (r.from_value as string) ?? null, toValue: (r.to_value as string) ?? null,
  };
}
function mapDocument(r: Row) {
  return {
    id: r.id as string, employeeId: r.employee_id as string, docType: (r.doc_type as string) ?? null,
    title: r.title as string, fileRef: (r.file_ref as string) ?? null, note: (r.note as string) ?? null,
  };
}

const code = (err: unknown): string | undefined => (err as { code?: string })?.code;
const isUnique = (e: unknown) => code(e) === '23505';
const isFk = (e: unknown) => code(e) === '23503';
