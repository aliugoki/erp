/**
 * Report builder model + a pure, injection-safe query compiler.
 *
 * Every report runs against a server-defined DATASET — never raw user SQL. A dataset whitelists its
 * table, the selectable columns (each with a label + the exact SQL expression), the columns that may
 * be filtered, and the columns that may be grouped. `buildReportQuery` only ever emits identifiers
 * drawn from that whitelist and binds all filter VALUES as parameters, so a saved/ad-hoc report can
 * never reach beyond its dataset or inject SQL. RLS still scopes every row to the tenant.
 */

export interface ColumnDef {
  label: string;
  /** SQL expression (column or simple cast) — always from this file, never user input. */
  sql: string;
  /** True for *_minor money columns, so the UI formats them. */
  money?: boolean;
}

export interface DatasetDef {
  key: string;
  label: string;
  table: string;
  columns: Record<string, ColumnDef>;
  filterable: string[];
  groupable: string[];
  /** Numeric/money columns that may be aggregated (sum/avg/min/max) as a grouped measure. */
  aggregatable: string[];
}

export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max';
const AGGS: Agg[] = ['count', 'sum', 'avg', 'min', 'max'];
const AGG_LABEL: Record<Agg, string> = { count: 'Count', sum: 'Total', avg: 'Average', min: 'Minimum', max: 'Maximum' };

export const DATASETS: Record<string, DatasetDef> = {
  crm_deals: {
    key: 'crm_deals',
    label: 'CRM — Opportunities',
    table: 'crm_deal',
    columns: {
      title: { label: 'Title', sql: 'title' },
      stage: { label: 'Stage', sql: 'stage' },
      value_minor: { label: 'Value', sql: 'value_minor', money: true },
      probability: { label: 'Probability %', sql: 'probability' },
      created: { label: 'Created', sql: "to_char(created_at,'YYYY-MM-DD')" },
      created_month: { label: 'Month', sql: "to_char(created_at,'YYYY-MM')" },
    },
    filterable: ['stage'],
    groupable: ['stage', 'created_month'],
    aggregatable: ['value_minor', 'probability'],
  },
  crm_leads: {
    key: 'crm_leads',
    label: 'CRM — Leads',
    table: 'crm_lead',
    columns: {
      lead_no: { label: 'Lead #', sql: 'lead_no' },
      name: { label: 'Name', sql: 'name' },
      company: { label: 'Company', sql: 'company' },
      status: { label: 'Status', sql: 'status' },
      rating: { label: 'Rating', sql: 'rating' },
      est_value_minor: { label: 'Est. value', sql: 'est_value_minor', money: true },
    },
    filterable: ['status', 'rating'],
    groupable: ['status', 'rating'],
    aggregatable: ['est_value_minor'],
  },
  hr_employees: {
    key: 'hr_employees',
    label: 'HR — Employees',
    table: 'hr_employee',
    columns: {
      employee_code: { label: 'Code', sql: 'employee_code' },
      name: { label: 'Name', sql: "(first_name || ' ' || last_name)" },
      status: { label: 'Status', sql: 'status' },
      designation: { label: 'Designation', sql: 'designation' },
      city: { label: 'City', sql: 'city' },
      employment_type: { label: 'Employment', sql: 'employment_type' },
      salary_amount_minor: { label: 'Salary', sql: 'salary_amount_minor', money: true },
    },
    filterable: ['status', 'employment_type', 'city'],
    groupable: ['status', 'designation', 'city', 'employment_type'],
    aggregatable: ['salary_amount_minor'],
  },
  hr_leave_requests: {
    key: 'hr_leave_requests',
    label: 'HR — Leave requests',
    table: 'hr_leave_request',
    columns: {
      leave_no: { label: 'Leave #', sql: 'leave_no' },
      status: { label: 'Status', sql: 'status' },
      days: { label: 'Days', sql: 'days' },
    },
    filterable: ['status'],
    groupable: ['status'],
    aggregatable: ['days'],
  },
  inventory_products: {
    key: 'inventory_products',
    label: 'Inventory — Products',
    table: 'inventory_product',
    columns: {
      sku: { label: 'SKU', sql: 'sku' },
      name: { label: 'Name', sql: 'name' },
      category: { label: 'Category', sql: "COALESCE(NULLIF(category,''), 'Uncategorized')" },
      on_hand: { label: 'On hand', sql: 'on_hand' },
      min_stock: { label: 'Min stock', sql: 'min_stock' },
      cost_price_minor: { label: 'Cost', sql: 'cost_price_minor', money: true },
      sell_price_minor: { label: 'Sell price', sql: 'sell_price_minor', money: true },
    },
    filterable: ['category'],
    groupable: ['category'],
    aggregatable: ['on_hand', 'min_stock', 'cost_price_minor', 'sell_price_minor'],
  },
  finance_invoices: {
    key: 'finance_invoices',
    label: 'Finance — Invoices',
    table: 'finance_invoice',
    columns: {
      number: { label: 'Invoice #', sql: 'number' },
      status: { label: 'Status', sql: 'status' },
      subtotal_minor: { label: 'Subtotal', sql: 'subtotal_minor', money: true },
      total_minor: { label: 'Total', sql: 'total_minor', money: true },
      due_date: { label: 'Due', sql: "to_char(due_date,'YYYY-MM-DD')" },
      created: { label: 'Created', sql: "to_char(created_at,'YYYY-MM-DD')" },
      created_month: { label: 'Month', sql: "to_char(created_at,'YYYY-MM')" },
    },
    filterable: ['status'],
    groupable: ['status', 'created_month'],
    aggregatable: ['subtotal_minor', 'total_minor'],
  },
  pos_sales: {
    key: 'pos_sales',
    label: 'POS — Sales',
    table: 'pos_sale',
    columns: {
      sale_no: { label: 'Sale #', sql: 'sale_no' },
      status: { label: 'Status', sql: 'status' },
      total_minor: { label: 'Total', sql: 'total_minor', money: true },
      created: { label: 'Created', sql: "to_char(created_at,'YYYY-MM-DD')" },
      created_month: { label: 'Month', sql: "to_char(created_at,'YYYY-MM')" },
    },
    filterable: ['status'],
    groupable: ['status', 'created_month'],
    aggregatable: ['total_minor'],
  },
};

