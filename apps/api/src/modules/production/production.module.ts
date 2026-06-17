import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionController } from './production.controller';
import { ProductionGlConsumer } from './production-gl.consumer';
import { ProductionService } from './production.service';

/** Manufacturing reuses the inventory valued ledger (InventoryDocsService) to issue raw materials and
 * receive finished goods at cost, and (via ProductionGlConsumer) posts each completed order to the GL. */
@Module({
  imports: [InventoryModule, FinanceModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionGlConsumer],
})
export class ProductionModule {}
