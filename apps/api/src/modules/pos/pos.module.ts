import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentTerminalService } from './payment-terminal.service';
import { PosGlConsumer } from './pos-gl.consumer';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** POS reuses the inventory valued ledger (InventoryDocsService) to decrement stock + capture COGS,
 * and (via PosGlConsumer) posts each completed sale to the general ledger through FinanceService. */
@Module({
  imports: [InventoryModule, FinanceModule],
  controllers: [PosController],
  providers: [PosService, PaymentTerminalService, PosGlConsumer],
})
export class PosModule {}
