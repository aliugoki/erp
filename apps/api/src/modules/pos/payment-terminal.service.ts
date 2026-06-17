import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CircuitBreaker, CircuitOpenError } from '../../common/resilience/circuit-breaker';
import { type TerminalChargeResult, simulateTerminalCharge } from './pos.util';

export interface TerminalConfig {
  cardTerminalProvider: string; // NONE | SIMULATED | BRIDGE
  cardTerminalUrl: string | null;
  currency: string;
}

/**
 * Drives a physical card machine for a POS register through a pluggable provider (open-source /
 * self-hostable only — no third-party gateway SDK):
 *
 *  - **NONE** — no terminal; card tenders are keyed in manually (422 if a charge is attempted).
 *  - **SIMULATED** — the built-in deterministic approver ({@link simulateTerminalCharge}); for demos/dev.
 *  - **BRIDGE** — POSTs the charge to a local agent on the cashier's PC (`card_terminal_url`) that
 *    speaks to the reader. Resilient per ADR-004: bounded timeout + circuit breaker + a typed failure
 *    path. **Deliberately NOT auto-retried** — a card charge is not idempotent, so a timeout returns
 *    ERROR and the cashier decides whether to re-present, rather than risking a double charge.
 *
 * Bridge contract — `POST <card_terminal_url>` with `{ amountMinor, currency, reference }`, expecting
 * `{ status: 'APPROVED'|'DECLINED', reference, scheme?, last4?, message? }`.
 */
@Injectable()
export class PaymentTerminalService {
  private readonly breaker = new CircuitBreaker({ name: 'pos-card-terminal', threshold: 5, cooldownMs: 30_000 });
  private readonly timeoutMs = 60_000; // card-present transactions are slow (PIN entry); generous bound.

  get breakerState(): string {
    return this.breaker.currentState;
  }

  async charge(reg: TerminalConfig, p: { amountMinor: number; reference: string }): Promise<TerminalChargeResult> {
    if (p.amountMinor <= 0) throw new BadRequestException('Charge amount must be positive');
    const provider = reg.cardTerminalProvider ?? 'NONE';
    if (provider === 'NONE') {
      throw new UnprocessableEntityException('No card terminal configured for this register — key the card reference manually');
    }
    if (provider === 'SIMULATED') return simulateTerminalCharge(p.reference, p.amountMinor);
    if (!reg.cardTerminalUrl) throw new UnprocessableEntityException('Card terminal URL is not set for this register');
    try {
      return await this.breaker.exec(() => this.callBridge(reg.cardTerminalUrl!, reg.currency, p));
    } catch (err) {
      const message =
        err instanceof CircuitOpenError
          ? 'Card terminal temporarily unavailable (too many recent failures) — try again shortly'
          : err instanceof Error
            ? err.message
            : 'Card terminal error';
      return { status: 'ERROR', reference: null, scheme: null, last4: null, message };
    }
  }

  /** One bounded, non-retried call to the local terminal agent. Connectivity failures throw (so the
   * breaker counts them); a DECLINED/APPROVED body is a normal result. */
  private async callBridge(
    url: string,
    currency: string,
    p: { amountMinor: number; reference: string },
  ): Promise<TerminalChargeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountMinor: p.amountMinor, currency, reference: p.reference }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { status: 'ERROR', reference: null, scheme: null, last4: null, message: `Terminal responded HTTP ${res.status}` };
      }
      const body = (await res.json()) as Partial<TerminalChargeResult>;
      const status = body.status === 'APPROVED' || body.status === 'DECLINED' ? body.status : 'ERROR';
      return {
        status,
        reference: body.reference ?? null,
        scheme: body.scheme ?? null,
        last4: body.last4 ?? null,
        message: body.message ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
