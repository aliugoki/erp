import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/modules/audit/audit.service';

/** listForTenant builds a filtered, paginated, RLS-scoped query and maps rows to camelCase. */
describe('AuditService.listForTenant', () => {
  it('applies filters as bound params, paginates, and shapes the envelope', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (/count\(\*\)/.test(sql)) return [{ c: '42' }];
        return [
          {
            id: 'a1', user_id: 'u1', user_email: 'admin@acme.test', action: 'PATCH', resource: '/finance/invoices/:id',
            resource_id: 'inv-1', old_value: { status: 'DRAFT' }, new_value: { status: 'POSTED' },
            ip_address: '10.0.0.1', trace_id: 't-1', created_at: '2026-06-29T10:00:00Z',
          },
        ];
      }),
    };
    const tenantTx = { run: (fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)) } as never;
    const svc = new AuditService(tenantTx);

    const out = await svc.listForTenant({ from: '2026-06-01', to: '2026-06-30', action: 'PATCH', resource: 'invoices', userId: 'u1', page: 2, pageSize: 10 });

    // count + rows queries both carry the same WHERE filters.
    const rowsCall = calls.find((c) => /SELECT a\.id/.test(c.sql))!;
    expect(rowsCall.sql).toContain('a.created_at::date >= $1::date');
    expect(rowsCall.sql).toContain('a.created_at::date <= $2::date');
    expect(rowsCall.sql).toContain('a.action ILIKE $3');
    expect(rowsCall.sql).toContain('a.resource ILIKE $4');
    expect(rowsCall.sql).toContain('a.user_id = $5');
    expect(rowsCall.sql).toContain('LEFT JOIN users u'); // actor email
    expect(rowsCall.sql).toContain('LIMIT 10 OFFSET 10'); // page 2 × pageSize 10
    expect(rowsCall.params).toEqual(['2026-06-01', '2026-06-30', '%PATCH%', '%invoices%', 'u1']);

    expect(out.meta.pagination).toEqual({ page: 2, pageSize: 10, total: 42, totalPages: 5 });
    expect(out.data[0]).toMatchObject({ userEmail: 'admin@acme.test', action: 'PATCH', resourceId: 'inv-1' });
    expect(out.data[0]!.newValue).toEqual({ status: 'POSTED' });
  });

  it('clamps page/pageSize and runs with no filters', async () => {
    const manager = { query: vi.fn().mockResolvedValueOnce([{ c: '0' }]).mockResolvedValue([]) };
    const tenantTx = { run: (fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)) } as never;
    const out = await new AuditService(tenantTx).listForTenant({ page: 0, pageSize: 9999 });
    expect(out.meta.pagination.page).toBe(1);
    expect(out.meta.pagination.pageSize).toBe(100); // clamped to max
    expect(out.data).toEqual([]);
  });
});
