import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type AssetDepreciationPostedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  CreateAssetDto,
  CreateCategoryDto,
  CreateMaintenanceDto,
  DisposeAssetDto,
  RunDepreciationDto,
  UpdateAssetDto,
  UpdateCategoryDto,
} from './dto/assets.dto';
import {
  type AssetGlAccounts,
  type DepMethod,
  depreciationSchedule,
  mapAsset,
  mapCategory,
  mapDepreciation,
  mapMaintenance,
  mapRun,
  nextAssetDocNo,
  periodDepreciation,
  salvageFromPct,
} from './assets.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

const CAT_COLS = 'id, name, code, method, useful_life_months, salvage_pct, status';
const ASSET_COLS =
  'id, asset_no, name, category_id, description, status, acquisition_date, acquisition_cost_minor, salvage_value_minor, useful_life_months, method, depreciation_start, accumulated_depreciation_minor, currency, location, custodian_employee_id, serial_no, supplier, disposal_date, disposal_proceeds_minor, disposal_gain_minor, notes';
const RUN_COLS = 'id, run_no, period, status, asset_count, total_amount_minor, currency, notes';

/**
 * Fixed assets. Assets carry a depreciation policy; a periodic run writes one depreciation entry per
 * active asset (idempotent on asset+period), advancing accumulated depreciation toward (cost −
 * salvage). Disposal books the gain/loss vs net book value. Raw SQL via the tenant-scoped tx (RLS);
 * money is integer minor units. Depreciation totals post to finance via the outbox.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────────
  async createCategory(dto: CreateCategoryDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO asset_category (tenant_id, name, code, method, useful_life_months, salvage_pct)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2, COALESCE($3,'STRAIGHT_LINE'), COALESCE($4,60), COALESCE($5,0)) RETURNING ${CAT_COLS}`,
        [dto.name, dto.code ?? null, dto.method ?? null, dto.usefulLifeMonths ?? null, dto.salvagePct ?? null],
      )) as Row[];
      return mapCategory(rows[0]!);
    });
  }

  async listCategories() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${CAT_COLS} FROM asset_category WHERE deleted_at IS NULL ORDER BY name`)) as Row[];
      return rows.map(mapCategory);
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.code !== undefined) set('code', dto.code);
      if (dto.method !== undefined) set('method', dto.method);
      if (dto.usefulLifeMonths !== undefined) set('useful_life_months', dto.usefulLifeMonths);
      if (dto.salvagePct !== undefined) set('salvage_pct', dto.salvagePct);
      if (dto.status !== undefined) set('status', dto.status);
      if (!sets.length) { const r = (await m.query(`SELECT ${CAT_COLS} FROM asset_category WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[]; if (!r[0]) throw new NotFoundException('Category not found'); return mapCategory(r[0]); }
      const rows = rowsOf(await m.query(`UPDATE asset_category SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING ${CAT_COLS}`, params)) as Row[];
      if (!rows[0]) throw new NotFoundException('Category not found');
      return mapCategory(rows[0]);
    });
  }

  async deleteCategory(id: string) {
    await this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(`UPDATE asset_category SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Category not found');
    });
  }

  // ── Assets ──────────────────────────────────────────────────────────────────
  async createAsset(dto: CreateAssetDto) {
    return this.tenantTx.run(async (m) => {
      let method: DepMethod = (dto.method as DepMethod) ?? 'STRAIGHT_LINE';
      let usefulLife = dto.usefulLifeMonths ?? 60;
      let salvage = dto.salvageValueMinor ?? 0;
      if (dto.categoryId) {
        const cat = (await m.query(`SELECT method, useful_life_months, salvage_pct FROM asset_category WHERE id=$1 AND deleted_at IS NULL`, [dto.categoryId])) as Row[];
        if (!cat[0]) throw new BadRequestException('Category not found');
        method = (dto.method as DepMethod) ?? (cat[0].method as DepMethod);
        usefulLife = dto.usefulLifeMonths ?? Number(cat[0].useful_life_months);
        salvage = dto.salvageValueMinor ?? salvageFromPct(dto.acquisitionCostMinor, Number(cat[0].salvage_pct));
      }
      const assetNo = await nextAssetDocNo(m, 'FA', 'FA');
      const depStart = dto.depreciationStart ?? dto.acquisitionDate ?? null;
      try {
        const rows = (await m.query(
          `INSERT INTO asset (tenant_id, asset_no, name, category_id, description, acquisition_date, acquisition_cost_minor,
             salvage_value_minor, useful_life_months, method, depreciation_start, currency, location, custodian_employee_id, serial_no, supplier, notes)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11,'PKR'),$12,$13,$14,$15,$16) RETURNING ${ASSET_COLS}`,
          [assetNo, dto.name, dto.categoryId ?? null, dto.description ?? null, dto.acquisitionDate ?? null, dto.acquisitionCostMinor,
            salvage, usefulLife, method, depStart, dto.currency ?? null, dto.location ?? null, dto.custodianEmployeeId ?? null,
            dto.serialNo ?? null, dto.supplier ?? null, dto.notes ?? null],
        )) as Row[];
        return mapAsset(rows[0]!);
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown category or custodian for this tenant');
        throw err;
      }
    });
  }

  async listAssets(status?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT a.${ASSET_COLS.split(', ').join(', a.')}, c.name AS category_name,
           (e.first_name || ' ' || e.last_name) AS custodian_name
         FROM asset a
         LEFT JOIN asset_category c ON c.id = a.category_id
         LEFT JOIN hr_employee e ON e.id = a.custodian_employee_id
         WHERE a.deleted_at IS NULL ${status ? 'AND a.status=$1' : ''} ORDER BY a.created_at DESC`,
        status ? [status] : [],
      )) as Row[];
      return rows.map(mapAsset);
    });
  }

  async getAsset(id: string) {
    return this.tenantTx.run((m) => this.getAssetWith(m, id));
  }

  async updateAsset(id: string, dto: UpdateAssetDto) {
    return this.tenantTx.run(async (m) => {
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (c: string, v: unknown) => { sets.push(`${c}=$${params.length + 1}`); params.push(v); };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.description !== undefined) set('description', dto.description);
      if (dto.location !== undefined) set('location', dto.location);
      if (dto.custodianEmployeeId !== undefined) set('custodian_employee_id', dto.custodianEmployeeId);
      if (dto.serialNo !== undefined) set('serial_no', dto.serialNo);
      if (dto.supplier !== undefined) set('supplier', dto.supplier);
      if (dto.notes !== undefined) set('notes', dto.notes);
      if (sets.length) {
        const rows = rowsOf(await m.query(`UPDATE asset SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, params)) as Row[];
        if (!rows[0]) throw new NotFoundException('Asset not found');
      }
      return this.getAssetWith(m, id);
    });
  }

  async activateAsset(id: string) {
    return this.tenantTx.run(async (m) => {
      const a = await this.lockAsset(m, id);
      if (a.status !== 'DRAFT') throw new UnprocessableEntityException(`Cannot activate a ${String(a.status)} asset`);
      if (Number(a.acquisition_cost_minor) <= 0) throw new UnprocessableEntityException('Set an acquisition cost before activating');
      await m.query(`UPDATE asset SET status='ACTIVE', updated_at=now() WHERE id=$1`, [id]);
      return this.getAssetWith(m, id);
    });
  }

  /** Dispose an asset: book value = cost − accumulated; gain/loss = proceeds − book value. */
  async disposeAsset(id: string, dto: DisposeAssetDto) {
    return this.tenantTx.run(async (m) => {
      const a = await this.lockAsset(m, id);
      if (!['ACTIVE', 'DRAFT'].includes(a.status as string)) throw new UnprocessableEntityException(`Cannot dispose a ${String(a.status)} asset`);
      const bookValue = Number(a.acquisition_cost_minor) - Number(a.accumulated_depreciation_minor);
      const proceeds = dto.proceedsMinor ?? 0;
      const gain = proceeds - bookValue;
      await m.query(
        `UPDATE asset SET status='DISPOSED', disposal_date=COALESCE($2::date, current_date), disposal_proceeds_minor=$3, disposal_gain_minor=$4, updated_at=now() WHERE id=$1`,
        [id, dto.disposalDate ?? null, proceeds, gain],
      );
      return this.getAssetWith(m, id);
    });
  }

  async writeOffAsset(id: string) {
    return this.tenantTx.run(async (m) => {
      const a = await this.lockAsset(m, id);
      if (['DISPOSED', 'WRITTEN_OFF'].includes(a.status as string)) throw new UnprocessableEntityException('Asset already closed');
      const bookValue = Number(a.acquisition_cost_minor) - Number(a.accumulated_depreciation_minor);
      await m.query(
        `UPDATE asset SET status='WRITTEN_OFF', disposal_date=current_date, disposal_proceeds_minor=0, disposal_gain_minor=$2, updated_at=now() WHERE id=$1`,
        [id, -bookValue],
      );
      return this.getAssetWith(m, id);
    });
  }

  /** Preview the remaining depreciation schedule for an asset. */
  async schedule(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${ASSET_COLS} FROM asset WHERE id=$1 AND deleted_at IS NULL`, [id])) as Row[];
      if (!rows[0]) throw new NotFoundException('Asset not found');
      const a = rows[0];
      const currency = a.currency as string;
      const rowsSched = depreciationSchedule({
        method: a.method as DepMethod,
        costMinor: Number(a.acquisition_cost_minor),
        salvageMinor: Number(a.salvage_value_minor),
        usefulLifeMonths: Number(a.useful_life_months),
      });
      return rowsSched.map((r) => ({
        period: r.period,
        amount: { amountMinor: r.amountMinor, currency },
        accumulated: { amountMinor: r.accumulatedMinor, currency },
        bookValue: { amountMinor: r.bookValueMinor, currency },
      }));
    });
  }

  // ── Depreciation runs ─────────────────────────────────────────────────────────
  async runDepreciation(dto: RunDepreciationDto) {
    return this.tenantTx.run(async (m) => {
      const assets = (await m.query(
        `SELECT id, asset_no, method, acquisition_cost_minor, salvage_value_minor, useful_life_months,
                accumulated_depreciation_minor, currency
         FROM asset
         WHERE deleted_at IS NULL AND status='ACTIVE' AND method <> 'NONE'
           AND depreciation_start IS NOT NULL AND depreciation_start <= $1::date
           AND (acquisition_cost_minor - accumulated_depreciation_minor) > salvage_value_minor
           AND NOT EXISTS (SELECT 1 FROM asset_depreciation d WHERE d.asset_id = asset.id AND d.period = $1::date AND d.deleted_at IS NULL)
         FOR UPDATE`,
        [dto.period],
      )) as Row[];
      if (assets.length === 0) {
        throw new UnprocessableEntityException('No assets are due for depreciation in this period');
      }

      const runNo = await nextAssetDocNo(m, 'DEP', 'DEP');
      const currency = (assets[0]!.currency as string) ?? 'PKR';
      const runRows = (await m.query(
        `INSERT INTO asset_depreciation_run (tenant_id, run_no, period, currency) VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3) RETURNING id`,
        [runNo, dto.period, currency],
      )) as Row[];
      const runId = runRows[0]!.id as string;

      let total = 0;
      let count = 0;
      for (const a of assets) {
        const elapsed = Number(((await m.query(`SELECT count(*) AS c FROM asset_depreciation WHERE asset_id=$1 AND deleted_at IS NULL`, [a.id])) as Array<{ c: string }>)[0]!.c);
        const cost = Number(a.acquisition_cost_minor);
        const accumulated = Number(a.accumulated_depreciation_minor);
        const amount = periodDepreciation({
          method: a.method as DepMethod,
          costMinor: cost,
          salvageMinor: Number(a.salvage_value_minor),
          usefulLifeMonths: Number(a.useful_life_months),
          bookValueMinor: cost - accumulated,
          monthsElapsed: elapsed,
        });
        if (amount <= 0) continue;
        const newAccum = accumulated + amount;
        await m.query(
          `INSERT INTO asset_depreciation (tenant_id, asset_id, run_id, period, amount_minor, accumulated_after_minor, book_value_after_minor, method)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)`,
          [a.id, runId, dto.period, amount, newAccum, cost - newAccum, a.method],
        );
        await m.query(`UPDATE asset SET accumulated_depreciation_minor=$2, updated_at=now() WHERE id=$1`, [a.id, newAccum]);
        total += amount;
        count += 1;
      }

      await m.query(`UPDATE asset_depreciation_run SET asset_count=$2, total_amount_minor=$3, notes=$4 WHERE id=$1`, [runId, count, total, dto.notes ?? null]);
      const payload: AssetDepreciationPostedV1 = { runId, runNo, period: dto.period, assetCount: count, totalMinor: total, currency };
      await this.outbox.write(m, EVENT_TYPES.ASSET_DEPRECIATION_POSTED, payload);

      const run = (await m.query(`SELECT ${RUN_COLS} FROM asset_depreciation_run WHERE id=$1`, [runId])) as Row[];
      return mapRun(run[0]!);
    });
  }

  async listRuns() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${RUN_COLS} FROM asset_depreciation_run WHERE deleted_at IS NULL ORDER BY period DESC, created_at DESC LIMIT 100`)) as Row[];
      return rows.map(mapRun);
    });
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────────
  async createMaintenance(dto: CreateMaintenanceDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO asset_maintenance (tenant_id, asset_id, maint_date, type, description, cost_minor, vendor, next_due_date)
           VALUES (current_setting('app.tenant_id')::uuid, $1, COALESCE($2::date, current_date), COALESCE($3,'SERVICE'), $4, COALESCE($5,0), $6, $7)
           RETURNING id, asset_id, maint_date, type, description, cost_minor, vendor, next_due_date`,
          [dto.assetId, dto.maintDate ?? null, dto.type ?? null, dto.description ?? null, dto.costMinor ?? null, dto.vendor ?? null, dto.nextDueDate ?? null],
        )) as Row[];
        return mapMaintenance(rows[0]!, 'PKR');
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown asset for this tenant');
        throw err;
      }
    });
  }

  async listMaintenance(assetId?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT mt.id, mt.asset_id, mt.maint_date, mt.type, mt.description, mt.cost_minor, mt.vendor, mt.next_due_date, a.name AS asset_name, a.currency
         FROM asset_maintenance mt JOIN asset a ON a.id = mt.asset_id
         WHERE mt.deleted_at IS NULL ${assetId ? 'AND mt.asset_id=$1' : ''} ORDER BY mt.maint_date DESC LIMIT 200`,
        assetId ? [assetId] : [],
      )) as Row[];
      return rows.map((r) => mapMaintenance(r, r.currency));
    });
  }

  /** Maintenance scheduled to come due within `days` (default 30). */
  async upcomingMaintenance(days = 30) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT mt.id, mt.asset_id, mt.maint_date, mt.type, mt.description, mt.cost_minor, mt.vendor, mt.next_due_date, a.name AS asset_name, a.currency
         FROM asset_maintenance mt JOIN asset a ON a.id = mt.asset_id
         WHERE mt.deleted_at IS NULL AND mt.next_due_date IS NOT NULL
           AND mt.next_due_date <= current_date + ($1 || ' days')::interval
         ORDER BY mt.next_due_date ASC LIMIT 100`,
        [String(Math.max(0, days))],
      )) as Row[];
      return rows.map((r) => mapMaintenance(r, r.currency));
    });
  }

  // ── Reports ───────────────────────────────────────────────────────────────────
  /** Asset register summarized by category: count, cost, accumulated, net book value. */
  async register() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT COALESCE(c.name,'Uncategorized') AS category, MIN(a.currency) AS currency, COUNT(*) AS count,
           COALESCE(SUM(a.acquisition_cost_minor),0) AS cost_minor,
           COALESCE(SUM(a.accumulated_depreciation_minor),0) AS accumulated_minor,
           COALESCE(SUM(a.acquisition_cost_minor - a.accumulated_depreciation_minor),0) AS book_value_minor
         FROM asset a LEFT JOIN asset_category c ON c.id = a.category_id
         WHERE a.deleted_at IS NULL AND a.status IN ('ACTIVE','DRAFT')
         GROUP BY c.name ORDER BY book_value_minor DESC`,
      )) as Row[];
      return rows.map((r) => ({
        category: r.category as string,
        count: Number(r.count),
        cost: { amountMinor: Number(r.cost_minor), currency: (r.currency as string) ?? 'PKR' },
        accumulated: { amountMinor: Number(r.accumulated_minor), currency: (r.currency as string) ?? 'PKR' },
        bookValue: { amountMinor: Number(r.book_value_minor), currency: (r.currency as string) ?? 'PKR' },
      }));
    });
  }

  // ── GL posting config ─────────────────────────────────────────────────────────
  /** The accounts a depreciation run posts to (Dr expense, Cr accumulated). Nulls when unconfigured. */
  async getGlConfig(): Promise<AssetGlAccounts> {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async setGlConfig(dto: { expenseAccountId?: string; accumulatedAccountId?: string }): Promise<AssetGlAccounts> {
    return this.tenantTx.run(async (m) => {
      try {
        await m.query(
          `INSERT INTO asset_gl_config (tenant_id, depreciation_expense_account_id, accumulated_depreciation_account_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET depreciation_expense_account_id=EXCLUDED.depreciation_expense_account_id,
             accumulated_depreciation_account_id=EXCLUDED.accumulated_depreciation_account_id, updated_at=now()`,
          [dto.expenseAccountId ?? null, dto.accumulatedAccountId ?? null],
        );
      } catch (err) {
        if (isFk(err)) throw new BadRequestException('Unknown finance account for this tenant');
        throw err;
      }
      return this.glConfigInTx(m);
    });
  }

  /** Read the GL config inside an existing tenant transaction (used by the depreciation consumer). */
  async glConfigInTx(m: Mgr): Promise<AssetGlAccounts> {
    const rows = (await m.query(
      `SELECT depreciation_expense_account_id AS exp, accumulated_depreciation_account_id AS acc
       FROM asset_gl_config WHERE deleted_at IS NULL LIMIT 1`,
    )) as Array<{ exp: string | null; acc: string | null }>;
    return { expenseAccountId: rows[0]?.exp ?? null, accumulatedAccountId: rows[0]?.acc ?? null };
  }

  // ── internals ─────────────────────────────────────────────────────────────────
  private async lockAsset(m: Mgr, id: string): Promise<Row> {
    const rows = (await m.query(`SELECT ${ASSET_COLS} FROM asset WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Asset not found');
    return rows[0];
  }

  private async getAssetWith(m: Mgr, id: string) {
    const rows = (await m.query(
      `SELECT a.${ASSET_COLS.split(', ').join(', a.')}, c.name AS category_name,
         (e.first_name || ' ' || e.last_name) AS custodian_name
       FROM asset a LEFT JOIN asset_category c ON c.id = a.category_id LEFT JOIN hr_employee e ON e.id = a.custodian_employee_id
       WHERE a.id=$1 AND a.deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Asset not found');
    const currency = rows[0].currency;
    const depreciation = (await m.query(
      `SELECT id, period, amount_minor, accumulated_after_minor, book_value_after_minor, method
       FROM asset_depreciation WHERE asset_id=$1 AND deleted_at IS NULL ORDER BY period DESC`,
      [id],
    )) as Row[];
    const maintenance = (await m.query(
      `SELECT id, asset_id, maint_date, type, description, cost_minor, vendor, next_due_date
       FROM asset_maintenance WHERE asset_id=$1 AND deleted_at IS NULL ORDER BY maint_date DESC`,
      [id],
    )) as Row[];
    return {
      ...mapAsset(rows[0]),
      depreciation: depreciation.map((d) => mapDepreciation(d, currency)),
      maintenance: maintenance.map((mt) => mapMaintenance(mt, currency)),
    };
  }
}

/** TypeORM returns [rows, affectedCount] for UPDATE…RETURNING; normalize to the rows array. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
const isFk = (e: unknown) => (e as { code?: string })?.code === '23503';
