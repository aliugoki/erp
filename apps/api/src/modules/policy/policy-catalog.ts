/**
 * The policy catalog (policy engine, Phase A) — the single source of truth for per-tenant business
 * rules. Each entry declares its type, default, module group and help text; the admin UI is rendered
 * from this, values are validated against it, and from Phase B modules read effective values via
 * `PolicyService`. Defaults are chosen to match today's behaviour (so Phase A changes nothing until a
 * tenant opts in).
 */
export type PolicyType = 'boolean' | 'number' | 'money' | 'enum';

export interface PolicyDef {
  key: string; // `domain.policy`
  module: string; // grouping key (matches feature/module keys where possible)
  group: string; // human label for the group
  label: string;
  help: string;
  type: PolicyType;
  default: boolean | number | string;
  options?: string[]; // for enum
  min?: number; // for number/money
  max?: number;
  /** True once a module actually enforces this policy at a decision point (Phase B). The UI flags the
   * rest as "not enforced yet" so an admin is never misled by a toggle that does nothing. */
  enforced?: boolean;
}

export const POLICY_CATALOG: PolicyDef[] = [
  // ── Finance ───────────────────────────────────────────────────────────────
  {
    key: 'finance.voucher_approval_threshold_minor',
    module: 'finance',
    group: 'Finance',
    label: 'Voucher approval threshold',
    help: 'Vouchers at or above this amount require a second approver. 0 = no threshold.',
    type: 'money',
    default: 0, enforced: true,
    min: 0,
  },
  {
    key: 'finance.require_cost_center',
    module: 'finance',
    group: 'Finance',
    label: 'Require cost centre on vouchers',
    help: 'Every voucher line must specify a cost centre.',
    type: 'boolean',
    default: false, enforced: true,
  },
  {
    key: 'finance.require_po_for_bill',
    module: 'finance',
    group: 'Finance',
    label: 'Require a purchase order for vendor bills',
    help: 'AP bills must reference an approved purchase order.',
    type: 'boolean',
    default: false,
    enforced: true,
  },
  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    key: 'inventory.allow_negative_stock',
    module: 'inventory',
    group: 'Inventory',
    label: 'Allow negative stock',
    help: 'Permit issues/movements that drive on-hand below zero.',
    type: 'boolean',
    default: false,
    enforced: true,
  },
  // ── Sales / CRM ───────────────────────────────────────────────────────────
  {
    key: 'crm.discount_cap_percent',
    module: 'crm',
    group: 'Sales & CRM',
    label: 'Maximum discount %',
    help: 'Largest discount a deal/quote line may apply. 100 = uncapped.',
    type: 'number',
    default: 100,
    min: 0,
    max: 100,
    enforced: true,
  },
  {
    key: 'sales.customer_credit_limit_minor',
    module: 'sales',
    group: 'Sales & CRM',
    label: 'Default customer credit limit',
    help: 'Block new credit orders beyond this outstanding balance. 0 = unlimited.',
    type: 'money',
    default: 0,
    min: 0,
  },
  // ── POS ───────────────────────────────────────────────────────────────────
  {
    key: 'pos.max_discount_percent',
    module: 'pos',
    group: 'Point of Sale',
    label: 'Max POS line discount %',
    help: 'Cashiers cannot exceed this discount without a manager override. 100 = uncapped.',
    type: 'number',
    default: 100, enforced: true,
    min: 0,
    max: 100,
  },
  // ── HR ────────────────────────────────────────────────────────────────────
  {
    key: 'hr.max_leave_days_per_request',
    module: 'hr',
    group: 'Human Resources',
    label: 'Max leave days per request',
    help: 'Largest single leave request allowed. 0 = unlimited.',
    type: 'number',
    default: 0, enforced: true,
    min: 0,
  },
  // ── Pharmacy ──────────────────────────────────────────────────────────────
  {
    key: 'pharmacy.block_expired_dispense',
    module: 'pharmacy',
    group: 'Pharmacy',
    label: 'Block dispensing expired stock',
    help: 'Refuse to dispense batches past their expiry date.',
    type: 'boolean',
    default: true,
  },
];

export const POLICY_BY_KEY: Record<string, PolicyDef> = Object.fromEntries(
  POLICY_CATALOG.map((p) => [p.key, p]),
);

/** Validate + coerce a value against a policy definition; throws a message on invalid input. */
export function coercePolicyValue(def: PolicyDef, raw: unknown): boolean | number | string {
  if (def.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`${def.key} expects a boolean`);
    return raw;
  }
  if (def.type === 'number' || def.type === 'money') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${def.key} expects a number`);
    if (def.type === 'money' && !Number.isInteger(n)) throw new Error(`${def.key} expects integer minor units`);
    if (def.min != null && n < def.min) throw new Error(`${def.key} must be >= ${def.min}`);
    if (def.max != null && n > def.max) throw new Error(`${def.key} must be <= ${def.max}`);
    return n;
  }
  // enum
  if (typeof raw !== 'string' || !(def.options ?? []).includes(raw)) {
    throw new Error(`${def.key} must be one of: ${(def.options ?? []).join(', ')}`);
  }
  return raw;
}
