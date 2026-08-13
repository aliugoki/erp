import { Injectable, Logger, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { AppConfig } from '@metaxperts/config';
import { RequestContext } from '../../common/request-context/request-context';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { TenantsService } from '../tenants/tenants.service';
import type { RequestOtpDto, VerifyOtpDto } from './dto/restaurant.dto';
import { type Row, normalisePhone } from './restaurant.util';

type Mgr = EntityManager;
const TENANT = `current_setting('app.tenant_id')::uuid`;

/** How long a code lives. Long enough to fetch a phone from another room, short enough to be useless later. */
const OTP_TTL_SECONDS = 300;
/** Wrong guesses allowed against one code before it is dead. Six digits is 1-in-a-million per guess. */
const MAX_ATTEMPTS = 5;
/** Codes a phone may request in the window below — stops an SMS bill being run up on someone. */
const MAX_REQUESTS_PER_WINDOW = 5;
const REQUEST_WINDOW_SECONDS = 3600;

/** What a verified customer carries. Deliberately not a staff `users` row — see the service comment. */
export interface CustomerPrincipal {
  customerId: string;
  tenantId: string;
  phone: string;
}

/**
 * How a code reaches a phone. The one seam that has to exist before an SMS vendor is chosen.
 *
 * Nothing on this server can send an SMS today — notifications are in-app and email only — and
 * picking a vendor is a commercial decision with a bill attached, not an engineering one. So the flow
 * is built whole against this interface and shipped with the development sender below; adding
 * Twilio/Jazz/Telenor later is a new class and a config switch, and no calling code changes.
 */
export interface SmsSender {
  readonly name: string;
  send(phone: string, message: string): Promise<void>;
  /** True when the code may be handed back in the API response (development only). */
  readonly echoesCode: boolean;
}

/**
 * Logs the code instead of sending it, and returns it in the response.
 *
 * This is a development sender and says so loudly at boot, because a silent one would be a login
 * bypass: anyone who can call the endpoint gets the code back. It is gated on `NODE_ENV` at the point
 * of use, not on trust.
 */
export class DevSmsSender implements SmsSender {
  readonly name = 'dev';
  readonly echoesCode = true;
  private readonly logger = new Logger('DevSmsSender');
  async send(phone: string, message: string): Promise<void> {
    this.logger.warn(`[DEV SMS] → ${phone}: ${message}`);
  }
}

/**
 * Customer sign-in by phone and one-time code.
 *
 * **Customers are not `users` rows.** A `users` row is a staff member: it carries roles, feeds RBAC,
 * appears in the admin directory, and is subject to lockout and 2FA policy. Putting ten thousand
 * consumers in there would mean every customer shows up in the tenant's staff list, and one
 * mis-assigned role hands a stranger the restaurant console. Customers therefore have their own
 * table and their own token type (`typ: 'customer'`), which the staff guard rejects and the customer
 * guard requires — so a customer token is inert against every existing endpoint in the ERP, and a
 * staff token is inert against the customer surface.
 *
 * The code is stored hashed and compared in constant time. Both matter more than they look: a
 * six-digit secret is small enough that a timing signal is a real shortcut, and an OTP table in a
 * dump would otherwise be a set of live credentials for whoever holds it.
 */
@Injectable()
export class RestaurantCustomerAuthService {
  private readonly logger = new Logger(RestaurantCustomerAuthService.name);
  private readonly sms: SmsSender;

  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tenants: TenantsService,
  ) {
    this.sms = new DevSmsSender();
    if (this.sms.echoesCode) {
      this.logger.warn(
        `Customer OTP delivery is using the '${this.sms.name}' sender: codes are logged, not sent. ` +
          'Configure a real SMS sender before taking customer sign-ups in production.',
      );
    }
  }

  /**
   * The signing key for customer tokens: derived from the staff secret, never equal to it.
   *
   * Defence in depth behind the explicit `typ` check in the staff guard. A customer token signed with
   * this key cannot even be *verified* by `JwtAuthGuard`, so a future refactor that loses the type
   * check does not silently re-open a customer's token as a staff principal. Derived rather than
   * configured so there is no new secret to distribute, rotate, or forget — rotating
   * `JWT_ACCESS_SECRET` rotates this with it.
   */
  private get customerSecret(): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update('restaurant-customer-token-v1')
      .digest('hex');
  }

  /**
   * Resolve which restaurant this sign-in is for, and seed the tenant context so RLS applies.
   *
   * These are the only two customer routes reached without a token, so the tenant cannot come from
   * one — it comes from the slug the app was configured with, exactly as the public storefront does
   * it. An unknown slug is a flat 404 that leaks nothing about which tenants exist.
   */
  private async resolveTenant(slug: string): Promise<string> {
    const tenant = await this.tenants.findBySlug(slug.trim().toLowerCase());
    if (!tenant) throw new NotFoundException('Restaurant not found');
    RequestContext.set({ tenantId: tenant.id });
    return tenant.id;
  }

  /** True only outside production — where echoing the code back is a convenience, not a hole. */
  private get mayEchoCode(): boolean {
    return this.sms.echoesCode && this.config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  async requestOtp(dto: RequestOtpDto, ip?: string) {
    const phone = normalisePhone(dto.phone);
    if (!phone) throw new UnprocessableEntityException('That does not look like a phone number');
    const tenantId = await this.resolveTenant(dto.restaurant);

    return this.tenantTx.runFor(tenantId, async (m) => {
      const recent = (await m.query(
        `SELECT count(*)::int AS n FROM restaurant_customer_otp
          WHERE phone=$1 AND created_at > now() - ($2 || ' seconds')::interval`,
        [phone, String(REQUEST_WINDOW_SECONDS)],
      )) as Array<{ n: number }>;
      if (recent[0]!.n >= MAX_REQUESTS_PER_WINDOW) {
        throw new UnprocessableEntityException('Too many codes requested for that number. Try again later.');
      }

      const code = String(randomInt(100000, 1000000));
      await m.query(
        `INSERT INTO restaurant_customer_otp (tenant_id, phone, code_hash, expires_at, requested_ip)
         VALUES (${TENANT}, $1, $2, now() + ($3 || ' seconds')::interval, $4)`,
        [phone, hash(code), String(OTP_TTL_SECONDS), ip ?? null],
      );
      await this.sms.send(phone, `Your verification code is ${code}. It expires in 5 minutes.`);

      return {
        phone,
        expiresInSeconds: OTP_TTL_SECONDS,
        // Present only outside production, and named so nobody mistakes it for a normal field.
        ...(this.mayEchoCode ? { devOtp: code } : {}),
      };
    });
  }

  /**
   * Verify a code and return a customer token, creating the customer on first sign-in.
   *
   * A phone that has never ordered is not an error: in a restaurant the first contact IS the sign-up,
   * and making someone register before they can order loses the order.
   */
  async verifyOtp(dto: VerifyOtpDto) {
    const phone = normalisePhone(dto.phone);
    if (!phone) throw new UnprocessableEntityException('That does not look like a phone number');
    const tenantId = await this.resolveTenant(dto.restaurant);

    return this.tenantTx.runFor(tenantId, async (m) => {
      const rows = (await m.query(
        `SELECT id, code_hash, attempts, expires_at, consumed_at FROM restaurant_customer_otp
          WHERE phone=$1 ORDER BY created_at DESC LIMIT 1`,
        [phone],
      )) as Row[];
      const otp = rows[0];
      if (!otp) throw new UnauthorizedException('Request a code first');
      if (otp.consumed_at) throw new UnauthorizedException('That code has already been used');
      if (new Date(otp.expires_at as string).getTime() < Date.now()) throw new UnauthorizedException('That code has expired');
      if (Number(otp.attempts) >= MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong attempts — request a new code');

      if (!matches(dto.otp, otp.code_hash as string)) {
        await m.query(`UPDATE restaurant_customer_otp SET attempts = attempts + 1, updated_at=now() WHERE id=$1`, [otp.id]);
        throw new UnauthorizedException('That code is not right');
      }
      await m.query(`UPDATE restaurant_customer_otp SET consumed_at=now(), updated_at=now() WHERE id=$1`, [otp.id]);

      const existing = (await m.query(
        `SELECT id, name, blocked FROM restaurant_customer WHERE phone=$1 AND deleted_at IS NULL`,
        [phone],
      )) as Row[];
      let customerId: string;
      let isNew = false;
      if (existing[0]) {
        customerId = existing[0].id as string;
        await m.query(`UPDATE restaurant_customer SET last_login_at=now(), updated_at=now() WHERE id=$1`, [customerId]);
      } else {
        const created = (await m.query(
          `INSERT INTO restaurant_customer (tenant_id, phone, name, last_login_at)
           VALUES (${TENANT}, $1, $2, now()) RETURNING id`,
          [phone, dto.name?.trim() || null],
        )) as Row[];
        customerId = created[0]!.id as string;
        isNew = true;
      }

      const token = await this.issueToken({ customerId, tenantId, phone });
      const profile = (await m.query(
        `SELECT id, phone, name, email, blocked FROM restaurant_customer WHERE id=$1`,
        [customerId],
      )) as Row[];
      return {
        accessToken: token,
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
        isNewCustomer: isNew,
        customer: {
          id: profile[0]!.id, phone: profile[0]!.phone, name: profile[0]!.name ?? null,
          email: profile[0]!.email ?? null, blocked: Boolean(profile[0]!.blocked),
        },
      };
    });
  }

  private issueToken(principal: CustomerPrincipal): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'customer', sub: principal.customerId, customerId: principal.customerId, tenantId: principal.tenantId, phone: principal.phone },
      {
        secret: this.customerSecret,
        // Customer sessions are long by design: a hungry person re-authenticating mid-checkout
        // abandons the order. The token grants nothing but that customer's own records.
        expiresIn: '30d',
      },
    );
  }

  /** Verify a customer token. Throws for anything that is not one — including a valid staff token. */
  verifyToken(token: string): CustomerPrincipal {
    let payload: { typ?: string; customerId?: string; tenantId?: string; phone?: string };
    try {
      payload = this.jwt.verify(token, { secret: this.customerSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'customer' || !payload.customerId || !payload.tenantId) {
      throw new UnauthorizedException('Not a customer token');
    }
    return { customerId: payload.customerId, tenantId: payload.tenantId, phone: payload.phone ?? '' };
  }

  /** Refuse a blocked customer at the door of anything that writes. */
  async assertNotBlocked(m: Mgr, customerId: string) {
    const rows = (await m.query(`SELECT blocked, blocked_reason FROM restaurant_customer WHERE id=$1 AND deleted_at IS NULL`, [customerId])) as Row[];
    if (!rows[0]) throw new UnauthorizedException('Customer not found');
    if (rows[0].blocked) {
      throw new UnprocessableEntityException(
        (rows[0].blocked_reason as string) || 'This account cannot place orders. Please call the restaurant.',
      );
    }
  }
}

const hash = (code: string): string => createHash('sha256').update(code).digest('hex');

/** Constant-time compare — a six-digit secret is small enough for a timing signal to matter. */
function matches(candidate: string, storedHash: string): boolean {
  const a = Buffer.from(hash(candidate.trim()), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
