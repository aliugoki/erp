/**
 * Dynamic fiscalization contract (ADR-011 §7). A restaurant branch reports each settled bill to the
 * tax authority chosen in its `restaurant_fiscal_config` — PRA (Punjab), FBR (federal), SRB (Sindh),
 * KPRA (KP), BRA (Balochistan), or NONE. The authority is selected at RUNTIME from config; switching it
 * is a config write, no deploy. Every provider implements the same interface so the registry can pick
 * one by authority key.
 */
export type FiscalAuthority = 'NONE' | 'PRA' | 'FBR' | 'SRB' | 'KPRA' | 'BRA';
export type FiscalEnv = 'sandbox' | 'production';

/** Runtime config for a report call, resolved from restaurant_fiscal_config (secrets included). */
export interface FiscalRuntimeConfig {
  authority: FiscalAuthority;
  environment: FiscalEnv;
  registrationNo: string | null;
  ntn: string | null;
  strn: string | null;
  posId: string | null;
  apiBaseUrl: string | null;
  apiToken: string | null;
  providerConfig: Record<string, unknown>;
}

/** The minimal invoice facts an authority needs (built from the bill_settled event). */
export interface FiscalInvoice {
  orderNo: string;
  occurredOn: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  channel: string;
}

export interface FiscalReportResult {
  authority: FiscalAuthority;
  environment: FiscalEnv;
  /** The authority's invoice number (or a sandbox-synthesised one). */
  invoiceNumber: string;
  /** QR string to print on the receipt / show on the customer page. */
  qr: string;
  /** Raw provider response (or the sandbox acknowledgement), stored for audit. */
  raw: unknown;
  /** True when no reporting happened (authority NONE / disabled). */
  skipped?: boolean;
}

export interface FiscalProvider {
  readonly authority: FiscalAuthority;
  report(config: FiscalRuntimeConfig, invoice: FiscalInvoice): Promise<FiscalReportResult>;
}
