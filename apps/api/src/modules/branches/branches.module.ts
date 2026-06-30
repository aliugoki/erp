import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

/** Company branches (sites/offices) — a shared, tenant-scoped dimension referenced by HR/Inventory/POS/
 * Finance. Exports the service so other modules can read branches in-tx if needed. */
@Module({
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
