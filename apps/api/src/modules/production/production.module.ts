import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

/** Manufacturing reuses the inventory valued ledger (InventoryDocsService) to issue raw materials and
 * receive finished goods at the computed cost. */
@Module({
  imports: [InventoryModule],
  controllers: [ProductionController],
  providers: [ProductionService],
})
export class ProductionModule {}