export interface ReportConfig {
  source: string;
  columns: string[];
  filters?: { column: string; value: string }[];
  groupBy?: string | null;
  /** Optional inclusive date range on the row's `created_at` (ISO `YYYY-MM-DD`). */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Grouped measure: the aggregate (default `count`) and, for sum/avg/min/max, the column to aggregate. */
  agg?: Agg | null;
  measure?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CompiledReport {
  sql: string;
  params: unknown[];
  columns: { key: string; label: string; money?: boolean }[];
}

const LIST_LIMIT = 500;

/** Compile a report config into a parameterized SQL query against its dataset. Throws if anything
 * references a column outside the dataset's whitelist (the injection boundary). */
export function buildReportQuery(config: ReportConfig): CompiledReport {
  const ds = DATASETS[config.source];
  if (!ds) throw new Error(`Unknown dataset "${config.source}"`);

  const where: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  for (const f of config.filters ?? []) {
    if (!ds.filterable.includes(f.column)) throw new Error(`Column "${f.column}" is not filterable on ${ds.key}`);
    params.push(f.value);
    where.push(`${ds.columns[f.column]!.sql} = $${params.length}`);
  }
  // Inclusive date range on created_at (every dataset table extends BaseEntity, so the column exists).
  if (config.dateFrom) {
    if (!ISO_DATE.test(config.dateFrom)) throw new Error('dateFrom must be an ISO date (YYYY-MM-DD)');
    params.push(config.dateFrom);
    where.push(`created_at::date >= $${params.length}::date`);
  }
  if (config.dateTo) {
    if (!ISO_DATE.test(config.dateTo)) throw new Error('dateTo must be an ISO date (YYYY-MM-DD)');
    params.push(config.dateTo);
    where.push(`created_at::date <= $${params.length}::date`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  // Group mode: <groupCol> + an aggregate measure (count by default).
  if (config.groupBy) {
    if (!ds.groupable.includes(config.groupBy)) throw new Error(`Column "${config.groupBy}" is not groupable on ${ds.key}`);
    const col = ds.columns[config.groupBy]!;
    const agg: Agg = config.agg ?? 'count';
    if (!AGGS.includes(agg)) throw new Error(`Unknown aggregate "${agg}"`);

    if (agg !== 'count') {
      if (!config.measure || !ds.aggregatable.includes(config.measure)) {
        throw new Error(`Column "${config.measure}" is not aggregatable on ${ds.key}`);
      }
      const m = ds.columns[config.measure]!;
      // sum/min/max stay integral (money is minor units); avg is rounded to whole minor units.
      const expr =
        agg === 'sum' ? `COALESCE(SUM(${m.sql}), 0)::bigint`
        : agg === 'avg' ? `COALESCE(ROUND(AVG(${m.sql})), 0)::bigint`
        : `${agg.toUpperCase()}(${m.sql})::bigint`;
      return {
        sql: `SELECT ${col.sql} AS "${config.groupBy}", ${expr} AS "value"
              FROM ${ds.table} ${whereSql} GROUP BY ${col.sql} ORDER BY "value" DESC`,
        params,
        columns: [
          { key: config.groupBy, label: col.label },
          { key: 'value', label: `${AGG_LABEL[agg]} ${m.label}`, money: m.money },
        ],
      };
    }

    return {
      sql: `SELECT ${col.sql} AS "${config.groupBy}", count(*)::int AS "count"
            FROM ${ds.table} ${whereSql} GROUP BY ${col.sql} ORDER BY count DESC`,
      params,
      columns: [
        { key: config.groupBy, label: col.label },
        { key: 'count', label: 'Count' },
      ],
    };
  }

  // List mode: the selected whitelisted columns.
  const cols = config.columns.filter((c) => ds.columns[c]);
  if (cols.length === 0) throw new Error('Select at least one valid column');
  const select = cols.map((c) => `${ds.columns[c]!.sql} AS "${c}"`).join(', ');
  return {
    sql: `SELECT ${select} FROM ${ds.table} ${whereSql} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`,
    params,
    columns: cols.map((c) => ({ key: c, label: ds.columns[c]!.label, money: ds.columns[c]!.money })),
  };
}

/** Dataset metadata for the builder UI (no SQL leaked). */
export function datasetCatalog() {
  return Object.values(DATASETS).map((d) => ({
    key: d.key,
    label: d.label,
    columns: Object.entries(d.columns).map(([key, c]) => ({ key, label: c.label, money: !!c.money })),
    filterable: d.filterable,
    groupable: d.groupable,
    aggregatable: d.aggregatable,
  }));
}

/** Compile a parameterized DISTINCT-values query for a filterable column (for filter dropdowns). */
export function buildDistinctValuesQuery(source: string, column: string): { sql: string; params: unknown[] } {
  const ds = DATASETS[source];
  if (!ds) throw new Error(`Unknown dataset "${source}"`);
  if (!ds.filterable.includes(column)) throw new Error(`Column "${column}" is not filterable on ${ds.key}`);
  const col = ds.columns[column]!;
  return {
    sql: `SELECT DISTINCT ${col.sql} AS v FROM ${ds.table}
          WHERE deleted_at IS NULL AND ${col.sql} IS NOT NULL AND ${col.sql} <> ''
          ORDER BY v LIMIT 200`,
    params: [],
  };
}

export interface PresetDef {
  key: string;
  name: string;
  config: ReportConfig;
}

/** Built-in canned reports. */
export const PRESETS: PresetDef[] = [
  { key: 'employees-by-status', name: 'Employees by status', config: { source: 'hr_employees', columns: [], groupBy: 'status' } },
  { key: 'employees-by-designation', name: 'Employees by designation', config: { source: 'hr_employees', columns: [], groupBy: 'designation' } },
  { key: 'open-deals-by-stage', name: 'Opportunities by stage', config: { source: 'crm_deals', columns: [], groupBy: 'stage' } },
  { key: 'leads-by-rating', name: 'Leads by rating', config: { source: 'crm_leads', columns: [], groupBy: 'rating' } },
  { key: 'leave-by-status', name: 'Leave requests by status', config: { source: 'hr_leave_requests', columns: [], groupBy: 'status' } },
  { key: 'stock-list', name: 'Stock list', config: { source: 'inventory_products', columns: ['sku', 'name', 'on_hand', 'min_stock', 'sell_price_minor'] } },
];
