import { Module } from '@nestjs/common';
import { EcommerceModule } from '../ecommerce/ecommerce.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskPortalController } from './helpdesk-portal.controller';
import { HelpdeskService } from './helpdesk.service';
import { HelpdeskEmailConsumer } from './helpdesk-email.consumer';
import { HelpdeskSlaScheduler } from './helpdesk-sla.scheduler';

/**
 * Help Desk. The agent console manages tickets through the SLA engine; the customer portal reuses the
 * ecommerce storefront's slug resolution + customer auth (EcommerceModule). Customer emails go through
 * the notifications email queue, and a scheduler flags SLA breaches across tenants.
 */
@Module({
  imports: [EcommerceModule, NotificationsModule],
  controllers: [HelpdeskController, HelpdeskPortalController],
  providers: [HelpdeskService, HelpdeskEmailConsumer, HelpdeskSlaScheduler],
})
export class HelpdeskModule {}
