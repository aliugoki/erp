import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyStockService } from './pharmacy-stock.service';

/**
 * Pharmacy Management System (ADR-009 feature `pharmacy`). Reuses the inventory valued ledger
 * (InventoryDocsService) for stock value and layers batch/expiry (FEFO) + drug master on top.
 */
@Module({
  imports: [InventoryModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, PharmacyStockService],
  exports: [PharmacyService, PharmacyStockService],
})
export class PharmacyModule {}
