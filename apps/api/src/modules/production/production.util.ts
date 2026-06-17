import type { Money } from '@metaxperts/shared';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Allocate the next per-tenant, per-type production document number (BOM-000001, MO-000001). */
export async function nextProdDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO production_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = production_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

/** Quantity of a component needed to make `plannedQty` units, scaled from a BOM that yields `outputQty`,
 * grossed up for scrap. Rounded UP — you can't issue a fraction of a discrete part. */
export function scaledRequiredQty(
  lineQty: number,
  scrapPct: number,
  plannedQty: number,
  outputQty: number,
): number {
  const base = (lineQty * plannedQty) / Math.max(outputQty, 1);
  return Math.ceil(base * (1 + (scrapPct || 0) / 100));
}

/** Cost of an operation = minutes × (rate per hour). Integer minor units. */
export function operationCostMinor(minutes: number, costPerHourMinor: number): number {
  return Math.round(((minutes || 0) / 60) * (costPerHourMinor || 0));
}

export interface CostBreakdown {
  materialMinor: number;
  operationMinor: number;
  overheadMinor: number;
  totalMinor: number;
  unitMinor: number;
}

/** Overhead = pct of (material + operation); total adds it in; unit = total / qty. */
export function rollUpCost(
  materialMinor: number,
  operationMinor: number,
  overheadPct: number,
  qty: number,
): CostBreakdown {
  const overheadMinor = Math.floor(((materialMinor + operationMinor) * (overheadPct || 0)) / 100);
  const totalMinor = materialMinor + operationMinor + overheadMinor;
  return { materialMinor, operationMinor, overheadMinor, totalMinor, unitMinor: qty > 0 ? Math.round(totalMinor / qty) : 0 };
}

export interface StdCostInputs {
  lines: { quantity: number; scrapPct: number; componentCostMinor: number }[];
  operations: { runMinutes: number; ratePerHourMinor: number }[];
  overheadPct: number;
  outputQty: number;
}

/** Standard (planned) cost of one BOM batch and per finished unit — the cost roll-up. */
export function bomStandardCost(i: StdCostInputs): CostBreakdown {
  const materialMinor = i.lines.reduce(
    (s, l) => s + Math.ceil(l.quantity * (1 + (l.scrapPct || 0) / 100)) * l.componentCostMinor,
    0,
  );
  const operationMinor = i.operations.reduce((s, o) => s + operationCostMinor(o.runMinutes, o.ratePerHourMinor), 0);
  return rollUpCost(materialMinor, operationMinor, i.overheadPct, i.outputQty);
}

// ── GL posting ──────────────────────────────────────────────────────────────
export interface ProductionGlAccounts {
  fgInventoryAccountId: string | null;
  rawMaterialsAccountId: string | null;
  laborAccountId: string | null;
  overheadAccountId: string | null;
}
export interface GlEntry {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
}
export interface GlVoucher {
  description: string;
  voucherType: 'JV';
  occurredOn: string;
  reference: string;
  entries: GlEntry[];
}

/**
 * Build the GL voucher for a completed production order: Dr finished-goods inventory (total), and a
 * credit for each non-zero cost component (raw materials, labour, overhead) to its account. Returns
 * null when the FG account is unset, the total is zero, or a non-zero component has no account (so the
 * caller skips rather than post an unbalanced voucher). Balanced: total = material + operation + overhead.
 */
export function productionVoucher(
  a: ProductionGlAccounts,
  p: { orderNo: string; producedAt: string; materialMinor: number; operationMinor: number; overheadMinor: number; totalMinor: number },
): GlVoucher | null {
  if (!a.fgInventoryAccountId || p.totalMinor <= 0) return null;
  const components: Array<[number, string | null]> = [
    [p.materialMinor, a.rawMaterialsAccountId],
    [p.operationMinor, a.laborAccountId],
    [p.overheadMinor, a.overheadAccountId],
  ];
  const credits: GlEntry[] = [];
  for (const [amount, accountId] of components) {
    if (amount > 0) {
      if (!accountId) return null; // a real cost with nowhere to credit → can't balance
      credits.push({ accountId, creditMinor: amount });
    }
  }
  if (credits.length === 0) return null;
  return {
    description: `Production ${p.orderNo}`,
    voucherType: 'JV',
    occurredOn: p.producedAt,
    reference: p.orderNo,
    entries: [{ accountId: a.fgInventoryAccountId, debitMinor: p.totalMinor }, ...credits],
  };
}

