import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Money } from '@metaxperts/shared';

/** A high-entropy secret that authorises confirming a payment session (returned to the buyer only). */
export function newClientSecret(): string {
  return randomBytes(24).toString('hex');
}

/** HMAC-SHA256 of `data` with `secret`, hex-encoded — the webhook signature an HTTP gateway must send. */
export function signWebhook(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison of a presented signature against the expected one. */
export function verifyWebhook(secret: string, data: string, presented: string): boolean {
  const expected = signWebhook(secret, data);
  const a = Buffer.from(expected);
  const b = Buffer.from(presented ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

type Row = Record<string, unknown>;
const money = (amountMinor: unknown, currency: unknown): Money => ({
  amountMinor: Number(amountMinor ?? 0),
  currency: (currency as string) ?? 'PKR',
});
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : ((v as string) ?? null));

export function mapPayment(r: Row, orderNo?: string) {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    orderNo: orderNo ?? (r.order_no as string) ?? null,
    provider: r.provider as string,
    status: r.status as string,
    amount: money(r.amount_minor, r.currency),
    providerRef: (r.provider_ref as string) ?? null,
    paidAt: iso(r.paid_at),
  };
}
