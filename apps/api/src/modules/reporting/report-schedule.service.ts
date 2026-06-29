import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import type { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-schedule.dto';
import { ReportBuilderService } from './report-builder.service';
import { FORMAT_META, type ReportFormat, renderReport } from './report-export';
import { type ScheduleTiming, computeNextRun } from './report-schedule.util';

type Row = Record<string, unknown>;

export interface ReportSchedule {
  id: string;
  name: string;
  presetKey: string | null;
  reportId: string | null;
  format: ReportFormat;
  recipients: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
}

function mapRow(r: Row): ReportSchedule {
  return {
    id: r.id as string,
    name: r.name as string,
    presetKey: (r.preset_key as string | null) ?? null,
    reportId: (r.report_id as string | null) ?? null,
    format: r.format as ReportFormat,
    recipients: (r.recipients as string[]) ?? [],
    frequency: r.frequency as ReportSchedule['frequency'],
    hour: Number(r.hour),
    minute: Number(r.minute),
    dayOfWeek: r.day_of_week == null ? null : Number(r.day_of_week),
    dayOfMonth: r.day_of_month == null ? null : Number(r.day_of_month),
    enabled: r.enabled as boolean,
    lastRunAt: (r.last_run_at as string | null) ?? null,
    nextRunAt: r.next_run_at as string,
  };
}

const timingOf = (s: ReportSchedule): ScheduleTiming => ({
  frequency: s.frequency,
  hour: s.hour,
  minute: s.minute,
  dayOfWeek: s.dayOfWeek,
  dayOfMonth: s.dayOfMonth,
});

/**
 * Scheduled report emails. Persists/edits schedules (tenant-scoped, RLS), and renders + emails due
 * schedules (via the email queue's retry/backoff). `now` is injected into the run paths so the cadence
 * math is deterministic and testable.
 */
@Injectable()
export class ReportScheduleService {
  private readonly logger = new Logger(ReportScheduleService.name);

  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly dataSource: DataSource,
    private readonly builder: ReportBuilderService,
    private readonly email: EmailQueueService,
  ) {}

  list(): Promise<ReportSchedule[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM report_schedule WHERE deleted_at IS NULL ORDER BY created_at DESC`)) as Row[];
      return rows.map(mapRow);
    });
  }

  async create(dto: CreateReportScheduleDto, now = new Date()): Promise<ReportSchedule> {
    this.validateTarget(dto);
    const next = computeNextRun(dto as ScheduleTiming, now);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO report_schedule (tenant_id, name, preset_key, report_id, format, recipients, frequency, hour, minute, day_of_week, day_of_month, enabled, next_run_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,COALESCE($11,true),$12)
         RETURNING *`,
        [
          dto.name,
          dto.presetKey ?? null,
          dto.reportId ?? null,
          dto.format,
          JSON.stringify(dto.recipients),
          dto.frequency,
          dto.hour,
          dto.minute,
          dto.dayOfWeek ?? null,
          dto.dayOfMonth ?? null,
          dto.enabled ?? null,
          next.toISOString(),
        ],
      )) as Row[];
      return mapRow(rows[0]!);
    });
  }

  async update(id: string, dto: UpdateReportScheduleDto, now = new Date()): Promise<ReportSchedule> {
    const current = await this.findOne(id);
    const merged = { ...current, ...stripUndefined(dto) } as ReportSchedule;
    this.validateTarget(merged);
    const next = computeNextRun(timingOf(merged), now);
    // UPDATE ... RETURNING via the manager yields [rows, count] here, so update then refetch.
    await this.tenantTx.run((m) =>
      m.query(
        `UPDATE report_schedule SET name=$2, preset_key=$3, report_id=$4, format=$5, recipients=$6::jsonb,
           frequency=$7, hour=$8, minute=$9, day_of_week=$10, day_of_month=$11, enabled=$12, next_run_at=$13, updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL`,
        [
          id,
          merged.name,
          merged.presetKey,
          merged.reportId,
          merged.format,
          JSON.stringify(merged.recipients),
          merged.frequency,
          merged.hour,
          merged.minute,
          merged.dayOfWeek,
          merged.dayOfMonth,
          merged.enabled,
          next.toISOString(),
        ],
      ),
    );
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.tenantTx.run(async (m) => {
      const res = (await m.query(`UPDATE report_schedule SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id])) as unknown;
      const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as unknown[]);
      if (!rows || rows.length === 0) throw new NotFoundException('Schedule not found');
    });
  }

  async findOne(id: string): Promise<ReportSchedule> {
    const row = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM report_schedule WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      return rows[0];
    });
    if (!row) throw new NotFoundException('Schedule not found');
    return mapRow(row);
  }

  /** Render + email one schedule immediately and advance its next-run (does not change cadence). */
  async runNow(id: string, now = new Date()): Promise<{ delivered: number; bytes: number; format: ReportFormat }> {
    const schedule = await this.findOne(id);
    const summary = await this.deliver(schedule);
    await this.tenantTx.run((m) =>
      m.query(`UPDATE report_schedule SET last_run_at=$2, next_run_at=$3, updated_at=now() WHERE id=$1`, [
        id,
        now.toISOString(),
        computeNextRun(timingOf(schedule), now).toISOString(),
      ]),
    );
    return summary;
  }

  /** Tick entry point: render + email every due schedule across all tenants. */
  async runDueAllTenants(now = new Date()): Promise<number> {
    const tenants = (await this.dataSource.query(`SELECT id FROM tenants WHERE deleted_at IS NULL`)) as Array<{ id: string }>;
    let count = 0;
    for (const { id } of tenants) {
      try {
        count += await this.tenantTx.runFor(id, () => this.runDueForCurrentTenant(now));
      } catch (err) {
        this.logger.warn(`report schedule run failed for tenant ${id}: ${(err as Error).message}`);
      }
    }
    return count;
  }

  /** Within the current RLS context: deliver each due schedule and advance it. */
  private async runDueForCurrentTenant(now: Date): Promise<number> {
    const due = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT * FROM report_schedule WHERE deleted_at IS NULL AND enabled = true AND next_run_at <= $1`,
        [now.toISOString()],
      )) as Row[];
      return rows.map(mapRow);
    });
    for (const s of due) {
      try {
        await this.deliver(s);
      } catch (err) {
        this.logger.warn(`schedule ${s.id} delivery failed: ${(err as Error).message}`);
      }
      await this.tenantTx.run((m) =>
        m.query(`UPDATE report_schedule SET last_run_at=$2, next_run_at=$3, updated_at=now() WHERE id=$1`, [
          s.id,
          now.toISOString(),
          computeNextRun(timingOf(s), now).toISOString(),
        ]),
      );
    }
    return due.length;
  }

  /** Render the schedule's report and enqueue it as an email attachment to all recipients. */
  private async deliver(s: ReportSchedule): Promise<{ delivered: number; bytes: number; format: ReportFormat }> {
    const result = s.presetKey ? await this.builder.runPreset(s.presetKey) : await this.builder.runSaved(s.reportId!);
    const buf = await renderReport(s.format, { title: result.title ?? s.name, columns: result.columns, rows: result.rows });
    const { type, ext } = FORMAT_META[s.format];
    const filename = `${slug(result.title ?? s.name)}.${ext}`;
    const recipients = s.recipients.filter(Boolean);
    if (recipients.length) {
      await this.email.enqueue({
        to: recipients.join(', '),
        subject: `Scheduled report: ${result.title ?? s.name}`,
        text: `Attached is your scheduled report "${result.title ?? s.name}" (${result.rows.length} rows), generated ${new Date().toISOString()}.`,
        attachments: [{ filename, contentBase64: buf.toString('base64'), contentType: type }],
      });
    }
    return { delivered: recipients.length, bytes: buf.length, format: s.format };
  }

  private validateTarget(s: { presetKey?: string | null; reportId?: string | null }): void {
    const hasPreset = !!s.presetKey;
    const hasReport = !!s.reportId;
    if (hasPreset === hasReport) throw new BadRequestException('Provide exactly one of presetKey or reportId');
  }
}

function slug(s: string): string {
  return (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';
}
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
