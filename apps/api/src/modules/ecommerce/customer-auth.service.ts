import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { AppConfig } from '@metaxperts/config';
import { TenantContext } from '../../common/tenant/tenant-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CustomerLoginDto, CustomerRegisterDto } from './dto/ecommerce.dto';
import { mapOrder } from './ecommerce.util';

type Row = Record<string, unknown>;

interface CustomerClaims {
  sub: string;
  tenantId: string;
  email: string;
  name: string;
  typ: 'customer';
}

/**
 * Storefront customer authentication — separate from staff (ERP `users` + RBAC). A shopper registers /
 * logs in against the per-tenant `ec_customer` table and receives a JWT marked `typ: 'customer'`, bound
 * to the tenant it was issued for. Verification rejects any token whose `typ` isn't `customer` or whose
 * tenant doesn't match the store being viewed, so a customer token can never act as a staff token (or
 * cross tenants). Order history is matched by the customer's email.
 */
@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async register(dto: CustomerRegisterDto) {
    const passwordHash = await argon2.hash(dto.password);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO ec_customer (tenant_id, email, password_hash, name, phone)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4) RETURNING id, email, name`,
        [dto.email.toLowerCase(), passwordHash, dto.name, dto.phone ?? null],
      ).catch((e: unknown) => {
        if ((e as { code?: string })?.code === '23505') throw new ConflictException('An account with this email already exists');
        throw e;
      })) as Array<{ id: string; email: string; name: string }>;
      return this.issue(rows[0]!);
    });
  }

  async login(dto: CustomerLoginDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, email, name, password_hash FROM ec_customer WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [dto.email],
      )) as Array<{ id: string; email: string; name: string; password_hash: string }>;
      const c = rows[0];
      if (!c || !(await argon2.verify(c.password_hash, dto.password).catch(() => false))) {
        throw new UnauthorizedException('Invalid email or password');
      }
      return this.issue(c);
    });
  }

  /** The current customer's profile from their token. */
  async profile(token: string | undefined) {
    const claims = this.verify(token);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, email, name, phone FROM ec_customer WHERE id = $1 AND deleted_at IS NULL`,
        [claims.sub],
      )) as Row[];
      if (!rows[0]) throw new UnauthorizedException('Account not found');
      const r = rows[0];
      return { id: r.id as string, email: r.email as string, name: r.name as string, phone: (r.phone as string) ?? null };
    });
  }

  /** The customer's orders (matched by their email — includes guest orders placed with the same email). */
  async myOrders(token: string | undefined) {
    const claims = this.verify(token);
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT * FROM ec_order WHERE lower(customer_email) = lower($1) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
        [claims.email],
      )) as Row[];
      return rows.map(mapOrder);
    });
  }

  private issue(c: { id: string; email: string; name: string }) {
    const tenantId = TenantContext.require();
    const token = this.jwt.sign(
      { sub: c.id, tenantId, email: c.email, name: c.name, typ: 'customer' },
      { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }), expiresIn: '30d' },
    );
    return { token, customer: { id: c.id, email: c.email, name: c.name } };
  }

  /** Verify a bearer token is a customer token for the store currently being viewed. */
  private verify(token: string | undefined): CustomerClaims {
    if (!token) throw new UnauthorizedException('Sign in required');
    const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
    let claims: CustomerClaims;
    try {
      claims = this.jwt.verify<CustomerClaims>(raw, { secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }) });
    } catch {
      throw new UnauthorizedException('Session expired — please sign in again');
    }
    if (claims.typ !== 'customer' || claims.tenantId !== TenantContext.require()) {
      throw new UnauthorizedException('Invalid session');
    }
    return claims;
  }
}
