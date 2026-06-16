import { describe, expect, it } from 'vitest';
import {
  STAGE_PROBABILITY,
  buildPipeline,
  isWonTransition,
  mapDealRow,
  mapLeadRow,
  weightedMinor,
} from '../src/modules/crm/crm.util';

describe('crm.util', () => {
  it('isWonTransition fires only on first reaching CLOSED_WON', () => {
    expect(isWonTransition('NEGOTIATION', 'CLOSED_WON')).toBe(true);
    expect(isWonTransition('CLOSED_WON', 'CLOSED_WON')).toBe(false);
    expect(isWonTransition('LEAD', 'QUALIFIED')).toBe(false);
  });

  it('weightedMinor applies stage probability and zeroes closed stages', () => {
    expect(weightedMinor(1_000_000, 50, 'PROPOSAL')).toBe(500_000);
    expect(weightedMinor(1_000_000, 25, 'QUALIFIED')).toBe(250_000);
    expect(weightedMinor(1_000_000, 100, 'CLOSED_WON')).toBe(0); // closed → not forecast
    expect(weightedMinor(1_000_000, 0, 'CLOSED_LOST')).toBe(0);
  });

  it('buildPipeline returns every stage (zero-filled) with raw + weighted Money totals', () => {
    const view = buildPipeline([
      { stage: 'LEAD', count: 2, total_minor: '500000', weighted_minor: '50000', currency: 'PKR' },
      { stage: 'CLOSED_WON', count: 1, total_minor: '1000000', weighted_minor: '0', currency: 'PKR' },
    ]);
    expect(view).toHaveLength(6); // all stages present
    const lead = view.find((v) => v.stage === 'LEAD')!;
    expect(lead).toEqual({
      stage: 'LEAD',
      count: 2,
      total: { amountMinor: 500000, currency: 'PKR' },
      weighted: { amountMinor: 50000, currency: 'PKR' },
    });
    const proposal = view.find((v) => v.stage === 'PROPOSAL')!;
    expect(proposal.weighted).toEqual({ amountMinor: 0, currency: 'PKR' });
  });

  it('buildPipeline zeroes the weighted forecast for closed stages even if the aggregate is non-zero', () => {
    const view = buildPipeline([
      { stage: 'CLOSED_WON', count: 1, total_minor: '1000000', weighted_minor: '1000000', currency: 'PKR' },
    ]);
    const won = view.find((v) => v.stage === 'CLOSED_WON')!;
    expect(won.total).toEqual({ amountMinor: 1000000, currency: 'PKR' });
    expect(won.weighted).toEqual({ amountMinor: 0, currency: 'PKR' }); // forecast excludes closed
  });

  it('mapDealRow exposes value + weighted forecast as Money (integer minor units)', () => {
    const v = mapDealRow({
      id: 'd1', client_id: 'c1', title: 'Big deal', value_minor: '2500000', currency: 'PKR',
      stage: 'PROPOSAL', expected_close_date: null, assigned_to: null,
      probability: 50, owner_id: 'u1', source: 'web',
    });
    expect(v.value).toEqual({ amountMinor: 2500000, currency: 'PKR' });
    expect(v.weighted).toEqual({ amountMinor: 1250000, currency: 'PKR' }); // 2.5M × 50%
    expect(v.probability).toBe(50);
    expect(v.ownerId).toBe('u1');
  });

  it('STAGE_PROBABILITY ramps monotonically up the funnel', () => {
    expect(STAGE_PROBABILITY.LEAD).toBeLessThan(STAGE_PROBABILITY.QUALIFIED);
    expect(STAGE_PROBABILITY.QUALIFIED).toBeLessThan(STAGE_PROBABILITY.PROPOSAL);
    expect(STAGE_PROBABILITY.PROPOSAL).toBeLessThan(STAGE_PROBABILITY.NEGOTIATION);
    expect(STAGE_PROBABILITY.CLOSED_WON).toBe(100);
    expect(STAGE_PROBABILITY.CLOSED_LOST).toBe(0);
  });

  it('mapLeadRow exposes the estimated value as Money', () => {
    const v = mapLeadRow({
      id: 'l1', lead_no: 'LEAD-0001', name: 'Jane', company: 'Acme', email: null, phone: null,
      source: 'referral', status: 'NEW', rating: 'HOT', est_value_minor: '750000', currency: 'PKR',
      owner_id: null, notes: null, converted_client_id: null, converted_deal_id: null, converted_at: null,
    });
    expect(v.estValue).toEqual({ amountMinor: 750000, currency: 'PKR' });
    expect(v.leadNo).toBe('LEAD-0001');
    expect(v.rating).toBe('HOT');
  });
});
