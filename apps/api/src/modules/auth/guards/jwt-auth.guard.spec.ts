import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RequestContext } from '../../../common/request-context/request-context';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-access-secret-at-least-16-chars';
const jwt = new JwtService({});
const config = { get: () => SECRET } as never;

/**
 * Minimal ExecutionContext carrying one Authorization header.
 *
 * `getHandler`/`getClass` must return real reflection targets — Reflector reads metadata off them and
 * throws on undefined, which is a failure of the double rather than of the guard.
 */
function handler() {}
class Ctrl {}
function contextWith(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => Ctrl,
  } as never;
}

const guard = () => new JwtAuthGuard(new Reflector(), jwt, config);

/**
 * Regression cover for a hole found by probing the live server, not by a test.
 *
 * A restaurant customer token carries a tenant and no roles. The staff guard verified it with the
 * shared secret, saw the tenant, and admitted the customer as a staff principal with an empty role
 * set — which satisfies every route that requires authentication but no specific permission. In
 * practice that exposed the branch's orders and the tenant's HR directory to any member of the public
 * who signed in on the customer app.
 *
 * Two independent defences now stand between a customer token and a staff route, and each is asserted
 * separately: either alone is sufficient, so a future change that removes one does not re-open the
 * hole silently.
 */
describe('JwtAuthGuard — non-staff principals', () => {
  it('admits an ordinary staff token', () => {
    const token = jwt.sign({ sub: 'user-1', tenantId: 'tenant-1', roles: ['VIEWER'] }, { secret: SECRET });
    expect(RequestContext.run({ requestId: 'r' }, () => guard().canActivate(contextWith(token)))).toBe(true);
  });

  it('rejects a customer-typed token even when signed with the staff secret', () => {
    // Defence 1, in isolation: same secret, so the signature verifies — only `typ` stops it.
    const token = jwt.sign({ sub: 'cust-1', tenantId: 'tenant-1', typ: 'customer', customerId: 'cust-1' }, { secret: SECRET });
    expect(() => RequestContext.run({ requestId: 'r' }, () => guard().canActivate(contextWith(token)))).toThrow(UnauthorizedException);
  });

  it('rejects a customer token signed with the derived customer secret', () => {
    // Defence 2, in isolation: the guard cannot even verify this signature.
    const customerSecret = createHmac('sha256', SECRET).update('restaurant-customer-token-v1').digest('hex');
    const token = jwt.sign({ sub: 'cust-1', tenantId: 'tenant-1', typ: 'customer' }, { secret: customerSecret });
    expect(() => RequestContext.run({ requestId: 'r' }, () => guard().canActivate(contextWith(token)))).toThrow(UnauthorizedException);
  });

  it('rejects any future principal kind that is not staff', () => {
    // The check is an allowlist, so a kind invented later is refused by default rather than admitted.
    const token = jwt.sign({ sub: 'x', tenantId: 'tenant-1', typ: 'kiosk' }, { secret: SECRET });
    expect(() => RequestContext.run({ requestId: 'r' }, () => guard().canActivate(contextWith(token)))).toThrow(UnauthorizedException);
  });

  it('still rejects a token bound to no tenant', () => {
    const token = jwt.sign({ sub: 'user-1' }, { secret: SECRET });
    expect(() => RequestContext.run({ requestId: 'r' }, () => guard().canActivate(contextWith(token)))).toThrow(UnauthorizedException);
  });
});
