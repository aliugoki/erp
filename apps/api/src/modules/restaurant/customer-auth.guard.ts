import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { RequestContext } from '../../common/request-context/request-context';
import { RestaurantCustomerAuthService, type CustomerPrincipal } from './customer-auth.service';

/**
 * Authenticates a customer's app token and puts the tenant on the request so RLS applies.
 *
 * Customer routes are marked `@Public()`, which only means "the staff JWT guard does not apply" —
 * they are not open. This guard runs in its place and is stricter in the way that matters: it
 * requires `typ: 'customer'`, so a perfectly valid *staff* token is rejected here just as a customer
 * token is rejected everywhere else. The two principal types cannot be used interchangeably in either
 * direction, which is the property that lets a customer app be shipped to the public at all.
 *
 * Setting the tenant on RequestContext is not incidental: without it the transaction GUC is unset and
 * every RLS-protected query returns zero rows. The customer id is deliberately NOT written to
 * `userId` — that field means "a staff user" to the logger and the audit trail, and a customer is
 * not one.
 */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly auth: RestaurantCustomerAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { customer?: CustomerPrincipal }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    const principal = this.auth.verifyToken(header.slice(7).trim());
    request.customer = principal;
    RequestContext.set({ tenantId: principal.tenantId });
    return true;
  }
}

/** The signed-in customer, for routes behind {@link CustomerAuthGuard}. */
export const CurrentCustomer = createParamDecorator((_data: unknown, context: ExecutionContext): CustomerPrincipal => {
  const request = context.switchToHttp().getRequest<Request & { customer?: CustomerPrincipal }>();
  if (!request.customer) throw new UnauthorizedException('Not a customer session');
  return request.customer;
});
