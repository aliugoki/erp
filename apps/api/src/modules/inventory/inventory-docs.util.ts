/** Format a per-tenant document number, e.g. GRN-000004. */
export function formatDocNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/** Doc-type → number prefix for the running counter. */
export const DOC_PREFIX = {
  OPENING: 'OPN',
  ADJUST: 'ADJ',
  REQ: 'REQ',
  PO: 'PO',
  GRN: 'GRN',
  GP: 'GP',
  ISSUE: 'ISS',
  MRN: 'MRN',
} as const;

export type Row = Record<string, unknown>;

export function money(v: unknown, currency = 'PKR') {
  return { amountMinor: Number(v ?? 0), currency };
}

export function mapLedgerRow(r: Row) {
  return {
    id: r.id,
    productId: r.product_id,
    warehouseId: r.warehouse_id ?? null,
    docType: r.doc_type,
    docNo: r.doc_no ?? null,
    qtyIn: Number(r.qty_in),
    qtyOut: Number(r.qty_out),
    unitCost: money(r.unit_cost_minor),
    valueIn: money(r.value_in_minor),
    valueOut: money(r.value_out_minor),
    balanceQty: Number(r.balance_qty),
    balanceValue: money(r.balance_value_minor),
    occurredOn: r.occurred_on ?? null,
    narration: r.narration ?? null,
  };
}
