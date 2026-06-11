import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { TenantContext } from '../../common/tenant/tenant-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

const money = (amountMinor: number, currency: string) => ({ amountMinor, currency });

/**
 * Reporting read models (Chunk 5.2). Each report is served from a tenant-scoped snapshot table that
 * the refresh job recomputes from the operational tables — so a request is a cheap indexed read, not a
 * heavy join/aggregate. Reports return `{ raw, series }`: `raw` is the row-level data, `series` is the
 * chart-ready shape. Refresh runs inside the tenant's RLS context, so every read/write is scoped.
 */
@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Refresh ──────────────────────────────────────────────────────────────

  /** Recompute every read model for one tenant (replace-in-place inside its RLS context). */
  async refreshForTenant(tenantId: string): Promise<void> {
    await this.tenantTx.runFor(tenantId, (m) => this.recompute(m));
  }

  /** Refresh the current request's tenant (the on-demand `POST /reports/refresh`). */
  async refreshCurrent(): Promise<{ tenantId: string; refreshed: true }> {
    const tenantId = TenantContext.require();
    await this.tenantTx.run((m) => this.recompute(m));
    return { tenantId, refreshed: true };
  }

  /** Refresh all tenants (the scheduled job). `tenants` is a non-RLS platform registry. */
  async refreshAllTenants(): Promise<number> {
    const rows = (await this.dataSource.query(`SELECT id FROM tenants WHERE deleted_at IS NULL`)) as Array<{ id: string }>;
    for (const { id } of rows) {
      try {
        await this.refreshForTenant(id);
      } catch (err) {
        this.logger.warn(`report refresh failed for tenant ${id}: ${(err as Error).message}`);
      }
    }
    return rows.length;
  }

  /** All four recomputes in one tenant transaction. DELETE is RLS-scoped, so it only clears this tenant. */
  private async recompute(m: EntityManager): Promise<void> {
    // Finance — monthly revenue/expense from journal entries by account type.
    await m.query(`DELETE FROM rpt_finance_monthly`);
    await m.query(
      `INSERT INTO rpt_finance_monthly (tenant_id, period, revenue_minor, expense_minor, currency)
       SELECT current_setting('app.tenant_id')::uuid,
              date_trunc('month', t.occurred_on)::date AS period,
              COALESCE(SUM(CASE WHEN a.type='REVENUE' THEN je.credit_minor - je.debit_minor ELSE 0 END), 0),
              COALESCE(SUM(CASE WHEN a.type='EXPENSE' THEN je.debit_minor - je.credit_minor ELSE 0 END), 0),
              COALESCE(MIN(je.currency), 'PKR')
       FROM finance_journal_entry je
       JOIN finance_transaction t ON t.id = je.transaction_id AND t.deleted_at IS NULL
       JOIN finance_account a ON a.id = je.account_id
       WHERE je.deleted_at IS NULL AND a.type IN ('REVENUE','EXPENSE')
       GROUP BY date_trunc('month', t.occurred_on)`,
    );

    // Inventory — valuation per product (on_hand × cost).
    await m.query(`DELETE FROM rpt_inventory_valuation`);
    await m.query(
      `INSERT INTO rpt_inventory_valuation (tenant_id, product_id, sku, name, category, on_hand, cost_minor, value_minor, currency)
       SELECT current_setting('app.tenant_id')::uuid, p.id, p.sku, p.name,
              COALESCE(NULLIF(p.category, ''), 'Uncategorized'),
              p.on_hand, p.cost_price_minor, p.on_hand * p.cost_price_minor, p.currency
       FROM inventory_product p WHERE p.deleted_at IS NULL`,
    );

    // HR — headcount by department + status.
    await m.query(`DELETE FROM rpt_hr_headcount`);
    await m.query(
      `INSERT INTO rpt_hr_headcount (tenant_id, department_id, dept_name, status, headcount)
       SELECT current_setting('app.tenant_id')::uuid, e.department_id,
              COALESCE(d.name, 'Unassigned'), e.status, COUNT(*)
       FROM hr_employee e
       LEFT JOIN hr_department d ON d.id = e.department_id
       WHERE e.deleted_at IS NULL
       GROUP BY e.department_id, d.name, e.status`,
    );

    // CRM — pipeline totals by stage.
    await m.query(`DELETE FROM rpt_crm_pipeline`);
    await m.query(
      `INSERT INTO rpt_crm_pipeline (tenant_id, stage, deal_count, total_minor, currency)
       SELECT current_setting('app.tenant_id')::uuid, stage, COUNT(*),
              COALESCE(SUM(value_minor), 0), COALESCE(MIN(currency), 'PKR')
       FROM crm_deal WHERE deleted_at IS NULL GROUP BY stage`,
    );
  }

  // ── Reports (served from read models) ─────────────────────────────────────

  /** Finance P&L over an optional [from,to] month range. */
  async financeProfitLoss(from?: string, to?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT period, revenue_minor, expense_minor, currency FROM rpt_finance_monthly
         WHERE ($1::date IS NULL OR period >= $1::date) AND ($2::date IS NULL OR period <= $2::date)
         ORDER BY period`,
        [from ?? null, to ?? null],
      )) as Array<{ period: string; revenue_minor: string; expense_minor: string; currency: string }>;

      const currency = rows[0]?.currency ?? 'PKR';
      let revenue = 0;
      let expense = 0;
      const series = rows.map((r) => {
        const rev = Number(r.revenue_minor);
        const exp = Number(r.expense_minor);
        revenue += rev;
        expense += exp;
        return { period: r.period, revenue: rev, expense: exp, profit: rev - exp };
      });
      return {
        raw: rows.map((r) => ({
          period: r.period,
          revenue: money(Number(r.revenue_minor), r.currency),
          expense: money(Number(r.expense_minor), r.currency),
          profit: money(Number(r.revenue_minor) - Number(r.expense_minor), r.currency),
        })),
        series,
        totals: {
          revenue: money(revenue, currency),
          expense: money(expense, currency),
          profit: money(revenue - expense, currency),
        },
      };
    });
  }

  /** Inventory valuation, rows + value-by-category series. */
  async inventoryValuation() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT product_id, sku, name, category, on_hand, cost_minor, value_minor, currency
         FROM rpt_inventory_valuation ORDER BY value_minor DESC`,
      )) as Array<Record<string, string | number>>;
      const currency = (rows[0]?.currency as string) ?? 'PKR';

      const byCategory = new Map<string, number>();
      let totalValue = 0;
      for (const r of rows) {
        const v = Number(r.value_minor);
        totalValue += v;
        byCategory.set(r.category as string, (byCategory.get(r.category as string) ?? 0) + v);
      }
      return {
        raw: rows.map((r) => ({
          productId: r.product_id,
          sku: r.sku,
          name: r.name,
          category: r.category,
          onHand: Number(r.on_hand),
          unitCost: money(Number(r.cost_minor), r.currency as string),
          value: money(Number(r.value_minor), r.currency as string),
        })),
        series: [...byCategory.entries()].map(([category, value]) => ({ category, value })),
        totals: { value: money(totalValue, currency), products: rows.length },
      };
    });
  }

  /** HR headcount, rows + headcount-by-department series. */
  async hrHeadcount() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT department_id, dept_name, status, headcount FROM rpt_hr_headcount ORDER BY dept_name, status`,
      )) as Array<{ department_id: string | null; dept_name: string; status: string; headcount: number }>;

      const byDept = new Map<string, number>();
      let total = 0;
      for (const r of rows) {
        const n = Number(r.headcount);
        total += n;
        byDept.set(r.dept_name, (byDept.get(r.dept_name) ?? 0) + n);
      }
      return {
        raw: rows.map((r) => ({
          departmentId: r.department_id,
          department: r.dept_name,
          status: r.status,
          headcount: Number(r.headcount),
        })),
        series: [...byDept.entries()].map(([department, headcount]) => ({ department, headcount })),
        totals: { headcount: total },
      };
    });
  }

  /** CRM sales pipeline, rows + value-by-stage series (stage order preserved). */
  async crmSalesPipeline() {
    return this.tenantTx.run(async (m) => {
      const order = ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
      const rows = (await m.query(
        `SELECT stage, deal_count, total_minor, currency FROM rpt_crm_pipeline`,
      )) as Array<{ stage: string; deal_count: number; total_minor: string; currency: string }>;
      const byStage = new Map(rows.map((r) => [r.stage, r]));
      const currency = rows[0]?.currency ?? 'PKR';

      const raw = order.map((stage) => {
        const r = byStage.get(stage);
        return {
          stage,
          count: r ? Number(r.deal_count) : 0,
          total: money(r ? Number(r.total_minor) : 0, r?.currency ?? currency),
        };
      });
      return {
        raw,
        series: raw.map((r) => ({ stage: r.stage, count: r.count, value: r.total.amountMinor })),
        totals: {
          deals: raw.reduce((s, r) => s + r.count, 0),
          value: money(
            raw.reduce((s, r) => s + r.total.amountMinor, 0),
            currency,
          ),
        },
      };
    });
  }
}
