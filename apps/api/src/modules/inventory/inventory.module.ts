import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryDocsController } from './inventory-docs.controller';
import { InventoryDocsService } from './inventory-docs.service';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController, InventoryDocsController],
  providers: [InventoryService, InventoryDocsService],
})
export class InventoryModule {}
