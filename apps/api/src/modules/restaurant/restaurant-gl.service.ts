import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { Row } from './restaurant.util';
import type { RestaurantGlAccounts } from './restaurant-gl.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
const TENANT = `current_setting('app.tenant_id')::uuid`;

const COLUMNS: Array<[keyof RestaurantGlAccounts, string]> = [
  ['revenueAccountId', 'revenue_account_id'],
  ['taxAccountId', 'tax_account_id'],
  ['cogsAccountId', 'cogs_account_id'],
  ['inventoryAccountId', 'inventory_account_id'],
  ['cashAccountId', 'cash_account_id'],
  ['bankAccountId', 'bank_account_id'],
  ['cardClearingAccountId', 'card_clearing_account_id'],
  ['walletClearingAccountId', 'wallet_clearing_account_id'],
  ['giftCardLiabilityAccountId', 'gift_card_liability_account_id'],
  ['discountAccountId', 'discount_account_id'],
  ['serviceChargeAccountId', 'service_charge_account_id'],
  ['tipsPayableAccountId', 'tips_payable_account_id'],
  ['roundingAccountId', 'rounding_account_id'],
  ['receivableAccountId', 'receivable_account_id'],
];

/** The restaurant GL account map (restaurant_gl_config, one row per tenant). Read in-tx by the GL consumer. */
@Injectable()
export class RestaurantGlService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async get() {
    return this.tenantTx.run((m) => this.glConfigInTx(m));
  }

  async glConfigInTx(m: Mgr): Promise<RestaurantGlAccounts> {
    const cols = COLUMNS.map(([, c]) => c).join(', ');
    const rows = (await m.query(`SELECT ${cols} FROM restaurant_gl_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
    const r = rows[0];
    const out = {} as RestaurantGlAccounts;
    for (const [key, col] of COLUMNS) out[key] = (r?.[col] as string) ?? null;
    return out;
  }

  async set(dto: Partial<Record<keyof RestaurantGlAccounts, string | undefined>>) {
    return this.tenantTx.run(async (m) => {
      const exists = (await m.query(`SELECT id FROM restaurant_gl_config WHERE deleted_at IS NULL LIMIT 1`)) as Row[];
      if (exists[0]) {
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const [key, col] of COLUMNS) {
          const val = dto[key];
          if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
        }
        if (sets.length) {
          await m.query(`UPDATE restaurant_gl_config SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(exists[0].id)}`, params);
        }
      } else {
        const cols = COLUMNS.map(([, c]) => c);
        const params = COLUMNS.map(([key]) => dto[key] ?? null);
        await m.query(
          `INSERT INTO restaurant_gl_config (tenant_id, ${cols.join(', ')})
           VALUES (${TENANT}, ${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          params,
        );
      }
      return this.glConfigInTx(m);
    });
  }
}
