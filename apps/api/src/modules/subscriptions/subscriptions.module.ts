import { Module } from '@nestjs/common';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsPortalController } from './subscriptions-portal.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsGlConsumer } from './subscriptions-gl.consumer';
import { SubscriptionsEmailConsumer } from './subscriptions-email.consumer';
import { SubscriptionsBillingScheduler } from './subscriptions-billing.scheduler';

/**
 * Subscriptions & recurring billing. The admin console manages plans, subscriptions and invoices; the
 * billing scheduler runs the cycle across tenants (invoice + collect + dun). Paid invoices post to the
 * GL via FinanceService (SubscriptionsGlConsumer); customer emails go through the notifications queue.
 * The customer portal reuses the ecommerce storefront's slug resolution + customer auth (EcommerceModule).
 */
@Module({
  imports: [EcommerceModule, FinanceModule, NotificationsModule],
  controllers: [SubscriptionsController, SubscriptionsPortalController],
  providers: [SubscriptionsService, SubscriptionsGlConsumer, SubscriptionsEmailConsumer, SubscriptionsBillingScheduler],
})
export class SubscriptionsModule {}
