import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerAuthService } from '../ecommerce/customer-auth.service';
import { StorefrontService } from '../ecommerce/storefront.service';
import { CancelSubscriptionDto } from './dto/subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Customer subscription portal — a signed-in storefront customer views and manages their subscriptions
 * from `/shop/:slug/account/subscriptions`. Reuses the storefront's slug→tenant resolution and the
 * customer session token (no staff auth). Marked `@Public()`; the customer token is verified per request
 * and a subscription is only returned/cancelled when its email matches the signed-in customer.
 */
@Public()
@Controller('shop/:slug/subscriptions')
export class SubscriptionsPortalController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly customers: CustomerAuthService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Get()
  async list(@Param('slug') slug: string, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.subs.portalList(customer);
  }

  @Get(':subscriptionNo')
  async get(@Param('slug') slug: string, @Param('subscriptionNo') subscriptionNo: string, @Headers('authorization') auth?: string) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    return this.subs.portalGet(customer, subscriptionNo);
  }

  @Post(':subscriptionNo/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('slug') slug: string,
    @Param('subscriptionNo') subscriptionNo: string,
    @Body() dto: CancelSubscriptionDto,
    @Headers('authorization') auth?: string,
  ) {
    await this.storefront.resolve(slug);
    const customer = await this.customers.profile(auth);
    // Customers cancel at period end by default (keep what they've paid for).
    return this.subs.portalCancel(customer, subscriptionNo, dto.atPeriodEnd !== false);
  }
}
