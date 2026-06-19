import type { Money } from '@metaxperts/shared';

/** Minimal structural manager type (mirrors inventory-docs) so helpers stay DB-driver-agnostic. */
type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Normalize a query result. This driver returns `[rows, affectedCount]` for `UPDATE…RETURNING` but a
 * plain array for `INSERT`/`SELECT`; unwrap the former so callers always get the row array. */
export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0] as T[];
  return (res ?? []) as T[];
}

/** Allocate the next per-tenant, per-type document number (e.g. ACC-0001, LEAD-0007) atomically from
 * `crm_doc_seq`. Mirrors inventory's `nextDocNo`. */
export async function nextCrmDocNo(m: Mgr, prefix: string, docType: string): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO crm_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, $1, 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = crm_doc_seq.last_no + 1
     RETURNING last_no`,
    [docType],
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(4, '0')}`;
}

// ── Accounts (clients) ──────────────────────────────────────────────────────────
export interface ClientRow {
  id: string;
  account_no: string | null;
  company_name: string;
  industry: string | null;
  website: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  owner_id: string | null;
  annual_revenue_minor: string | number | null;
}

export interface ClientView {
  id: string;
  accountNo: string | null;
  companyName: string;
  industry: string | null;
  website: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  ownerId: string | null;
  annualRevenueMinor: number;
}

export function mapClientRow(r: ClientRow): ClientView {
  return {
    id: r.id,
    accountNo: r.account_no,
    companyName: r.company_name,
    industry: r.industry,
    website: r.website,
    status: r.status,
    phone: r.phone,
    email: r.email,
    address: r.address,
    city: r.city,
    country: r.country,
    ownerId: r.owner_id,
    annualRevenueMinor: Number(r.annual_revenue_minor ?? 0),
  };
}

export interface ContactRow {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

export interface ContactView {
  id: string;
  clientId: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export function mapContactRow(r: ContactRow): ContactView {
  return { id: r.id, clientId: r.client_id, name: r.name, email: r.email, phone: r.phone, isPrimary: r.is_primary };
}

export const DEAL_STAGES = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Default win probability (%) per stage — the basis for the weighted forecast. A deal can override
 * its own `probability`, but on a stage change we re-default it from here. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  LEAD: 10,
  QUALIFIED: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'] as const;
export const LEAD_RATINGS = ['HOT', 'WARM', 'COLD'] as const;
export const ACTIVITY_TYPES = ['CALL', 'MEETING', 'EMAIL', 'TASK', 'NOTE'] as const;

/** True when a stage change reaches CLOSED_WON for the first time (fires the deal_closed event). */
export function isWonTransition(previous: string, next: string): boolean {
  return next === 'CLOSED_WON' && previous !== 'CLOSED_WON';
}

const isOpenStage = (stage: string) => stage !== 'CLOSED_WON' && stage !== 'CLOSED_LOST';

/** Probability-weighted value of one open deal, in minor units (value × probability ÷ 100, floored).
 * Closed stages contribute nothing to the forecast. */
export function weightedMinor(valueMinor: number, probability: number, stage: string): number {
  if (!isOpenStage(stage)) return 0;
  return Math.floor((valueMinor * probability) / 100);
}

export interface PipelineRow {
  stage: string;
  count: number | string;
  total_minor: number | string;
  weighted_minor: number | string;
  currency: string | null;
}

export interface PipelineStageView {
  stage: string;
  count: number;
  total: Money;
  /** Probability-weighted forecast value for this stage (zero for closed stages). */
  weighted: Money;
}

/**
 * Map grouped pipeline rows into a complete, ordered view: every stage appears (zero-filled), with a
 * Money total and a probability-weighted forecast total. Keeps a stable stage order for the UI board.
 */
export function buildPipeline(rows: PipelineRow[], currencyDefault = 'PKR'): PipelineStageView[] {
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  const currency = rows.find((r) => r.currency)?.currency ?? currencyDefault;
  return DEAL_STAGES.map((stage) => {
    const r = byStage.get(stage);
    // Closed stages never contribute to the forecast, regardless of what the aggregate carries.
    const weightedMinor = r && isOpenStage(stage) ? Number(r.weighted_minor) : 0;
    return {
      stage,
      count: r ? Number(r.count) : 0,
      total: { amountMinor: r ? Number(r.total_minor) : 0, currency },
      weighted: { amountMinor: weightedMinor, currency },
    };
  });
}

export interface DealRow {
  id: string;
  client_id: string;
  title: string;
  value_minor: string | number;
  currency: string;
  stage: string;
  expected_close_date: string | null;
  assigned_to: string | null;
  probability: number;
  owner_id: string | null;
  source: string | null;
}

export interface DealView {
  id: string;
  clientId: string;
  title: string;
  value: Money;
  stage: string;
  expectedCloseDate: string | null;
  assignedTo: string | null;
  probability: number;
  ownerId: string | null;
  source: string | null;
  /** Probability-weighted forecast value (zero once the deal is closed). */
  weighted: Money;
}

export function mapDealRow(r: DealRow): DealView {
  const valueMinor = Number(r.value_minor);
  return {
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    value: { amountMinor: valueMinor, currency: r.currency },
    stage: r.stage,
    expectedCloseDate: r.expected_close_date,
    assignedTo: r.assigned_to,
    probability: r.probability,
    ownerId: r.owner_id,
    source: r.source,
    weighted: { amountMinor: weightedMinor(valueMinor, r.probability, r.stage), currency: r.currency },
  };
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export interface LeadRow {
  id: string;
  lead_no: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  rating: string;
  est_value_minor: string | number;
  currency: string;
  owner_id: string | null;
  notes: string | null;
  converted_client_id: string | null;
  converted_deal_id: string | null;
  converted_at: string | null;
}

export interface LeadView {
  id: string;
  leadNo: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  rating: string;
  estValue: Money;
  ownerId: string | null;
  notes: string | null;
  convertedClientId: string | null;
  convertedDealId: string | null;
  convertedAt: string | null;
}

export function mapLeadRow(r: LeadRow): LeadView {
  return {
    id: r.id,
    leadNo: r.lead_no,
    name: r.name,
    company: r.company,
    email: r.email,
    phone: r.phone,
    source: r.source,
    status: r.status,
    rating: r.rating,
    estValue: { amountMinor: Number(r.est_value_minor), currency: r.currency },
    ownerId: r.owner_id,
    notes: r.notes,
    convertedClientId: r.converted_client_id,
    convertedDealId: r.converted_deal_id,
    convertedAt: r.converted_at,
  };
}

// ── Activities ──────────────────────────────────────────────────────────────────
export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  due_at: string | null;
  completed: boolean;
  completed_at: string | null;
  client_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  owner_id: string | null;
  outcome: string | null;
  created_at?: string;
}

export interface ActivityView {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  completed: boolean;
  completedAt: string | null;
  clientId: string | null;
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
  ownerId: string | null;
  outcome: string | null;
  createdAt: string | null;
}

export function mapActivityRow(r: ActivityRow): ActivityView {
  return {
    id: r.id,
    type: r.type,
    subject: r.subject,
    body: r.body,
    dueAt: r.due_at,
    completed: r.completed,
    completedAt: r.completed_at,
    clientId: r.client_id,
    contactId: r.contact_id,
    dealId: r.deal_id,
    leadId: r.lead_id,
    ownerId: r.owner_id,
    outcome: r.outcome,
    createdAt: r.created_at ?? null,
  };
}
