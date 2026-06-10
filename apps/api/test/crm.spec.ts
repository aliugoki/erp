import { describe, expect, it } from 'vitest';
import { buildPipeline, isWonTransition, mapDealRow } from '../src/modules/crm/crm.util';

describe('crm.util', () => {
  it('isWonTransition fires only on first reaching CLOSED_WON', () => {
    expect(isWonTransition('NEGOTIATION', 'CLOSED_WON')).toBe(true);
    expect(isWonTransition('CLOSED_WON', 'CLOSED_WON')).toBe(false);
    expect(isWonTransition('LEAD', 'QUALIFIED')).toBe(false);
  });

  it('buildPipeline returns every stage (zero-filled) with Money totals', () => {
    const view = buildPipeline([
      { stage: 'LEAD', count: 2, total_minor: '500000', currency: 'PKR' },
      { stage: 'CLOSED_WON', count: 1, total_minor: '1000000', currency: 'PKR' },
    ]);
    expect(view).toHaveLength(6); // all stages present
    const lead = view.find((v) => v.stage === 'LEAD')!;
    expect(lead).toEqual({ stage: 'LEAD', count: 2, total: { amountMinor: 500000, currency: 'PKR' } });
    const won = view.find((v) => v.stage === 'CLOSED_WON')!;
    expect(won.total).toEqual({ amountMinor: 1000000, currency: 'PKR' });
    const proposal = view.find((v) => v.stage === 'PROPOSAL')!;
    expect(proposal).toEqual({ stage: 'PROPOSAL', count: 0, total: { amountMinor: 0, currency: 'PKR' } });
  });

  it('mapDealRow exposes value as Money (integer minor units)', () => {
    const v = mapDealRow({
      id: 'd1', client_id: 'c1', title: 'Big deal', value_minor: '2500000', currency: 'PKR',
      stage: 'PROPOSAL', expected_close_date: null, assigned_to: null,
    });
    expect(v.value).toEqual({ amountMinor: 2500000, currency: 'PKR' });
    expect(v.stage).toBe('PROPOSAL');
  });
});
