import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../../common/tenant/tenant-transaction.service';
import type { SetFiscalConfigDto } from '../dto/restaurant.dto';
import type { Row } from '../restaurant.util';
import type { FiscalRuntimeConfig } from './fiscal-provider.interface';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
const TENANT = `current_setting('app.tenant_id')::uuid`;

/**
 * Per-branch fiscal configuration (restaurant_fiscal_config). Selects WHICH tax authority a branch
 * reports to at runtime (the "dynamic" requirement) plus its credentials. The API token is a secret:
 * it is written but never returned — reads expose only `hasToken`.
 */
@Injectable()
export class RestaurantFiscalConfigService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  async get(branchId?: string) {
    return this.tenantTx.run(async (m) => {
      const c = await this.configInTx(m, branchId ?? null);
      return {
        branchId: branchId ?? null,
        authority: c.authority,
        environment: c.environment,
        enabled: c.providerConfig.__enabled === true,
        registrationNo: c.registrationNo,
        ntn: c.ntn,
        strn: c.strn,
        posId: c.posId,
        apiBaseUrl: c.apiBaseUrl,
        hasToken: !!c.apiToken,
      };
    });
  }

  /** Full runtime config (secrets included) for the reporting path. */
  async configInTx(m: Mgr, branchId: string | null): Promise<FiscalRuntimeConfig & { enabled: boolean }> {
    const rows = (await m.query(
      `SELECT authority, environment, enabled, registration_no, ntn, strn, pos_id, api_base_url, api_token, provider_config
       FROM restaurant_fiscal_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
      [branchId],
    )) as Row[];
    const r = rows[0];
    const providerConfig = (r?.provider_config as Record<string, unknown>) ?? {};
    return {
      authority: (r?.authority as FiscalRuntimeConfig['authority']) ?? 'NONE',
      environment: (r?.environment as FiscalRuntimeConfig['environment']) ?? 'sandbox',
      enabled: r ? Boolean(r.enabled) : false,
      registrationNo: (r?.registration_no as string) ?? null,
      ntn: (r?.ntn as string) ?? null,
      strn: (r?.strn as string) ?? null,
      posId: (r?.pos_id as string) ?? null,
      apiBaseUrl: (r?.api_base_url as string) ?? null,
      apiToken: (r?.api_token as string) ?? null,
      providerConfig: { ...providerConfig, __enabled: r ? Boolean(r.enabled) : false },
    };
  }

  async set(dto: SetFiscalConfigDto) {
    return this.tenantTx.run(async (m) => {
      const branchId = dto.branchId ?? null;
      const exists = (await m.query(
        `SELECT id FROM restaurant_fiscal_config WHERE deleted_at IS NULL AND branch_id IS NOT DISTINCT FROM $1 LIMIT 1`,
        [branchId],
      )) as Row[];
      if (exists[0]) {
        const sets: string[] = [];
        const params: unknown[] = [];
        const set = (col: string, val: unknown) => {
          if (val !== undefined) sets.push(`${col}=$${params.push(val)}`);
        };
        set('authority', dto.authority);
        set('environment', dto.environment);
        set('enabled', dto.enabled);
        set('registration_no', dto.registrationNo);
        set('ntn', dto.ntn);
        set('strn', dto.strn);
        set('pos_id', dto.posId);
        set('api_base_url', dto.apiBaseUrl);
        set('api_token', dto.apiToken);
        if (sets.length) {
          await m.query(`UPDATE restaurant_fiscal_config SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.push(exists[0].id)}`, params);
        }
      } else {
        await m.query(
          `INSERT INTO restaurant_fiscal_config
             (tenant_id, branch_id, authority, environment, enabled, registration_no, ntn, strn, pos_id, api_base_url, api_token)
           VALUES (${TENANT}, $1, COALESCE($2,'NONE'), COALESCE($3,'sandbox'), COALESCE($4,false), $5,$6,$7,$8,$9,$10)`,
          [
            branchId, dto.authority ?? null, dto.environment ?? null, dto.enabled ?? null, dto.registrationNo ?? null,
            dto.ntn ?? null, dto.strn ?? null, dto.posId ?? null, dto.apiBaseUrl ?? null, dto.apiToken ?? null,
          ],
        );
      }
      return this.get(dto.branchId);
    });
  }
}