// ── Mappers ───────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const dateOnly = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string) ?? null);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : ((v as string) ?? null));

export function mapWorkCenter(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string) ?? null,
    costPerHour: money(r.cost_per_hour_minor, r.currency),
    status: r.status as string,
    notes: (r.notes as string) ?? null,
  };
}

export function mapBom(r: Row) {
  return {
    id: r.id as string,
    bomNo: r.bom_no as string,
    productId: r.product_id as string,
    name: r.name as string,
    outputQty: Number(r.output_qty ?? 1),
    version: Number(r.version ?? 1),
    status: r.status as string,
    overheadPct: Number(r.overhead_pct ?? 0),
    notes: (r.notes as string) ?? null,
  };
}

export function mapBomLine(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    componentProductId: r.component_product_id as string,
    componentName: (r.component_name as string) ?? null,
    quantity: Number(r.quantity ?? 0),
    scrapPct: Number(r.scrap_pct ?? 0),
    componentCost: r.component_cost_minor === undefined ? undefined : money(r.component_cost_minor, currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapBomOperation(r: Row) {
  return {
    id: r.id as string,
    workCenterId: (r.work_center_id as string) ?? null,
    workCenterName: (r.work_center_name as string) ?? null,
    sequence: Number(r.sequence ?? 1),
    name: r.name as string,
    runMinutes: Number(r.run_minutes ?? 0),
    notes: (r.notes as string) ?? null,
  };
}

export function mapOrder(r: Row) {
  const currency = r.currency;
  return {
    id: r.id as string,
    orderNo: r.order_no as string,
    productId: r.product_id as string,
    productName: (r.product_name as string) ?? null,
    bomId: (r.bom_id as string) ?? null,
    warehouseId: (r.warehouse_id as string) ?? null,
    plannedQty: Number(r.planned_qty ?? 0),
    producedQty: Number(r.produced_qty ?? 0),
    status: r.status as string,
    priority: r.priority as string,
    overheadPct: Number(r.overhead_pct ?? 0),
    plannedStart: dateOnly(r.planned_start),
    plannedEnd: dateOnly(r.planned_end),
    actualStart: iso(r.actual_start),
    actualEnd: iso(r.actual_end),
    materialCost: money(r.material_cost_minor, currency),
    operationCost: money(r.operation_cost_minor, currency),
    overhead: money(r.overhead_minor, currency),
    totalCost: money(r.total_cost_minor, currency),
    unitCost: money(r.unit_cost_minor, currency),
    notes: (r.notes as string) ?? null,
  };
}

export function mapOrderMaterial(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    componentProductId: r.component_product_id as string,
    componentName: (r.component_name as string) ?? null,
    requiredQty: Number(r.required_qty ?? 0),
    issuedQty: Number(r.issued_qty ?? 0),
    onHand: r.on_hand === undefined ? undefined : Number(r.on_hand ?? 0),
    unitCost: money(r.unit_cost_minor, currency),
    cost: money(r.cost_minor, currency),
  };
}

export function mapOrderOperation(r: Row, currency: unknown) {
  return {
    id: r.id as string,
    workCenterId: (r.work_center_id as string) ?? null,
    workCenterName: (r.work_center_name as string) ?? null,
    sequence: Number(r.sequence ?? 1),
    name: r.name as string,
    plannedMinutes: Number(r.planned_minutes ?? 0),
    actualMinutes: Number(r.actual_minutes ?? 0),
    cost: money(r.cost_minor, currency),
    status: r.status as string,
  };
}

export function mapAttribute(r: Row) {
  return {
    id: r.id as string,
    attrKey: r.attr_key as string,
    label: r.label as string,
    dataType: r.data_type as string,
    options: (r.options as string) ?? null,
    required: Boolean(r.required),
    sort: Number(r.sort ?? 0),
  };
}
