import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { EVENT_TYPES, type EcommerceOrderStatusChangedV1 } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type { SetPaymentConfigDto } from './dto/ecommerce.dto';
import { mapPayment, newClientSecret, signWebhook, verifyWebhook } from './payment.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

export interface PaymentConfig {
  provider: 'SIMULATED' | 'HTTP';
  gatewayUrl: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
  enabled: boolean;
}

/**
 * Card payments for the online store, behind a pluggable provider seam. `SIMULATED` (default) is a
 * self-hosted provider: the storefront pay page confirms with the session's client secret — no external
 * dependency. `HTTP` forwards the session to a configured gateway and is confirmed asynchronously by a
 * signed webhook. Either way an order is only marked PAID once the payment is confirmed (it is created
 * PENDING at checkout), and confirmation emits `ecommerce.order_status_changed` so the buyer is emailed.
 * No paid/closed SDK is bundled — a real gateway plugs in via config.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Config (admin) ────────────────────────────────────────────────────────────
  async getConfigInTx(m: Mgr): Promise<PaymentConfig> {
    const rows = (await m.query(`SELECT * FROM ec_payment_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
    const r = rows[0];
    return {
      provider: ((r?.provider as 'SIMULATED' | 'HTTP') ?? 'SIMULATED'),
      gatewayUrl: (r?.gateway_url as string) ?? null,
      webhookSecret: (r?.webhook_secret as string) ?? null,
      publishableKey: (r?.publishable_key as string) ?? null,
      enabled: r ? !!r.enabled : true,
    };
  }

  /** Public-safe view of the config — the webhook secret is never returned, only whether one is set. */
  private publicConfig(c: PaymentConfig) {
    const configured = c.webhookSecret != null && c.webhookSecret !== '';
    return { provider: c.provider, gatewayUrl: c.gatewayUrl, publishableKey: c.publishableKey, enabled: c.enabled, hasWebhookSecret: configured };
  }

  async getConfig() {
    return this.tenantTx.run(async (m) => this.publicConfig(await this.getConfigInTx(m)));
  }

  async setConfig(dto: SetPaymentConfigDto) {
    if (dto.provider === 'HTTP' && !dto.gatewayUrl) throw new BadRequestException('A gateway URL is required for the HTTP provider');
    return this.tenantTx.run(async (m) => {
      const existing = await this.getConfigInTx(m);
      // Auto-generate a webhook secret the first time an HTTP gateway is configured.
      const whs = dto.webhookSecret ?? existing.webhookSecret ?? (dto.provider === 'HTTP' ? newClientSecret() : null);
      await m.query(
        `INSERT INTO ec_payment_config (tenant_id, provider, gateway_url, webhook_secret, publishable_key, enabled)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, COALESCE($5,true))
         ON CONFLICT (tenant_id) DO UPDATE SET provider = $1, gateway_url = $2, webhook_secret = $3,
            publishable_key = $4, enabled = COALESCE($5, ec_payment_config.enabled), updated_at = now()`,
        [dto.provider, dto.gatewayUrl ?? null, whs, dto.publishableKey ?? null, dto.enabled ?? null],
      );
      return this.publicConfig(await this.getConfigInTx(m));
    });
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────────
  /** Create a PENDING payment session for an order (called at checkout, inside its transaction). */
  async createSessionInTx(
    m: Mgr,
    order: { id: string; orderNo: string; totalMinor: number; currency: string },
  ): Promise<{ paymentId: string; clientSecret: string; provider: string; redirectUrl: string | null }> {
    const cfg = await this.getConfigInTx(m);
    const cs = newClientSecret();
    const rows = (await m.query(
      `INSERT INTO ec_payment (tenant_id, order_id, provider, status, amount_minor, currency, client_secret, expires_at)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, 'PENDING', $3, $4, $5, now() + interval '30 minutes') RETURNING id`,
      [order.id, cfg.provider, order.totalMinor, order.currency, cs],
    )) as Array<{ id: string }>;
    const paymentId = rows[0]!.id;

    let redirectUrl: string | null = null;
    if (cfg.provider === 'HTTP' && cfg.gatewayUrl) {
      const session = await this.createHostedSession(cfg, order, paymentId);
      redirectUrl = session.redirectUrl;
      if (session.providerRef) await m.query(`UPDATE ec_payment SET provider_ref = $2 WHERE id = $1`, [paymentId, session.providerRef]);
    }
    return { paymentId, clientSecret: cs, provider: cfg.provider, redirectUrl };
  }

  /** Pay-page details (no secrets) — used to render the hosted payment step. */
  async getPayment(paymentId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT p.*, o.order_no FROM ec_payment p JOIN ec_order o ON o.id = p.order_id WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [paymentId],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Payment not found');
      const cfg = await this.getConfigInTx(m);
      return { ...mapPayment(rows[0]), publishableKey: cfg.publishableKey };
    });
  }

  /** SIMULATED provider: confirm with the session's client secret (stands in for a hosted-page success). */
  async confirmSimulated(paymentId: string, presentedSecret: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, order_id, provider, status, client_secret, (expires_at IS NOT NULL AND expires_at < now()) AS expired
         FROM ec_payment WHERE id = $1 AND deleted_at IS NULL`,
        [paymentId],
      )) as Array<{ id: string; order_id: string; provider: string; status: string; client_secret: string; expired: boolean }>;
      const p = rows[0];
      if (!p) throw new NotFoundException('Payment not found');
      if (p.provider !== 'SIMULATED') throw new BadRequestException('This payment is handled by an external gateway');
      if (p.client_secret !== presentedSecret) throw new UnauthorizedException('Invalid payment secret');
      if (p.status === 'PAID') return { status: 'PAID' as const };
      if (p.status !== 'PENDING') throw new BadRequestException(`Payment is ${p.status}`);
      if (p.expired) {
        await m.query(`UPDATE ec_payment SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [paymentId]);
        throw new BadRequestException('This payment session has expired — please place the order again');
      }
      await this.markPaidInTx(m, paymentId, `SIM..${paymentId.slice(0, 8)}`);
      return { status: 'PAID' as const };
    });
  }

  /** HTTP provider: a signed webhook from the gateway confirms (or fails) the payment. */
  async handleWebhook(body: { paymentId: string; status: string; signature: string; providerRef?: string }) {
    return this.tenantTx.run(async (m) => {
      const cfg = await this.getConfigInTx(m);
      if (cfg.provider !== 'HTTP' || !cfg.webhookSecret) throw new BadRequestException('No HTTP gateway configured');
      if (!verifyWebhook(cfg.webhookSecret, `${body.paymentId}.${body.status}`, body.signature)) {
        throw new UnauthorizedException('Invalid webhook signature');
      }
      const rows = (await m.query(`SELECT id, status FROM ec_payment WHERE id = $1 AND deleted_at IS NULL`, [body.paymentId])) as Array<{ id: string; status: string }>;
      if (!rows[0]) throw new NotFoundException('Payment not found');
      if (body.status === 'PAID') {
        if (rows[0].status !== 'PAID') await this.markPaidInTx(m, body.paymentId, body.providerRef ?? null);
      } else if (body.status === 'FAILED') {
        await m.query(`UPDATE ec_payment SET status = 'FAILED', updated_at = now() WHERE id = $1 AND status = 'PENDING'`, [body.paymentId]);
      }
      return { ok: true };
    });
  }

  /** Sign a webhook payload the way an HTTP gateway must (used by tooling / tests). */
  webhookSignature(secret: string, paymentId: string, status: string): string {
    return signWebhook(secret, `${paymentId}.${status}`);
  }

  /** Mark a payment + its order PAID (idempotent) and emit the status-change event for downstream email. */
  private async markPaidInTx(m: Mgr, paymentId: string, providerRef: string | null) {
    const payRes = (await m.query(
      `UPDATE ec_payment SET status = 'PAID', paid_at = now(), provider_ref = COALESCE($2, provider_ref), updated_at = now()
       WHERE id = $1 RETURNING order_id`,
      [paymentId, providerRef],
    )) as unknown;
    const payRows = (Array.isArray(payRes) && Array.isArray(payRes[0]) ? payRes[0] : payRes) as Array<{ order_id: string }>;
    const orderId = payRows[0]?.order_id;
    if (!orderId) return;
    const ordRows = (await m.query(`SELECT order_no, status FROM ec_order WHERE id = $1 AND deleted_at IS NULL`, [orderId])) as Array<{ order_no: string; status: string }>;
    const order = ordRows[0];
    // Idempotent, and never resurrect an order the expiry sweep already cancelled/restocked.
    if (!order || ['PAID', 'CANCELLED', 'REFUNDED'].includes(order.status)) return;
    await m.query(
      `UPDATE ec_order SET status = 'PAID', payment_status = 'PAID', payment_reference = COALESCE($2, payment_reference), updated_at = now() WHERE id = $1`,
      [orderId, providerRef],
    );
    const payload: EcommerceOrderStatusChangedV1 = { orderId, orderNo: order.order_no, status: 'PAID', previousStatus: order.status };
    await this.outbox.write(m, EVENT_TYPES.ECOMMERCE_ORDER_STATUS_CHANGED, payload);
    this.logger.log(`payment confirmed for order ${order.order_no}`);
  }

  // ── HTTP gateway adapter (external call: timeout + one retry + failure path) ─────
  private async createHostedSession(
    cfg: PaymentConfig,
    order: { orderNo: string; totalMinor: number; currency: string },
    paymentId: string,
  ): Promise<{ redirectUrl: string | null; providerRef: string | null }> {
    const payload = JSON.stringify({ reference: order.orderNo, amountMinor: order.totalMinor, currency: order.currency, paymentId });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 8000);
      try {
        const res = await fetch(`${cfg.gatewayUrl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.publishableKey ? { Authorization: ['Bearer', cfg.publishableKey].join(' ') } : {}) },
          body: payload,
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`gateway responded ${res.status}`);
        const data = (await res.json()) as { url?: string; redirectUrl?: string; id?: string };
        return { redirectUrl: data.redirectUrl ?? data.url ?? null, providerRef: data.id ?? null };
      } catch (e) {
        this.logger.warn(`gateway session attempt ${attempt} failed: ${(e as Error).message}`);
        if (attempt === 2) throw new ServiceUnavailableException('Payment gateway is unavailable, please try again');
      } finally {
        clearTimeout(timer);
      }
    }
    return { redirectUrl: null, providerRef: null };
  }
}
