import type { Money } from '@metaxperts/shared';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Allocate the next per-tenant, per-type asset document number (FA-000001, DEP-000001). */
export async function nextAssetDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO asset_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = asset_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

export type DepMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'NONE';

export interface DepInput {
  method: DepMethod;
  costMinor: number;
  salvageMinor: number;
  usefulLifeMonths: number;
  /** Net book value at the start of the period (cost − accumulated so far). */
  bookValueMinor: number;
  /** Periods already depreciated — drives the final-period catch-up to salvage. */
  monthsElapsed: number;
}

/**
 * Depreciation for ONE period, clamped so book value never drops below salvage, and the final
 * scheduled period absorbs any rounding remainder (book value lands exactly on salvage at end of life):
 *  - STRAIGHT_LINE: (cost − salvage) / life, flat each period.
 *  - DECLINING_BALANCE: double-declining — book value × (2 / life), tapering, with a salvage floor.
 */
export function periodDepreciation(i: DepInput): number {
  if (i.method === 'NONE' || i.usefulLifeMonths <= 0) return 0;
  const remaining = Math.max(0, i.bookValueMinor - i.salvageMinor);
  if (remaining <= 0) return 0;
  if (i.monthsElapsed >= i.usefulLifeMonths - 1) return remaining; // final period → depreciate to salvage
  const base =
    i.method === 'STRAIGHT_LINE'
      ? Math.floor((i.costMinor - i.salvageMinor) / i.usefulLifeMonths)
      : Math.round(i.bookValueMinor * (2 / i.usefulLifeMonths));
  return Math.min(Math.max(base, 0), remaining);
}

export interface ScheduleRow {
  period: number; // 1-based period index
  amountMinor: number;
  accumulatedMinor: number;
  bookValueMinor: number;
}

/** Full depreciation schedule from acquisition — for preview. Terminates at salvage (≤ life rows). */
export function depreciationSchedule(input: Omit<DepInput, 'bookValueMinor' | 'monthsElapsed'>): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let bookValue = input.costMinor;
  let accumulated = 0;
  for (let p = 0; p < input.usefulLifeMonths; p++) {
    const amount = periodDepreciation({ ...input, bookValueMinor: bookValue, monthsElapsed: p });
    if (amount <= 0) break;
    bookValue -= amount;
    accumulated += amount;
    rows.push({ period: p + 1, amountMinor: amount, accumulatedMinor: accumulated, bookValueMinor: bookValue });
    if (bookValue <= input.salvageMinor) break;
  }
  return rows;
}

/** Salvage value in minor units from a percentage of cost. */
export function salvageFromPct(costMinor: number, salvagePct: number): number {
  return Math.round((costMinor * (salvagePct || 0)) / 100);
}

// ── Mappers ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const dateOnly = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string) ?? null));

export function mapCategory(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    method: r.method as string,
    usefulLifeMonths: Number(r.useful_life_months ?? 0),
    salvagePct: Number(r.salvage_pct ?? 0),
    status: r.status as string,
  };
}

export function mapAsset(r: Row) {
  const currency = r.currency;
  const cost = Number(r.acquisition_cost_minor ?? 0);
  const accumulated = Number(r.accumulated_depreciation_minor ?? 0);
  return {
    id: r.id as string,
    assetNo: r.asset_no as string,
    name: r.name as string,
    categoryId: (r.category_id as string) ?? null,
    categoryName: (r.category_name as string) ?? null,
    description: (r.description as string) ?? null,
    status: r.status as string,
    acquisitionDate: dateOnly(r.acquisition_date),
    acquisitionCost: money(cost, currency),
    salvageValue: money(r.salvage_value_minor, currency),
    usefulLifeMonths: Number(r.useful_life_months ?? 0),
    method: r.method as string,
    depreciationStart: dateOnly(r.depreciation_start),
    accumulatedDepreciation: money(accumulated, currency),
    bookValue: money(cost - accumulated, currency),
    location: (r.location as string) ?? null,
    custodianEmployeeId: (r.custodian_employee_id as string) ?? null,
    custodianName: (r.custodian_name as string) ?? null,
    serialNo: (r.serial_no as string) ?? null,
    supplier: (r.supplier as string) ?? null,
    disposalDate: dateOnly(r.disposal_date),
    disposalProceeds: r.disposal_proceeds_minor == null ? null : money(r.disposal_proceeds_minor, currency),
    disposalGain: r.disposal_gain_minor == null ? null : money(r.disposal_gain_minor, currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapDepreciation(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    period: dateOnly(r.period),
    amount: money(r.amount_minor, currency),
    accumulatedAfter: money(r.accumulated_after_minor, currency),
    bookValueAfter: money(r.book_value_after_minor, currency),
    method: r.method as string,
  };
}

export function mapRun(r: Row) {
  return {
    id: r.id as string,
    runNo: r.run_no as string,
    period: dateOnly(r.period),
    status: r.status as string,
    assetCount: Number(r.asset_count ?? 0),
    total: money(r.total_amount_minor, r.currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapMaintenance(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    assetId: r.asset_id as string,
    assetName: (r.asset_name as string) ?? null,
    maintDate: dateOnly(r.maint_date),
    type: r.type as string,
    description: (r.description as string) ?? null,
    cost: money(r.cost_minor, currency),
    vendor: (r.vendor as string) ?? null,
    nextDueDate: dateOnly(r.next_due_date),
  };
}
