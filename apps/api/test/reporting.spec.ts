/**
 * Reporting test (Chunk 5.2 gate). Drives ReportingService against the real DB AS THE app_user (RLS
 * subject — required, since the refresh scopes per-tenant via RLS, not explicit WHEREs). Proves:
 *  - reports are served from the read models: empty BEFORE refresh, populated AFTER,
 *  - each report returns the { raw, series } shape with correct aggregates,
 *  - reports are tenant-scoped (tenant A's refresh never leaks into tenant B).
 * Uses random tenant ids so it needs no cleanup and can't collide with other parallel specs.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantTransactionService } from '../src/common/tenant/tenant-transaction.service';
import { RequestContext } from '../src/common/request-context/request-context';
import { ReportingService } from '../src/modules/reporting/reporting.service';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(__dirname, '../../../.env')]) {
  if (existsSync(c)) { loadDotenv({ path: c }); break; }
}

const TA = randomUUID();
const TB = randomUUID();
let ds: DataSource;
let tenantTx: TenantTransactionService;
let reporting: ReportingService;

const inTenant = <T>(tenantId: string, fn: () => Promise<T>) =>
  RequestContext.run({ requestId: 'r', tenantId }, fn);

/** Seed a tenant with finance entries, products, employees and deals (inside its RLS context). */
async function seed(tenantId: string, scale: number): Promise<void> {
  await tenantTx.runFor(tenantId, async (m: EntityManager) => {
    const guc = `current_setting('app.tenant_id')::uuid`;
    const rev = (await m.query(`INSERT INTO finance_account (tenant_id, code, name, type) VALUES (${guc},'4000','Sales','REVENUE') RETURNING id`))[0].id;
    const exp = (await m.query(`INSERT INTO finance_account (tenant_id, code, name, type) VALUES (${guc},'5000','Costs','EXPENSE') RETURNING id`))[0].id;
    const txn = (await m.query(`INSERT INTO finance_transaction (tenant_id, description, occurred_on) VALUES (${guc},'seed','2026-03-15') RETURNING id`))[0].id;
    await m.query(`INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor, currency) VALUES (${guc},$1,$2,0,$3,'PKR')`, [txn, rev, 100000 * scale]);
    await m.query(`INSERT INTO finance_journal_entry (tenant_id, transaction_id, account_id, debit_minor, credit_minor, currency) VALUES (${guc},$1,$2,$3,0,'PKR')`, [txn, exp, 40000 * scale]);

    await m.query(`INSERT INTO inventory_product (tenant_id, sku, name, category, cost_price_minor, sell_price_minor, currency, min_stock, on_hand) VALUES (${guc},'SKU-1','Widget','Hardware',5000,9000,'PKR',5,10),(${guc},'SKU-2','Gadget','Hardware',8000,15000,'PKR',5,$1)`, [scale]);

    const dept = (await m.query(`INSERT INTO hr_department (tenant_id, name) VALUES (${guc},'Engineering') RETURNING id`))[0].id;
    await m.query(`INSERT INTO hr_employee (tenant_id, employee_code, first_name, last_name, department_id, status) VALUES (${guc},'E1','A','A',$1,'ACTIVE'),(${guc},'E2','B','B',$1,'ACTIVE')`, [dept]);

    const client = (await m.query(`INSERT INTO crm_client (tenant_id, company_name) VALUES (${guc},'Acme') RETURNING id`))[0].id;
    await m.query(`INSERT INTO crm_deal (tenant_id, client_id, title, value_minor, currency, stage) VALUES (${guc},$1,'D1',500000,'PKR','PROPOSAL'),(${guc},$1,'D2',$2,'PKR','CLOSED_WON')`, [client, 200000 * scale]);
  });
}

beforeAll(async () => {
  // app_user (RLS subject) via PgBouncer — NOT the owner. This is what makes the per-tenant scoping real.
  ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, synchronize: false, logging: false });
  await ds.initialize();
  tenantTx = new TenantTransactionService(ds);
  reporting = new ReportingService(tenantTx, ds);
  await seed(TA, 1);
  await seed(TB, 3);
});

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

describe('reporting: served from read models', () => {
  it('finance P&L is empty before refresh, populated after', async () => {
    const before = await inTenant(TA, () => reporting.financeProfitLoss());
    expect(before.raw).toHaveLength(0);
    expect(before.series).toHaveLength(0);

    await reporting.refreshForTenant(TA);

    const after = await inTenant(TA, () => reporting.financeProfitLoss());
    expect(after.raw).toHaveLength(1);
    expect(after.totals.revenue.amountMinor).toBe(100000);
    expect(after.totals.expense.amountMinor).toBe(40000);
    expect(after.totals.profit.amountMinor).toBe(60000);
    expect(after.series[0]).toMatchObject({ revenue: 100000, expense: 40000, profit: 60000 });
  });

  it('all four reports return the { raw, series } shape', async () => {
    const pl = await inTenant(TA, () => reporting.financeProfitLoss());
    const inv = await inTenant(TA, () => reporting.inventoryValuation());
    const hr = await inTenant(TA, () => reporting.hrHeadcount());
    const crm = await inTenant(TA, () => reporting.crmSalesPipeline());
    for (const r of [pl, inv, hr, crm]) {
      expect(Array.isArray(r.raw)).toBe(true);
      expect(Array.isArray(r.series)).toBe(true);
    }
    // inventory (TA, scale 1): 10*5000 + 1*8000 = 58000
    expect(inv.totals.value.amountMinor).toBe(58000);
    expect(hr.totals.headcount).toBe(2);
    // crm pipeline always lists all 6 stages; one CLOSED_WON deal worth 200000
    expect(crm.raw).toHaveLength(6);
    const won = crm.raw.find((s) => s.stage === 'CLOSED_WON');
    expect(won?.total.amountMinor).toBe(200000);
  });

  it('profit-loss honors the [from,to] range', async () => {
    const inRange = await inTenant(TA, () => reporting.financeProfitLoss('2026-03-01', '2026-03-31'));
    expect(inRange.raw).toHaveLength(1);
    const outOfRange = await inTenant(TA, () => reporting.financeProfitLoss('2026-01-01', '2026-02-28'));
    expect(outOfRange.raw).toHaveLength(0);
  });
});

describe('reporting: tenant isolation', () => {
  it('tenant B (scale 3) sees only its own larger aggregates', async () => {
    await reporting.refreshForTenant(TB);
    const a = await inTenant(TA, () => reporting.financeProfitLoss());
    const b = await inTenant(TB, () => reporting.financeProfitLoss());
    expect(a.totals.revenue.amountMinor).toBe(100000); // unchanged by B's refresh
    expect(b.totals.revenue.amountMinor).toBe(300000); // 100000 * 3
    const bInv = await inTenant(TB, () => reporting.inventoryValuation());
    expect(bInv.totals.value.amountMinor).toBe(10 * 5000 + 3 * 8000); // 74000
  });
});
