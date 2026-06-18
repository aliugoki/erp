import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantsModule } from '../tenants/tenants.module';
import { EcommerceEmailConsumer } from './ecommerce-email.consumer';
import { EcommerceGlConsumer } from './ecommerce-gl.consumer';
import { EcommerceController } from './ecommerce.controller';
import { EcommerceService } from './ecommerce.service';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

/**
 * Online store. Reuses the inventory valued ledger (InventoryDocsService) to decrement stock + capture
 * COGS on each order, links shoppers to CRM, and (via EcommerceGlConsumer) posts placed orders to the
 * general ledger through FinanceService. The public storefront resolves the tenant by slug
 * (TenantsService) before reading through RLS.
 */
@Module({
  imports: [InventoryModule, FinanceModule, TenantsModule, NotificationsModule],
  controllers: [EcommerceController, StorefrontController],
  providers: [EcommerceService, StorefrontService, EcommerceGlConsumer, EcommerceEmailConsumer],
})
export class EcommerceModule {}
