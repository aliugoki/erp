import { Injectable } from '@nestjs/common';
import type { FiscalAuthority, FiscalEnv, FiscalProvider } from './fiscal-provider.interface';
import { HttpFiscalClient, NullFiscalClient } from './providers/http-fiscal.client';

/**
 * Default authority endpoints (sandbox + production). These are overridable per tenant via
 * `restaurant_fiscal_config.api_base_url`, so a tenant can point at the exact gateway URL their
 * authority issues without a code change. FBR's are the real Digital-Invoicing endpoints (also used by
 * the ERP tax module); the provincial-services authorities default to their e-invoicing gateways and
 * are meant to be overridden with the tenant's issued endpoint.
 */
const ENDPOINTS: Record<Exclude<FiscalAuthority, 'NONE'>, Record<FiscalEnv, string>> = {
  PRA: {
    sandbox: 'https://ebs.pra.punjab.gov.pk/api/sandbox/invoice',
    production: 'https://ebs.pra.punjab.gov.pk/api/invoice',
  },
  FBR: {
    sandbox: 'https://gw.fbr.gov.pk/DI_data/v1/di/postinvoicedata_sb',
    production: 'https://gw.fbr.gov.pk/DI_data/v1/di/postinvoicedata',
  },
  SRB: {
    sandbox: 'https://e.srb.gos.pk/api/sandbox/invoice',
    production: 'https://e.srb.gos.pk/api/invoice',
  },
  KPRA: {
    sandbox: 'https://kpra.kp.gov.pk/api/sandbox/invoice',
    production: 'https://kpra.kp.gov.pk/api/invoice',
  },
  BRA: {
    sandbox: 'https://bra.gob.pk/api/sandbox/invoice',
    production: 'https://bra.gob.pk/api/invoice',
  },
};

/** Resolves a {@link FiscalProvider} by authority key (the dynamic selection point). */
@Injectable()
export class FiscalRegistry {
  private readonly providers: Map<FiscalAuthority, FiscalProvider>;

  constructor() {
    this.providers = new Map<FiscalAuthority, FiscalProvider>([['NONE', new NullFiscalClient()]]);
    for (const [authority, endpoints] of Object.entries(ENDPOINTS) as Array<[Exclude<FiscalAuthority, 'NONE'>, Record<FiscalEnv, string>]>) {
      this.providers.set(authority, new HttpFiscalClient(authority, endpoints));
    }
  }

  get(authority: FiscalAuthority): FiscalProvider {
    return this.providers.get(authority) ?? this.providers.get('NONE')!;
  }
}
