import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentTerminalService } from './payment-terminal.service';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

/** POS reuses the inventory valued ledger (InventoryDocsService) to decrement stock + capture COGS. */
@Module({
  imports: [InventoryModule],
  controllers: [PosController],
  providers: [PosService, PaymentTerminalService],
})
export class PosModule {}
