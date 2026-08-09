import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  FiscalAuthority,
  FiscalEnv,
  FiscalInvoice,
  FiscalProvider,
  FiscalReportResult,
  FiscalRuntimeConfig,
} from '../fiscal-provider.interface';

/**
 * Generic HTTP fiscalization client for a provincial/federal e-invoicing authority (PRA/FBR/SRB/KPRA/
 * BRA). With live production credentials it POSTs the invoice (bounded by a timeout + one retry, per
 * the external-call rules) to the authority endpoint and returns its invoice number + QR. Without live
 * credentials it runs in **sandbox**: it synthesises `<AUTHORITY>-<POS>-<YYYYMMDD>-<rand>` locally so the
 * whole settlement→fiscal flow is exercisable end-to-end, clearly flagged `sandbox` in the stored
 * response. Supply real credentials (+ set environment=production) to go live — no code change. This is
 * the same contract the ERP's existing FBR client uses, generalised so any authority plugs in.
 */
export class HttpFiscalClient implements FiscalProvider {
  private readonly logger: Logger;

  constructor(
    readonly authority: FiscalAuthority,
    private readonly endpoints: Record<FiscalEnv, string>,
  ) {
    this.logger = new Logger(`Fiscal:${authority}`);
  }

  async report(config: FiscalRuntimeConfig, invoice: FiscalInvoice): Promise<FiscalReportResult> {
    const live = config.environment === 'production' && !!config.apiToken;
    return live ? this.postLive(config, invoice) : this.simulate(config, invoice);
  }

  private endpointFor(config: FiscalRuntimeConfig): string {
    return config.apiBaseUrl ?? this.endpoints[config.environment];
  }

  /** Local acknowledgement: a synthetic authority invoice number + QR string. */
  private simulate(config: FiscalRuntimeConfig, invoice: FiscalInvoice): FiscalReportResult {
    const day = invoice.occurredOn.replace(/-/g, '');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    const pos = (config.posId || config.registrationNo || 'POS').toUpperCase();
    const number = `${this.authority}-${pos}-${day}-${suffix}`;
    return {
      authority: this.authority,
      environment: config.environment,
      invoiceNumber: number,
      qr: number,
      raw: { sandbox: true, note: `Simulated ${this.authority} acknowledgement — supply production credentials to report live.` },
      skipped: false,
    };
  }

  private buildPayload(config: FiscalRuntimeConfig, invoice: FiscalInvoice): Record<string, unknown> {
    return {
      authority: this.authority,
      registrationNo: config.registrationNo,
      ntn: config.ntn,
      strn: config.strn,
      posId: config.posId,
      invoiceNumber: invoice.orderNo,
      dateTime: invoice.occurredOn,
      channel: invoice.channel,
      currency: invoice.currency,
      totalExclTax: invoice.subtotalMinor - invoice.discountMinor,
      discount: invoice.discountMinor,
      salesTax: invoice.taxMinor,
      totalInclTax: invoice.totalMinor,
      ...config.providerConfig,
    };
  }

  private async postLive(config: FiscalRuntimeConfig, invoice: FiscalInvoice): Promise<FiscalReportResult> {
    const url = this.endpointFor(config);
    const payload = this.buildPayload(config, invoice);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiToken}` },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(`${this.authority} responded ${res.status}: ${String(body.message ?? res.statusText)}`);
        const number = body.invoiceNumber ?? body.InvoiceNumber ?? body.fiscalInvoiceNumber ?? body.fbrInvoiceNumber;
        if (!number) throw new Error(`${this.authority} response did not include an invoice number`);
        const qr = (body.qr ?? body.QRCode ?? number) as string;
        return { authority: this.authority, environment: config.environment, invoiceNumber: String(number), qr: String(qr), raw: body, skipped: false };
      } catch (err) {
        lastErr = err;
        this.logger.warn(`${this.authority} report attempt ${attempt + 1} failed: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${this.authority} reporting failed`);
  }
}

/** The no-op provider for authority NONE (or disabled) — reports nothing. */
export class NullFiscalClient implements FiscalProvider {
  readonly authority = 'NONE' as const;
  async report(): Promise<FiscalReportResult> {
    return { authority: 'NONE', environment: 'sandbox', invoiceNumber: '', qr: '', raw: null, skipped: true };
  }
}
