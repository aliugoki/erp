import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockService } from './pharmacy-stock.service';
import { PharmacyDispenseService } from './pharmacy-dispense.service';
import { PharmacyGlConsumer } from './pharmacy-gl.consumer';

/**
 * Pharmacy Management System (ADR-009 feature `pharmacy`). Reuses the inventory valued ledger
 * (InventoryDocsService) for stock value, layers batch/expiry (FEFO) + drug master + dispensing on
 * top, and posts each dispense to the GL via FinanceService (PharmacyGlConsumer).
 */
@Module({
  imports: [InventoryModule, FinanceModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, PharmacyStockService, PharmacyDispenseService, PharmacyGlConsumer],
  exports: [PharmacyService, PharmacyStockService, PharmacyDispenseService],
})
export class PharmacyModule {}
