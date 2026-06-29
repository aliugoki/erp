import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export type FbrEnv = 'sandbox' | 'production';

export interface FbrSellerConfig {
  sellerNtn: string;
  sellerName: string;
  posId: string;
  environment: FbrEnv;
  apiToken?: string | null;
}

export interface FbrReportResult {
  fbrInvoiceNumber: string;
  qr: string;
  environment: FbrEnv;
  response: unknown;
}

/** FBR Digital Invoicing endpoints (public). The sandbox path is used until a tenant supplies live
 * production credentials. */
const FBR_ENDPOINT: Record<FbrEnv, string> = {
  sandbox: 'https://gw.fbr.gov.pk/DI_data/v1/di/postinvoicedata_sb',
  production: 'https://gw.fbr.gov.pk/DI_data/v1/di/postinvoicedata',
};

/**
 * Talks to FBR's digital-invoicing API. With live production credentials it POSTs the invoice
 * (bounded by a timeout + one retry, per the external-call rules). Without them it runs in **sandbox**
 * mode: it synthesises an FBR invoice number + QR locally so the flow is fully exercisable, clearly
 * flagged `sandbox` in the stored response. Swap in real credentials to go live — no code change.
 */
@Injectable()
export class FbrClient {
  private readonly logger = new Logger(FbrClient.name);

  async report(config: FbrSellerConfig, payload: Record<string, unknown>): Promise<FbrReportResult> {
    const live = config.environment === 'production' && !!config.apiToken;
    return live ? this.postLive(config, payload) : this.simulate(config);
  }

  /** Local acknowledgement: a synthetic FBR invoice number (`<POS>-<YYYYMMDD>-<rand>`) + QR string. */
  private simulate(config: FbrSellerConfig): FbrReportResult {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    const number = `${(config.posId || 'POS').toUpperCase()}-${day}-${suffix}`;
    return {
      fbrInvoiceNumber: number,
      qr: number,
      environment: config.environment,
      response: { sandbox: true, note: 'Simulated FBR acknowledgement — supply production credentials to report live.' },
    };
  }

  /** Live FBR call: bounded timeout + a single retry; throws on non-2xx or a missing invoice number. */
  private async postLive(config: FbrSellerConfig, payload: Record<string, unknown>): Promise<FbrReportResult> {
    const url = FBR_ENDPOINT[config.environment];
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
        if (!res.ok) throw new Error(`FBR responded ${res.status}: ${String(body.message ?? res.statusText)}`);
        const number = body.InvoiceNumber ?? body.invoiceNumber ?? body.fbrInvoiceNumber;
        if (!number) throw new Error('FBR response did not include an invoice number');
        return { fbrInvoiceNumber: String(number), qr: String(number), environment: config.environment, response: body };
      } catch (err) {
        lastErr = err;
        this.logger.warn(`FBR report attempt ${attempt + 1} failed: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('FBR reporting failed');
  }
}
