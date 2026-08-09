import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { RestaurantBillSettledV1 } from '@metaxperts/shared';
import type { Row } from '../restaurant.util';
import { RestaurantFiscalConfigService } from './fiscal-config.service';
import { FiscalRegistry } from './fiscal.registry';
import type { FiscalReportResult } from './fiscal-provider.interface';

/**
 * Fiscalization orchestrator. For a settled bill it loads the branch's fiscal config, picks the
 * configured authority's provider from the registry (the dynamic selection point), reports the invoice,
 * and stamps the authority + returned invoice number + QR back on the order so receipts and the customer
 * page can render them. Idempotent: an order already stamped with a fiscal invoice number is skipped.
 */
@Injectable()
export class RestaurantFiscalService {
  private readonly logger = new Logger(RestaurantFiscalService.name);

  constructor(
    private readonly configService: RestaurantFiscalConfigService,
    private readonly registry: FiscalRegistry,
  ) {}

  async reportSettledBill(m: EntityManager, bill: RestaurantBillSettledV1): Promise<FiscalReportResult | null> {
    const config = await this.configService.configInTx(m, bill.branchId);
    if (!config.enabled || config.authority === 'NONE') return null;

    const existing = (await m.query(
      `SELECT fiscal_invoice_no, COALESCE(settled_at, now())::date::text AS d FROM restaurant_order WHERE id=$1`,
      [bill.orderId],
    )) as Row[];
    if (!existing[0]) return null;
    if (existing[0].fiscal_invoice_no) return null; // already reported — don't double-report

    const provider = this.registry.get(config.authority);
    const result = await provider.report(config, {
      orderNo: bill.orderNo,
      occurredOn: (existing[0].d as string) ?? new Date().toISOString().slice(0, 10),
      currency: bill.currency,
      subtotalMinor: bill.subtotalMinor,
      discountMinor: bill.discountMinor,
      taxMinor: bill.taxMinor,
      totalMinor: bill.totalMinor,
      channel: bill.channel,
    });
    if (result.skipped) return null;

    await m.query(
      `UPDATE restaurant_order SET fiscal_authority=$2, fiscal_invoice_no=$3, fiscal_qr=$4, fiscal_status='REPORTED', updated_at=now() WHERE id=$1`,
      [bill.orderId, result.authority, result.invoiceNumber, result.qr],
    );
    this.logger.log(`${config.authority} fiscal invoice ${result.invoiceNumber} for ${bill.orderNo} (${config.environment})`);
    return result;
  }
}
