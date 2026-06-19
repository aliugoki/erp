import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  EVENT_TYPES,
  type SubscriptionCanceledV1, type SubscriptionCreatedV1,
  type SubscriptionInvoicePaidV1, type SubscriptionPaymentFailedV1,
} from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  CancelSubscriptionDto, ChangeSubscriptionDto, CreateSubscriptionDto,
  MarkInvoicePaidDto, SetSubGlConfigDto, UpsertPlanDto,
} from './dto/subscriptions.dto';
import { type Interval, intervalLiteral, mapInvoice, mapPlan, mapSubscription, monthlyMinor, nextSubNo } from './subscriptions.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

const MAX_DUNNING = 4; // overdue attempts before a subscription is cancelled (uncollectible)
const GRACE_DAYS = 7; // days a manual invoice stays open before it's overdue

const SUB_SELECT = `
  SELECT s.*, (SELECT name FROM sub_plan p WHERE p.id = s.plan_id) AS plan_name,
         (SELECT count(*) FROM sub_invoice i WHERE i.subscription_id = s.id AND i.deleted_at IS NULL) AS invoice_count
  FROM subscription s`;

/**
 * Subscriptions & recurring billing. Plans define a price per interval; subscriptions instantiate a plan
 * for a subscriber. The billing engine (run on a schedule, or on demand) generates an invoice each cycle,
 * auto-collects it (AUTO) or leaves it open (MANUAL), advances the period, and duns overdue invoices to
 * exhaustion → cancellation. Paid invoices and lifecycle changes flow through the outbox for GL posting,
 * notifications, and customer emails (ADR-004). All money in integer minor units.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  // ── Plans ─────────────────────────────────────────────────────────────────────
  async listPlans() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.*, (SELECT count(*) FROM subscription s WHERE s.plan_id = p.id AND s.status IN ('ACTIVE','TRIALING','PAST_DUE') AND s.deleted_at IS NULL) AS active_subscriptions
         FROM sub_plan p WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC`,
      )) as Row[];
      return rows.map(mapPlan);
    });
  }

  async createPlan(dto: UpsertPlanDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO sub_plan (tenant_id, name, code, description, currency, amount_minor, tax_rate, billing_interval, interval_count, trial_days, setup_fee_minor, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4,'PKR'), $5, COALESCE($6,0), $7, COALESCE($8,1), COALESCE($9,0), COALESCE($10,0), COALESCE($11,'ACTIVE'))
         RETURNING *`,
        [dto.name, dto.code ?? null, dto.description ?? null, dto.currency ?? null, dto.amountMinor, dto.taxRate ?? null, dto.billingInterval, dto.intervalCount ?? null, dto.trialDays ?? null, dto.setupFeeMinor ?? null, dto.status ?? null],
      ).catch(rethrowCodeConflict)) as Row[];
      return mapPlan(rows[0]!);
    });
  }

  async updatePlan(id: string, dto: UpsertPlanDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE sub_plan SET name = COALESCE($2, name), code = $3, description = $4, currency = COALESCE($5, currency),
            amount_minor = COALESCE($6, amount_minor), tax_rate = COALESCE($7, tax_rate), billing_interval = COALESCE($8, billing_interval),
            interval_count = COALESCE($9, interval_count), trial_days = COALESCE($10, trial_days), setup_fee_minor = COALESCE($11, setup_fee_minor),
            status = COALESCE($12, status), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, dto.name ?? null, dto.code ?? null, dto.description ?? null, dto.currency ?? null, dto.amountMinor ?? null, dto.taxRate ?? null, dto.billingInterval ?? null, dto.intervalCount ?? null, dto.trialDays ?? null, dto.setupFeeMinor ?? null, dto.status ?? null],
      ).catch(rethrowCodeConflict)) as Row[];
      if (!rows[0]) throw new NotFoundException('Plan not found');
      return mapPlan(rows[0]);
    });
  }

  async archivePlan(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE sub_plan SET status = 'ARCHIVED', updated_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────────
  private async planRow(m: Mgr, planId: string): Promise<Row> {
    const rows = (await m.query(`SELECT * FROM sub_plan WHERE id = $1 AND deleted_at IS NULL`, [planId])) as Row[];
    if (!rows[0]) throw new NotFoundException('Plan not found');
    return rows[0];
  }

  async createSubscription(dto: CreateSubscriptionDto) {
    return this.tenantTx.run(async (m) => {
      const plan = await this.planRow(m, dto.planId);
      if ((plan.status as string) !== 'ACTIVE') throw new BadRequestException('Plan is archived');
      const qty = dto.quantity ?? 1;
      const amount = Number(plan.amount_minor) * qty;
      const interval = plan.billing_interval as Interval;
      const count = Number(plan.interval_count);
      const ivl = intervalLiteral(interval, count);
      const trialDays = Number(plan.trial_days);
      const mode = dto.collectionMode ?? 'AUTO';
      const subNo = await nextSubNo(m, 'SUB', 'SUB');
      let clientId = dto.clientId ?? null;
      if (!clientId) {
        const cc = (await m.query(`SELECT client_id FROM crm_contact WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`, [dto.customerEmail])) as Array<{ client_id: string }>;
        clientId = cc[0]?.client_id ?? null;
      }
      // Trial → period runs to trial end, no charge yet. No trial → first period starts now and bills now.
      const rows = (await m.query(
        `INSERT INTO subscription (tenant_id, subscription_no, plan_id, client_id, customer_name, customer_email, quantity, collection_mode,
            status, amount_minor, tax_rate, currency, billing_interval, interval_count, start_date,
            current_period_start, current_period_end, trial_end, next_billing_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, COALESCE($14::date, current_date),
            now(),
            CASE WHEN $15 > 0 THEN now() + ($15 || ' days')::interval ELSE now() + ${ivl} END,
            CASE WHEN $15 > 0 THEN now() + ($15 || ' days')::interval ELSE NULL END,
            CASE WHEN $15 > 0 THEN now() + ($15 || ' days')::interval ELSE now() + ${ivl} END)
         RETURNING *`,
        [subNo, dto.planId, clientId, dto.customerName, dto.customerEmail.toLowerCase(), qty, mode,
          trialDays > 0 ? 'TRIALING' : 'ACTIVE', amount, Number(plan.tax_rate), plan.currency, interval, count,
          dto.startDate ?? null, trialDays],
      )) as Row[];
      const sub = rows[0]!;
      const subId = sub.id as string;
      // No trial → bill the first period immediately (including any setup fee), and collect if AUTO.
      if (trialDays <= 0) {
        await this.generateInvoiceInTx(m, sub, sub.current_period_start, sub.current_period_end, Number(plan.setup_fee_minor));
      }
      const created: SubscriptionCreatedV1 = {
        subscriptionId: subId, subscriptionNo: subNo, planId: dto.planId, customerEmail: dto.customerEmail.toLowerCase(),
        clientId, amountMinor: amount, currency: plan.currency as string,
      };
      await this.outbox.write(m, EVENT_TYPES.SUBSCRIPTION_CREATED, created);
      return this.subscriptionWithInvoices(m, subId);
    });
  }

  /** Generate an invoice for a period and, for AUTO subscriptions, collect it immediately. */
  private async generateInvoiceInTx(m: Mgr, sub: Row, periodStart: unknown, periodEnd: unknown, extraMinor = 0) {
    const subId = sub.id as string;
    const amount = Number(sub.amount_minor) + extraMinor;
    const taxRate = Number(sub.tax_rate);
    const tax = Math.floor((amount * taxRate) / 100);
    const total = amount + tax;
    const invNo = await nextSubNo(m, 'SINV', 'INVOICE');
    const auto = (sub.collection_mode as string) === 'AUTO';
    const rows = (await m.query(
      `INSERT INTO sub_invoice (tenant_id, invoice_no, subscription_id, client_id, period_start, period_end, amount_minor, tax_minor, total_minor, currency, status, due_date)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + ($11 || ' days')::interval)
       RETURNING *`,
      [invNo, subId, (sub.client_id as string) ?? null, periodStart, periodEnd, amount, tax, total, sub.currency, auto ? 'PAID' : 'OPEN', auto ? 0 : GRACE_DAYS],
    )) as Row[];
    const inv = rows[0]!;
    if (auto) {
      await m.query(`UPDATE sub_invoice SET paid_at = now(), payment_ref = 'AUTO-CHARGE' WHERE id = $1`, [inv.id]);
      await this.emitInvoicePaid(m, inv, sub);
    }
    return inv;
  }

  private async emitInvoicePaid(m: Mgr, inv: Row, sub: Row) {
    const payload: SubscriptionInvoicePaidV1 = {
      invoiceId: inv.id as string, invoiceNo: inv.invoice_no as string, subscriptionId: sub.id as string,
      clientId: (sub.client_id as string) ?? null, customerEmail: sub.customer_email as string,
      totalMinor: Number(inv.total_minor), currency: inv.currency as string,
    };
    await this.outbox.write(m, EVENT_TYPES.SUBSCRIPTION_INVOICE_PAID, payload);
  }

  private async subscriptionWithInvoices(m: Mgr, id: string) {
    const rows = (await m.query(`${SUB_SELECT} WHERE s.id = $1 AND s.deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Subscription not found');
    const invs = (await m.query(`SELECT * FROM sub_invoice WHERE subscription_id = $1 AND deleted_at IS NULL ORDER BY issued_at DESC`, [id])) as Row[];
    return { ...mapSubscription(rows[0]), invoices: invs.map(mapInvoice) };
  }

  async listSubscriptions(filter: { status?: string; planId?: string; q?: string }) {
    return this.tenantTx.run(async (m) => {
      const conds = ['s.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter.status) conds.push(`s.status = $${params.push(filter.status)}`);
      if (filter.planId) conds.push(`s.plan_id = $${params.push(filter.planId)}`);
      if (filter.q) conds.push(`(s.subscription_no ILIKE $${params.push(`%${filter.q}%`)} OR s.customer_name ILIKE $${params.length} OR s.customer_email ILIKE $${params.length})`);
      const rows = (await m.query(`${SUB_SELECT} WHERE ${conds.join(' AND ')} ORDER BY s.created_at DESC LIMIT 200`, params)) as Row[];
      return rows.map(mapSubscription);
    });
  }

  async getSubscription(id: string) {
    return this.tenantTx.run((m) => this.subscriptionWithInvoices(m, id));
  }

  async changeSubscription(id: string, dto: ChangeSubscriptionDto) {
    return this.tenantTx.run(async (m) => {
      const s = await this.subRow(m, id);
      let amount = Number(s.amount_minor);
      let interval = s.billing_interval as string;
      let count = Number(s.interval_count);
      let taxRate = Number(s.tax_rate);
      let planId = s.plan_id as string;
      const qty = dto.quantity ?? Number(s.quantity);
      if (dto.planId && dto.planId !== planId) {
        const plan = await this.planRow(m, dto.planId);
        planId = dto.planId; interval = plan.billing_interval as string; count = Number(plan.interval_count); taxRate = Number(plan.tax_rate);
        amount = Number(plan.amount_minor) * qty;
      } else {
        amount = Math.round(amount / Number(s.quantity)) * qty; // re-scale by quantity
      }
      await m.query(
        `UPDATE subscription SET plan_id = $2, quantity = $3, amount_minor = $4, tax_rate = $5, billing_interval = $6, interval_count = $7, updated_at = now() WHERE id = $1`,
        [id, planId, qty, amount, taxRate, interval, count],
      );
      return this.subscriptionWithInvoices(m, id);
    });
  }

  async pauseSubscription(id: string) {
    return this.tenantTx.run(async (m) => {
      const s = await this.subRow(m, id);
      if (!['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(s.status as string)) throw new BadRequestException('Only an active subscription can be paused');
      await m.query(`UPDATE subscription SET status = 'PAUSED', paused_at = now(), updated_at = now() WHERE id = $1`, [id]);
      return this.subscriptionWithInvoices(m, id);
    });
  }

  async resumeSubscription(id: string) {
    return this.tenantTx.run(async (m) => {
      const s = await this.subRow(m, id);
      if ((s.status as string) !== 'PAUSED') throw new BadRequestException('Subscription is not paused');
      const ivl = intervalLiteral(s.billing_interval as Interval, Number(s.interval_count));
      await m.query(
        `UPDATE subscription SET status = 'ACTIVE', paused_at = NULL, current_period_start = now(),
            current_period_end = now() + ${ivl}, next_billing_at = now() + ${ivl}, updated_at = now() WHERE id = $1`,
        [id],
      );
      return this.subscriptionWithInvoices(m, id);
    });
  }

  async cancelSubscription(id: string, dto: CancelSubscriptionDto, reason: 'ADMIN' | 'CUSTOMER' = 'ADMIN') {
    return this.tenantTx.run((m) => this.cancelInTx(m, id, !!dto.atPeriodEnd, reason));
  }

  private async cancelInTx(m: Mgr, id: string, atPeriodEnd: boolean, reason: 'ADMIN' | 'CUSTOMER' | 'DUNNING') {
    const s = await this.subRow(m, id);
    if (['CANCELLED', 'EXPIRED'].includes(s.status as string)) return this.subscriptionWithInvoices(m, id);
    if (atPeriodEnd) {
      await m.query(`UPDATE subscription SET cancel_at_period_end = true, updated_at = now() WHERE id = $1`, [id]);
    } else {
      await m.query(`UPDATE subscription SET status = 'CANCELLED', canceled_at = now(), updated_at = now() WHERE id = $1`, [id]);
      const payload: SubscriptionCanceledV1 = { subscriptionId: id, subscriptionNo: s.subscription_no as string, customerEmail: s.customer_email as string, reason };
      await this.outbox.write(m, EVENT_TYPES.SUBSCRIPTION_CANCELED, payload);
    }
    return this.subscriptionWithInvoices(m, id);
  }

  private async subRow(m: Mgr, id: string): Promise<Row> {
    const rows = (await m.query(`SELECT * FROM subscription WHERE id = $1 AND deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Subscription not found');
    return rows[0];
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────
  async listInvoices(filter: { subscriptionId?: string; status?: string }) {
    return this.tenantTx.run(async (m) => {
      const conds = ['i.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter.subscriptionId) conds.push(`i.subscription_id = $${params.push(filter.subscriptionId)}`);
      if (filter.status) conds.push(`i.status = $${params.push(filter.status)}`);
      const rows = (await m.query(
        `SELECT i.*, (SELECT subscription_no FROM subscription s WHERE s.id = i.subscription_id) AS subscription_no
         FROM sub_invoice i WHERE ${conds.join(' AND ')} ORDER BY i.issued_at DESC LIMIT 300`,
        params,
      )) as Row[];
      return rows.map(mapInvoice);
    });
  }

  async markInvoicePaid(id: string, dto: MarkInvoicePaidDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM sub_invoice WHERE id = $1 AND deleted_at IS NULL`, [id])) as Row[];
      const inv = rows[0];
      if (!inv) throw new NotFoundException('Invoice not found');
      if ((inv.status as string) === 'PAID') return mapInvoice(inv);
      if ((inv.status as string) !== 'OPEN') throw new BadRequestException(`Invoice is ${inv.status}`);
      await m.query(`UPDATE sub_invoice SET status = 'PAID', paid_at = now(), payment_ref = $2 WHERE id = $1`, [id, dto.paymentRef ?? 'MANUAL']);
      const sub = await this.subRow(m, inv.subscription_id as string);
      await m.query(`UPDATE subscription SET status = CASE WHEN status = 'PAST_DUE' THEN 'ACTIVE' ELSE status END, failed_attempts = 0, updated_at = now() WHERE id = $1`, [sub.id]);
      await this.emitInvoicePaid(m, inv, sub);
      return mapInvoice({ ...inv, status: 'PAID' });
    });
  }

  async voidInvoice(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE sub_invoice SET status = 'VOID' WHERE id = $1 AND status = 'OPEN'`, [id]);
      return { ok: true };
    });
  }

  // ── Billing engine ──────────────────────────────────────────────────────────────
  /** Generate due invoices (+ collect AUTO), then dun overdue ones. Returns activity counts. */
  private async processBillingInTx(m: Mgr): Promise<{ billed: number; dunned: number; canceled: number }> {
    let billed = 0, dunned = 0, canceled = 0;
    // 1) Due subscriptions → new period invoice.
    const due = (await m.query(
      `SELECT * FROM subscription WHERE status IN ('TRIALING','ACTIVE') AND paused_at IS NULL
         AND next_billing_at IS NOT NULL AND next_billing_at <= now() AND deleted_at IS NULL ORDER BY next_billing_at LIMIT 500`,
    )) as Row[];
    for (const sub of due) {
      if (sub.cancel_at_period_end) {
        await this.cancelInTx(m, sub.id as string, false, 'CUSTOMER');
        canceled++;
        continue;
      }
      const ivl = intervalLiteral(sub.billing_interval as Interval, Number(sub.interval_count));
      const advanced = (await m.query(
        `UPDATE subscription SET current_period_start = current_period_end, current_period_end = current_period_end + ${ivl},
            next_billing_at = current_period_end + ${ivl}, status = 'ACTIVE', updated_at = now()
         WHERE id = $1 RETURNING current_period_start, current_period_end`,
        [sub.id],
      )) as unknown;
      const adv = (rowsOf(advanced) as Array<{ current_period_start: unknown; current_period_end: unknown }>)[0]!;
      await this.generateInvoiceInTx(m, { ...sub, status: 'ACTIVE' }, adv.current_period_start, adv.current_period_end);
      billed++;
    }
    // 2) Dunning: open invoices past their due date.
    const overdue = (await m.query(
      `SELECT i.*, s.collection_mode, s.customer_email, s.subscription_no, s.failed_attempts AS sub_failed
       FROM sub_invoice i JOIN subscription s ON s.id = i.subscription_id
       WHERE i.status = 'OPEN' AND i.due_date < now() AND i.deleted_at IS NULL AND s.deleted_at IS NULL
         AND s.status NOT IN ('CANCELLED','EXPIRED','PAUSED') LIMIT 500`,
    )) as Row[];
    for (const inv of overdue) {
      if ((inv.collection_mode as string) === 'AUTO') {
        // Retry the (simulated) charge — succeeds, clearing the past-due state.
        await m.query(`UPDATE sub_invoice SET status = 'PAID', paid_at = now(), payment_ref = 'AUTO-RETRY', attempt_count = attempt_count + 1 WHERE id = $1`, [inv.id]);
        await m.query(`UPDATE subscription SET status = 'ACTIVE', failed_attempts = 0, updated_at = now() WHERE id = $1`, [inv.subscription_id]);
        const sub = await this.subRow(m, inv.subscription_id as string);
        await this.emitInvoicePaid(m, inv, sub);
        continue;
      }
      const attempts = Number(inv.sub_failed) + 1;
      await m.query(`UPDATE sub_invoice SET attempt_count = attempt_count + 1 WHERE id = $1`, [inv.id]);
      await m.query(`UPDATE subscription SET status = 'PAST_DUE', failed_attempts = $2, updated_at = now() WHERE id = $1`, [inv.subscription_id, attempts]);
      const failed: SubscriptionPaymentFailedV1 = {
        invoiceId: inv.id as string, invoiceNo: inv.invoice_no as string, subscriptionId: inv.subscription_id as string,
        customerEmail: inv.customer_email as string, attemptCount: attempts, totalMinor: Number(inv.total_minor), currency: inv.currency as string,
      };
      await this.outbox.write(m, EVENT_TYPES.SUBSCRIPTION_PAYMENT_FAILED, failed);
      dunned++;
      if (attempts >= MAX_DUNNING) {
        await m.query(`UPDATE sub_invoice SET status = 'UNCOLLECTIBLE' WHERE id = $1`, [inv.id]);
        await this.cancelInTx(m, inv.subscription_id as string, false, 'DUNNING');
        canceled++;
      }
    }
    return { billed, dunned, canceled };
  }

  async runBilling() {
    return this.tenantTx.run((m) => this.processBillingInTx(m));
  }

  async runBillingAllTenants(): Promise<{ billed: number; dunned: number; canceled: number }> {
    const tenants = (await this.dataSource.query(`SELECT id FROM tenants WHERE deleted_at IS NULL`)) as Array<{ id: string }>;
    const totals = { billed: 0, dunned: 0, canceled: 0 };
    for (const { id } of tenants) {
      try {
        const r = await this.tenantTx.runFor(id, (m) => this.processBillingInTx(m));
        totals.billed += r.billed; totals.dunned += r.dunned; totals.canceled += r.canceled;
      } catch {
        /* one tenant's failure shouldn't stop the run */
      }
    }
    return totals;
  }

  // ── GL config + consumer reads ──────────────────────────────────────────────────
  async getGlConfig() {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async glConfigInTx(m: Mgr) {
    const rows = (await m.query(`SELECT * FROM sub_gl_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
    const r = rows[0] ?? {};
    return {
      clearingAccountId: (r.clearing_account_id as string) ?? null,
      revenueAccountId: (r.revenue_account_id as string) ?? null,
      taxAccountId: (r.tax_account_id as string) ?? null,
    };
  }

  async setGlConfig(dto: SetSubGlConfigDto) {
    return this.tenantTx.run(async (m) => {
      await m.query(
        `INSERT INTO sub_gl_config (tenant_id, clearing_account_id, revenue_account_id, tax_account_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET clearing_account_id = $1, revenue_account_id = $2, tax_account_id = $3, updated_at = now()`,
        [dto.clearingAccountId ?? null, dto.revenueAccountId ?? null, dto.taxAccountId ?? null],
      );
      return this.glConfigInTx(m);
    });
  }

  /** Minimal subscriber info for notifications/emails (consumer reads inside its own tx). */
  async subscriptionForNotifyInTx(m: Mgr, subscriptionId: string) {
    const rows = (await m.query(
      `SELECT subscription_no, customer_name, customer_email FROM subscription WHERE id = $1 AND deleted_at IS NULL`,
      [subscriptionId],
    )) as Row[];
    if (!rows[0]) return null;
    return { subscriptionNo: rows[0].subscription_no as string, customerName: rows[0].customer_name as string, customerEmail: rows[0].customer_email as string };
  }

  async invoiceForGlInTx(m: Mgr, invoiceId: string) {
    const rows = (await m.query(
      `SELECT invoice_no, amount_minor, tax_minor, total_minor, COALESCE(paid_at, issued_at)::date::text AS occurred_on
       FROM sub_invoice WHERE id = $1 AND deleted_at IS NULL`,
      [invoiceId],
    )) as Row[];
    if (!rows[0]) return null;
    const r = rows[0];
    return { invoiceNo: r.invoice_no as string, amountMinor: Number(r.amount_minor), taxMinor: Number(r.tax_minor), totalMinor: Number(r.total_minor), occurredOn: r.occurred_on as string };
  }

  // ── Metrics ──────────────────────────────────────────────────────────────────────
  async metrics() {
    return this.tenantTx.run(async (m) => {
      const subs = (await m.query(
        `SELECT s.amount_minor, s.billing_interval, s.interval_count, s.quantity, s.status, s.currency, s.plan_id,
                (SELECT name FROM sub_plan p WHERE p.id = s.plan_id) AS plan_name
         FROM subscription s WHERE s.deleted_at IS NULL AND s.status IN ('ACTIVE','TRIALING','PAST_DUE')`,
      )) as Row[];
      let mrr = 0;
      const byPlan = new Map<string, { name: string; count: number; mrr: number }>();
      for (const s of subs) {
        const m1 = monthlyMinor(Number(s.amount_minor), s.billing_interval as Interval, Number(s.interval_count));
        mrr += m1;
        const key = s.plan_id as string;
        const e = byPlan.get(key) ?? { name: (s.plan_name as string) ?? 'Plan', count: 0, mrr: 0 };
        e.count++; e.mrr += m1; byPlan.set(key, e);
      }
      const counts = (await m.query(
        `SELECT count(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
                count(*) FILTER (WHERE status = 'TRIALING')::int AS trialing,
                count(*) FILTER (WHERE status = 'PAST_DUE')::int AS past_due,
                count(*) FILTER (WHERE status = 'CANCELLED' AND canceled_at >= now() - interval '30 days')::int AS churned30
         FROM subscription WHERE deleted_at IS NULL`,
      )) as Array<Row>;
      const c = counts[0] ?? {};
      const currency = (subs[0]?.currency as string) ?? 'PKR';
      const activeBase = Number(c.active ?? 0) + Number(c.trialing ?? 0) + Number(c.past_due ?? 0);
      return {
        mrr: { amountMinor: mrr, currency },
        arr: { amountMinor: mrr * 12, currency },
        active: Number(c.active ?? 0),
        trialing: Number(c.trialing ?? 0),
        pastDue: Number(c.past_due ?? 0),
        churned30: Number(c.churned30 ?? 0),
        churnRate: activeBase > 0 ? Math.round((Number(c.churned30 ?? 0) / (activeBase + Number(c.churned30 ?? 0))) * 1000) / 10 : 0,
        byPlan: [...byPlan.values()].map((e) => ({ name: e.name, count: e.count, mrr: { amountMinor: e.mrr, currency } })),
      };
    });
  }

  // ── Customer portal ──────────────────────────────────────────────────────────────
  async portalList(customer: { email: string }) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`${SUB_SELECT} WHERE lower(s.customer_email) = lower($1) AND s.deleted_at IS NULL ORDER BY s.created_at DESC`, [customer.email])) as Row[];
      return rows.map(mapSubscription);
    });
  }

  async portalGet(customer: { email: string }, subscriptionNo: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, customer_email FROM subscription WHERE subscription_no = $1 AND deleted_at IS NULL`, [subscriptionNo])) as Array<{ id: string; customer_email: string }>;
      if (!rows[0] || rows[0].customer_email.toLowerCase() !== customer.email.toLowerCase()) throw new NotFoundException('Subscription not found');
      return this.subscriptionWithInvoices(m, rows[0].id);
    });
  }

  async portalCancel(customer: { email: string }, subscriptionNo: string, atPeriodEnd: boolean) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, customer_email FROM subscription WHERE subscription_no = $1 AND deleted_at IS NULL`, [subscriptionNo])) as Array<{ id: string; customer_email: string }>;
      if (!rows[0] || rows[0].customer_email.toLowerCase() !== customer.email.toLowerCase()) throw new NotFoundException('Subscription not found');
      return this.cancelInTx(m, rows[0].id, atPeriodEnd, 'CUSTOMER');
    });
  }
}

function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
function rethrowCodeConflict(e: unknown): never {
  if (isUnique(e)) throw new BadRequestException('A plan with that code already exists');
  throw e;
}
