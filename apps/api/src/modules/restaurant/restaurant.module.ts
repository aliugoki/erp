import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TenantsModule } from '../tenants/tenants.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantMenuService } from './menu.service';
import { RestaurantFloorService } from './floor.service';
import { RestaurantOrderService } from './order.service';
import { RestaurantKdsService } from './kds.service';
import { RestaurantRecipeService } from './recipe.service';
import { RestaurantDeliveryService } from './delivery.service';
import { RestaurantDriverService } from './driver.service';
import { RestaurantCustomerService } from './customer.service';
import { RestaurantCustomerAuthService } from './customer-auth.service';
import { CustomerAuthGuard } from './customer-auth.guard';
import { RestaurantDriverController } from './restaurant-driver.controller';
import { RestaurantCustomerController } from './restaurant-customer.controller';
import { RestaurantReservationService } from './reservation.service';
import { RestaurantGlService } from './restaurant-gl.service';
import { RestaurantGlConsumer } from './restaurant-gl.consumer';
import { FiscalRegistry } from './fiscal/fiscal.registry';
import { RestaurantFiscalConfigService } from './fiscal/fiscal-config.service';
import { RestaurantFiscalService } from './fiscal/fiscal.service';
import { RestaurantFiscalConsumer } from './fiscal/restaurant-fiscal.consumer';
import { RestaurantPrinterService } from './printing/printer.service';
import { RestaurantPrintService } from './printing/print.service';
import { RestaurantScanService } from './scan.service';
import { RestaurantCodesService } from './printing/codes.service';

/**
 * Restaurant Management System (ADR-011, feature `restaurant`). Menu + floor (Phase 3.1), order
 * lifecycle + KDS + realtime (Phase 4), recipes (4.2a). Settlement deducts the shared inventory valued
 * ledger for COGS (via InventoryDocsService) and posts each bill to the general ledger (via
 * FinanceService in RestaurantGlConsumer) — reusing the ERP engines, never duplicating them. Dynamic
 * fiscalization (PRA/FBR/…) and delivery arrive in later phases.
 */
@Module({
  // JwtModule: customer sign-in issues its own token type (see customer-auth.service).
  // TenantsModule: customer sign-in resolves which restaurant by slug, before any token exists.
  imports: [InventoryModule, FinanceModule, TenantsModule, JwtModule.register({})],
  controllers: [RestaurantController, RestaurantDriverController, RestaurantCustomerController],
  providers: [
    RestaurantMenuService,
    RestaurantFloorService,
    RestaurantOrderService,
    RestaurantKdsService,
    RestaurantRecipeService,
    RestaurantDeliveryService,
    RestaurantDriverService,
    RestaurantCustomerService,
    RestaurantCustomerAuthService,
    CustomerAuthGuard,
    RestaurantReservationService,
    RestaurantGlService,
    RestaurantGlConsumer,
    FiscalRegistry,
    RestaurantFiscalConfigService,
    RestaurantFiscalService,
    RestaurantFiscalConsumer,
    RestaurantPrinterService,
    RestaurantPrintService,
    RestaurantScanService,
    RestaurantCodesService,
  ],
  exports: [
    RestaurantMenuService,
    RestaurantFloorService,
    RestaurantOrderService,
    RestaurantKdsService,
    RestaurantRecipeService,
    RestaurantDeliveryService,
    RestaurantDriverService,
    RestaurantCustomerService,
    RestaurantReservationService,
    RestaurantGlService,
    RestaurantFiscalConfigService,
    RestaurantFiscalService,
    RestaurantPrinterService,
    RestaurantPrintService,
    RestaurantScanService,
    RestaurantCodesService,
  ],
})
export class RestaurantModule {}
