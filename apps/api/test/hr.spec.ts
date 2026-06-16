/**
 * HR unit tests (Chunk 3.1). Pure helpers + the service's list/mapping logic with a mocked tenant
 * transaction — no DB. The DB integration (CRUD, filters, tenant isolation) is covered by hr-e2e.sh.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  attendancePayableDays,
  buildEmployeeWhere,
  computePayslip,
  inclusiveDays,
  mapEmployeeRow,
  normalizePagination,
  proratedBasicMinor,
  type PayComponent,
} from '../src/modules/hr/hr.util';
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

  it('inclusiveDays counts both endpoints (a one-day leave = 1)', () => {
    expect(inclusiveDays('2026-06-01', '2026-06-01')).toBe(1);
    expect(inclusiveDays('2026-06-01', '2026-06-05')).toBe(5);
    expect(inclusiveDays('2026-06-30', '2026-07-02')).toBe(3); // across month boundary
  });

  it('computePayslip: earnings add to gross, deductions cut net, percent is off basic', () => {
    const components: PayComponent[] = [
      { code: 'HRA', name: 'House Rent', type: 'EARNING', calc: 'PCT_OF_BASIC', valueMinor: 0, percent: 50 },
      { code: 'MED', name: 'Medical', type: 'EARNING', calc: 'FIXED', valueMinor: 500_000, percent: 0 },
      { code: 'TAX', name: 'Income Tax', type: 'DEDUCTION', calc: 'PCT_OF_BASIC', valueMinor: 0, percent: 10 },
    ];
    const slip = computePayslip(10_000_000, components); // basic = 100,000.00
    expect(slip.basicMinor).toBe(10_000_000);
    expect(slip.grossMinor).toBe(10_000_000 + 5_000_000 + 500_000); // +50% HRA +5,000 medical
    expect(slip.deductionMinor).toBe(1_000_000); // 10% tax off basic
    expect(slip.netMinor).toBe(slip.grossMinor - slip.deductionMinor);
    expect(slip.lines.map((l) => l.code)).toEqual(['BASIC', 'HRA', 'MED', 'TAX']);
  });

  it('computePayslip skips zero-value components and keeps just basic', () => {
    const slip = computePayslip(5_000_000, [
      { code: 'X', name: 'Zero', type: 'EARNING', calc: 'FIXED', valueMinor: 0, percent: 0 },
    ]);
    expect(slip.lines).toHaveLength(1);
    expect(slip.netMinor).toBe(5_000_000);
  });

  it('attendancePayableDays weights present/leave=1, half=0.5, absent=0', () => {
    const records = [
      { status: 'PRESENT' }, { status: 'PRESENT' }, { status: 'HALF_DAY' },
      { status: 'LEAVE' }, { status: 'ABSENT' },
    ];
    expect(attendancePayableDays(records)).toBe(3.5); // 2 + 0.5 + 1 + 0
    expect(attendancePayableDays([])).toBe(0);
  });

  it('proratedBasicMinor scales basic by attendance, full pay when untracked', () => {
    // 26 working days, present 13 → half pay
    expect(proratedBasicMinor(10_000_000, 13, 26, true)).toBe(5_000_000);
    // payable capped at working days (no overpay)
    expect(proratedBasicMinor(10_000_000, 30, 26, true)).toBe(10_000_000);
    // no attendance recorded → full basic
    expect(proratedBasicMinor(10_000_000, 0, 26, false)).toBe(10_000_000);
    // zero working days guarded → full basic
    expect(proratedBasicMinor(10_000_000, 5, 0, true)).toBe(10_000_000);
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
