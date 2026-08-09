import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantMenuService } from './menu.service';
import { RestaurantFloorService } from './floor.service';
import { RestaurantOrderService } from './order.service';
import { RestaurantKdsService } from './kds.service';
import { RestaurantRecipeService } from './recipe.service';
import { RestaurantDeliveryService } from './delivery.service';
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
  imports: [InventoryModule, FinanceModule],
  controllers: [RestaurantController],
  providers: [
    RestaurantMenuService,
    RestaurantFloorService,
    RestaurantOrderService,
    RestaurantKdsService,
    RestaurantRecipeService,
    RestaurantDeliveryService,
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
