import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { type FbrEnv, FbrClient } from './fbr.client';
import type { SaveFbrConfigDto } from './dto/fbr.dto';

type Row = Record<string, unknown>;

export interface FbrConfigView {
  sellerNtn: string;
  sellerName: string;
  posId: string;
  environment: FbrEnv;
  enabled: boolean;
  hasToken: boolean;
}

const DEFAULT_CONFIG: FbrConfigView = { sellerNtn: '', sellerName: '', posId: '', environment: 'sandbox', enabled: false, hasToken: false };

/**
 * FBR digital-invoicing service: per-tenant config + the invoice report ledger. Reporting builds the
 * FBR payload from a POS sale, sends it via {@link FbrClient} (sandbox by default), and records the
 * returned FBR invoice number + QR. Reporting is idempotent per sale (a sale already REPORTED returns
 * its existing record). All tenant-scoped (RLS).
 */
@Injectable()
export class FbrService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly fbr: FbrClient,
  ) {}

  async getConfig(): Promise<FbrConfigView> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT seller_ntn, seller_name, pos_id, environment, enabled, api_token FROM fbr_config LIMIT 1`)) as Row[];
      const r = rows[0];
      if (!r) return DEFAULT_CONFIG;
      const credSet = !!r.api_token;
      return {
        sellerNtn: (r.seller_ntn as string) ?? '',
        sellerName: (r.seller_name as string) ?? '',
        posId: (r.pos_id as string) ?? '',
        environment: (r.environment as FbrEnv) ?? 'sandbox',
        enabled: !!r.enabled,
        hasToken: credSet,
      };
    });
  }

  async saveConfig(dto: SaveFbrConfigDto): Promise<FbrConfigView> {
    const cred = dto.apiToken || null;
    await this.tenantTx.run(async (m) => {
      // Upsert one row per tenant; keep the stored credential when a new one isn't supplied ($6 null).
      await m.query(
        `INSERT INTO fbr_config (tenant_id, seller_ntn, seller_name, pos_id, environment, enabled, api_token)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET
           seller_ntn = EXCLUDED.seller_ntn, seller_name = EXCLUDED.seller_name, pos_id = EXCLUDED.pos_id,
           environment = EXCLUDED.environment, enabled = EXCLUDED.enabled,
           api_token = CASE WHEN $6 IS NOT NULL THEN $6 ELSE fbr_config.api_token END, updated_at = now()`,
        [dto.sellerNtn, dto.sellerName, dto.posId, dto.environment, dto.enabled ?? false, cred],
      );
    });
    return this.getConfig();
  }

  async listInvoices(): Promise<Row[]> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, source_type, source_id, invoice_ref, fbr_invoice_number, qr, status, environment, amount_minor, error, reported_at, created_at
         FROM fbr_invoice WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      )) as Row[];
      return rows.map(mapInvoice);
    });
  }

  /** Render + report a POS sale to FBR. Idempotent: a sale already reported returns its record. */
  async reportSale(saleId: string): Promise<Row> {
    const cfg = await this.loadRawConfig();
    return this.tenantTx.run(async (m) => {
      const existing = (await m.query(
        `SELECT * FROM fbr_invoice WHERE source_type = 'pos_sale' AND source_id = $1 AND status = 'REPORTED' AND deleted_at IS NULL LIMIT 1`,
        [saleId],
      )) as Row[];
      if (existing[0]) return mapInvoice(existing[0]);

      const saleRows = (await m.query(
        `SELECT sale_no, total_minor, tax_minor, currency, sold_at, customer_name FROM pos_sale WHERE id = $1 AND deleted_at IS NULL`,
        [saleId],
      )) as Row[];
      const sale = saleRows[0];
      if (!sale) throw new NotFoundException('Sale not found');
      const lines = (await m.query(
        `SELECT description, quantity, unit_price_minor, tax_minor, line_total_minor FROM pos_sale_line WHERE sale_id = $1 AND deleted_at IS NULL`,
        [saleId],
      )) as Row[];

      const payload = {
        invoiceType: 'Sale Invoice',
        invoiceRef: sale.sale_no,
        sellerNTNCNIC: cfg.sellerNtn,
        sellerBusinessName: cfg.sellerName,
        posId: cfg.posId,
        buyer: (sale.customer_name as string) || 'Walk-in customer',
        dateTime: sale.sold_at,
        totalAmount: Number(sale.total_minor) / 100,
        salesTax: Number(sale.tax_minor) / 100,
        currency: sale.currency,
        items: lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unit_price_minor) / 100,
          salesTax: Number(l.tax_minor) / 100,
          total: Number(l.line_total_minor) / 100,
        })),
      };

      let status = 'REPORTED';
      let number: string | null = null;
      let qr: string | null = null;
      let environment: string = cfg.environment;
      let response: unknown = null;
      let error: string | null = null;
      try {
        const res = await this.fbr.report(cfg, payload);
        number = res.fbrInvoiceNumber;
        qr = res.qr;
        environment = res.environment;
        response = res.response;
      } catch (err) {
        status = 'FAILED';
        error = (err as Error).message;
      }

      const inserted = (await m.query(
        `INSERT INTO fbr_invoice (tenant_id, source_type, source_id, invoice_ref, fbr_invoice_number, qr, status, environment, amount_minor, payload, response, error, reported_at)
         VALUES (current_setting('app.tenant_id')::uuid, 'pos_sale', $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, CASE WHEN $5 = 'REPORTED' THEN now() ELSE NULL END)
         RETURNING id, source_type, source_id, invoice_ref, fbr_invoice_number, qr, status, environment, amount_minor, error, reported_at, created_at`,
        [saleId, sale.sale_no, number, qr, status, environment, Number(sale.total_minor), JSON.stringify(payload), response ? JSON.stringify(response) : null, error],
      )) as Row[];
      if (status === 'FAILED') throw new BadRequestException(error ?? 'FBR reporting failed');
      return mapInvoice(inserted[0]!);
    });
  }

  private loadRawConfig() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT seller_ntn, seller_name, pos_id, environment, api_token FROM fbr_config LIMIT 1`)) as Row[];
      const r = rows[0];
      const cred = (r?.api_token as string | null) ?? null;
      return {
        sellerNtn: (r?.seller_ntn as string) ?? '',
        sellerName: (r?.seller_name as string) ?? '',
        posId: (r?.pos_id as string) ?? '',
        environment: ((r?.environment as FbrEnv) ?? 'sandbox') as FbrEnv,
        apiToken: cred,
      };
    });
  }
}

function mapInvoice(r: Row) {
  return {
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    invoiceRef: r.invoice_ref,
    fbrInvoiceNumber: r.fbr_invoice_number ?? null,
    qr: r.qr ?? null,
    status: r.status,
    environment: r.environment ?? null,
    amountMinor: Number(r.amount_minor ?? 0),
    error: r.error ?? null,
    reportedAt: r.reported_at ?? null,
    createdAt: r.created_at,
  };
}
