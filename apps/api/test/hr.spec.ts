/**
 * HR unit tests (Chunk 3.1). Pure helpers + the service's list/mapping logic with a mocked tenant
 * transaction — no DB. The DB integration (CRUD, filters, tenant isolation) is covered by hr-e2e.sh.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildEmployeeWhere, mapEmployeeRow, normalizePagination } from '../src/modules/hr/hr.util';
import { HrService } from '../src/modules/hr/hr.service';
import type { EmployeeRow } from '../src/modules/hr/hr.types';

describe('hr.util', () => {
  it('normalizePagination clamps and computes offset', () => {
    expect(normalizePagination(undefined, undefined)).toEqual({ page: 1, pageSize: 20, limit: 20, offset: 0 });
    expect(normalizePagination(3, 10)).toEqual({ page: 3, pageSize: 10, limit: 10, offset: 20 });
    expect(normalizePagination(0, -5)).toEqual({ page: 1, pageSize: 20, limit: 20, offset: 0 });
    expect(normalizePagination(1, 1000).pageSize).toBe(100); // capped
  });

  it('buildEmployeeWhere always guards soft-delete and parameterizes filters', () => {
    expect(buildEmployeeWhere({})).toEqual({ clause: 'WHERE deleted_at IS NULL', params: [] });
    const r = buildEmployeeWhere({ department: 'd1', status: 'ACTIVE', search: 'ali' }, 1);
    expect(r.clause).toContain('department_id = $1');
    expect(r.clause).toContain('status = $2');
    expect(r.clause).toContain('ILIKE $3');
    expect(r.params).toEqual(['d1', 'ACTIVE', '%ali%']);
  });

  it('mapEmployeeRow reconstitutes Money (integer minor units) and handles null salary', () => {
    const base: EmployeeRow = {
      id: 'e1', employee_code: 'EMP-1', first_name: 'Ayesha', last_name: 'Khan', email: null, phone: null,
      department_id: null, position_id: null, join_date: null, salary_amount_minor: '15000000',
      salary_currency: 'PKR', status: 'ACTIVE',
    };
    expect(mapEmployeeRow(base).salary).toEqual({ amountMinor: 15000000, currency: 'PKR' });
    expect(mapEmployeeRow({ ...base, salary_amount_minor: null }).salary).toBeNull();
  });
});

describe('HrService.listEmployees', () => {
  it('returns a { data, meta } envelope with correct pagination', async () => {
    const rows: EmployeeRow[] = [
      { id: 'e1', employee_code: 'EMP-1', first_name: 'Bilal', last_name: 'Ahmed', email: null, phone: null,
        department_id: null, position_id: null, join_date: null, salary_amount_minor: '20000000',
        salary_currency: 'PKR', status: 'ACTIVE' },
    ];
    const manager = { query: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([{ total: 42 }]) };
    const tenantTx = { run: vi.fn((cb: (m: unknown) => unknown) => cb(manager)) } as never;
    const svc = new HrService(tenantTx);

    const res = await svc.listEmployees({ page: 2, pageSize: 20 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.salary).toEqual({ amountMinor: 20000000, currency: 'PKR' });
    expect(res.meta!.pagination).toEqual({ page: 2, pageSize: 20, total: 42, totalPages: 3 });
    // first query is the page, second is the count
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
