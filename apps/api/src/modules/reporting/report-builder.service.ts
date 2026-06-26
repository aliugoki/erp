import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateReportDto, RunReportDto } from './dto/reports.dto';
import { DATASETS, PRESETS, type ReportConfig, buildDistinctValuesQuery, buildReportQuery, datasetCatalog } from './report-builder';

type Row = Record<string, unknown>;
export interface DateRange {
  dateFrom?: string | null;
  dateTo?: string | null;
}

/** The report builder: lists datasets/presets, runs ad-hoc or saved report configs against the
 * whitelisted query compiler, and stores custom report definitions. All execution is RLS-scoped and
 * goes through {@link buildReportQuery}, which only emits whitelisted columns. */
@Injectable()
export class ReportBuilderService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  datasets() {
    return datasetCatalog();
  }

  presets() {
    return PRESETS.map((p) => ({ key: p.key, name: p.name, source: p.config.source }));
  }

  /** Execute a report config and return its columns + rows. */
  async run(config: ReportConfig) {
    let compiled;
    try {
      compiled = buildReportQuery(config);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(compiled.sql, compiled.params)) as Row[];
      return { columns: compiled.columns, rows };
    });
  }

  async runPreset(key: string, range?: DateRange) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) throw new NotFoundException('Preset not found');
    return { title: preset.name, ...(await this.run({ ...preset.config, ...range })) };
  }

  async runAdHoc(dto: RunReportDto) {
    const title = DATASETS[dto.source]?.label ?? 'Report';
    return {
      title,
      ...(await this.run({
        source: dto.source,
        columns: dto.columns ?? [],
        filters: dto.filters,
        groupBy: dto.groupBy ?? null,
        dateFrom: dto.dateFrom ?? null,
        dateTo: dto.dateTo ?? null,
        agg: dto.agg ?? null,
        measure: dto.measure ?? null,
      })),
    };
  }

  /** Distinct values for a filterable column — powers the explorer's filter dropdowns. */
  async distinctValues(source: string, column: string): Promise<string[]> {
    let compiled;
    try {
      compiled = buildDistinctValuesQuery(source, column);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(compiled.sql, compiled.params)) as Array<{ v: unknown }>;
      return rows.map((r) => String(r.v)).filter((v) => v.length > 0);
    });
  }

  // ── Saved custom reports ────────────────────────────────────────────────────
  async createReport(dto: CreateReportDto) {
    // Validate the config compiles before persisting.
    try {
      buildReportQuery({ source: dto.source, columns: dto.columns ?? [], filters: dto.filters, groupBy: dto.groupBy ?? null });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO rpt_report_definition (tenant_id, name, source, columns, filters, group_by)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3::jsonb,$4::jsonb,$5)
         RETURNING id, name, source, columns, filters, group_by`,
        [dto.name, dto.source, JSON.stringify(dto.columns ?? []), JSON.stringify(dto.filters ?? []), dto.groupBy ?? null],
      )) as Row[];
      return mapReport(rows[0]!);
    });
  }

  async listReports() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, source, columns, filters, group_by FROM rpt_report_definition WHERE deleted_at IS NULL ORDER BY name`,
      )) as Row[];
      return rows.map(mapReport);
    });
  }

  async runSaved(id: string, range?: DateRange) {
    const def = await this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT name, source, columns, filters, group_by FROM rpt_report_definition WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as Row[];
      return rows[0];
    });
    if (!def) throw new NotFoundException('Report not found');
    return {
      title: def.name as string,
      ...(await this.run({
        source: def.source as string,
        columns: (def.columns as string[]) ?? [],
        filters: (def.filters as { column: string; value: string }[]) ?? [],
        groupBy: (def.group_by as string | null) ?? null,
        dateFrom: range?.dateFrom ?? null,
        dateTo: range?.dateTo ?? null,
      })),
    };
  }

  async deleteReport(id: string) {
    await this.tenantTx.run(async (m) => {
      const res = (await m.query(
        `UPDATE rpt_report_definition SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      )) as unknown;
      const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res as unknown[]);
      if (!rows || rows.length === 0) throw new NotFoundException('Report not found');
    });
  }
}

function mapReport(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    source: r.source as string,
    columns: (r.columns as string[]) ?? [],
    filters: (r.filters as { column: string; value: string }[]) ?? [],
    groupBy: (r.group_by as string | null) ?? null,
  };
}
