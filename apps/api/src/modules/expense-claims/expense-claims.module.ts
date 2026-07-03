import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ExpenseClaimsController } from './expense-claims.controller';
import { ExpenseClaimsService } from './expense-claims.service';

/** Employee expense claims / reimbursements. Imports FinanceModule so paying a claim can post the
 * reimbursement voucher to the GL. */
@Module({
  imports: [FinanceModule],
  controllers: [ExpenseClaimsController],
  providers: [ExpenseClaimsService],
})
export class ExpenseClaimsModule {}
