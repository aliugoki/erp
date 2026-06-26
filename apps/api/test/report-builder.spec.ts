import { describe, expect, it } from 'vitest';
import { buildDistinctValuesQuery, buildReportQuery, datasetCatalog } from '../src/modules/reporting/report-builder';

describe('report-builder', () => {
  it('list mode selects only whitelisted columns, parameterizes filters', () => {
    const q = buildReportQuery({
      source: 'crm_deals',
      columns: ['title', 'stage', 'value_minor'],
      filters: [{ column: 'stage', value: 'PROPOSAL' }],
    });
    expect(q.sql).toContain('FROM crm_deal');
    expect(q.sql).toContain('deleted_at IS NULL');
    expect(q.sql).toContain('stage = $1');
    expect(q.params).toEqual(['PROPOSAL']);
    expect(q.columns.map((c) => c.key)).toEqual(['title', 'stage', 'value_minor']);
    expect(q.columns.find((c) => c.key === 'value_minor')!.money).toBe(true);
  });

  it('group mode emits group column + count', () => {
    const q = buildReportQuery({ source: 'hr_employees', columns: [], groupBy: 'status' });
    expect(q.sql).toContain('GROUP BY');
    expect(q.sql).toContain('count(*)');
    expect(q.columns.map((c) => c.key)).toEqual(['status', 'count']);
  });

  it('rejects unknown dataset, non-whitelisted filter and non-groupable column', () => {
    expect(() => buildReportQuery({ source: 'evil_table', columns: ['x'] })).toThrow();
    expect(() => buildReportQuery({ source: 'crm_deals', columns: ['title'], filters: [{ column: 'value_minor', value: '1' }] })).toThrow();
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'title' })).toThrow();
  });

  it('drops unknown columns and errors if nothing valid remains', () => {
    const q = buildReportQuery({ source: 'crm_deals', columns: ['title', 'DROP TABLE'] });
    expect(q.columns.map((c) => c.key)).toEqual(['title']); // injection attempt ignored
    expect(() => buildReportQuery({ source: 'crm_deals', columns: ['nope'] })).toThrow();
  });

  it('applies an inclusive created_at date range as bound params (group + list mode)', () => {
    const g = buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', dateFrom: '2026-01-01', dateTo: '2026-03-31' });
    expect(g.sql).toContain('created_at::date >= $1::date');
    expect(g.sql).toContain('created_at::date <= $2::date');
    expect(g.params).toEqual(['2026-01-01', '2026-03-31']);

    const l = buildReportQuery({ source: 'crm_deals', columns: ['title'], filters: [{ column: 'stage', value: 'WON' }], dateFrom: '2026-02-01' });
    expect(l.params).toEqual(['WON', '2026-02-01']); // filter bound first, then dateFrom
    expect(l.sql).toContain('created_at::date >= $2::date');
  });

  it('rejects a malformed date range (injection-safe)', () => {
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', dateFrom: "2026-01-01'; DROP TABLE" })).toThrow();
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', dateTo: 'not-a-date' })).toThrow();
  });

  it('group mode supports an aggregate measure (sum of a money column) and flags it as money', () => {
    const q = buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', agg: 'sum', measure: 'value_minor' });
    expect(q.sql).toContain('SUM(value_minor)');
    expect(q.sql).toContain('AS "value"');
    expect(q.columns.map((c) => c.key)).toEqual(['stage', 'value']);
    expect(q.columns.find((c) => c.key === 'value')!.money).toBe(true);
  });

  it('rejects a non-aggregatable measure and an unknown aggregate', () => {
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', agg: 'sum', measure: 'title' })).toThrow();
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', agg: 'sum' })).toThrow(); // no measure
    // @ts-expect-error invalid agg at runtime
    expect(() => buildReportQuery({ source: 'crm_deals', columns: [], groupBy: 'stage', agg: 'median', measure: 'value_minor' })).toThrow();
  });

  it('buildDistinctValuesQuery only allows filterable columns', () => {
    const q = buildDistinctValuesQuery('hr_employees', 'city');
    expect(q.sql).toContain('SELECT DISTINCT');
    expect(q.sql).toContain('FROM hr_employee');
    expect(() => buildDistinctValuesQuery('hr_employees', 'salary_amount_minor')).toThrow();
    expect(() => buildDistinctValuesQuery('evil', 'x')).toThrow();
  });

  it('datasetCatalog exposes labels without leaking SQL', () => {
    const cat = datasetCatalog();
    expect(cat.find((d) => d.key === 'crm_deals')).toBeTruthy();
    expect(JSON.stringify(cat)).not.toContain('SELECT');
  });
});
