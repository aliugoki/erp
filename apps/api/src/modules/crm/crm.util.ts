import type { Money } from '@metaxperts/shared';

export const DEAL_STAGES = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** True when a stage change reaches CLOSED_WON for the first time (fires the deal_closed event). */
export function isWonTransition(previous: string, next: string): boolean {
  return next === 'CLOSED_WON' && previous !== 'CLOSED_WON';
}

export interface PipelineRow {
  stage: string;
  count: number | string;
  total_minor: number | string;
  currency: string | null;
}

export interface PipelineStageView {
  stage: string;
  count: number;
  total: Money;
}

/**
 * Map grouped pipeline rows into a complete, ordered view: every stage appears (zero-filled), with a
 * Money total. Keeps a stable stage order for the UI board.
 */
export function buildPipeline(rows: PipelineRow[], currencyDefault = 'PKR'): PipelineStageView[] {
  const byStage = new Map(rows.map((r) => [r.stage, r]));
  const currency = rows.find((r) => r.currency)?.currency ?? currencyDefault;
  return DEAL_STAGES.map((stage) => {
    const r = byStage.get(stage);
    return {
      stage,
      count: r ? Number(r.count) : 0,
      total: { amountMinor: r ? Number(r.total_minor) : 0, currency },
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
}

export interface DealView {
  id: string;
  clientId: string;
  title: string;
  value: Money;
  stage: string;
  expectedCloseDate: string | null;
  assignedTo: string | null;
}

export function mapDealRow(r: DealRow): DealView {
  return {
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    value: { amountMinor: Number(r.value_minor), currency: r.currency },
    stage: r.stage,
    expectedCloseDate: r.expected_close_date,
    assignedTo: r.assigned_to,
  };
}
