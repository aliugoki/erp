import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { ExpenseClaimsService } from './expense-claims.service';
import { CreateExpenseClaimDto, DecideClaimDto, PayClaimDto, UpdateExpenseClaimDto } from './dto/expense-claim.dto';

/**
 * Employee expense claims. Feature-gated by `hr`; mutations require `hr:expense:write`. Reimbursing a
 * claim with a cash/bank account also posts it to the GL (needs the Finance module + expense accounts).
 */
@Controller('expense-claims')
@RequiresFeature('hr')
export class ExpenseClaimsController {
  constructor(private readonly claims: ExpenseClaimsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.claims.list(status);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.get(id);
  }

  @Post()
  @Permissions('hr:expense:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateExpenseClaimDto) {
    return this.claims.create(dto);
  }

  @Patch(':id')
  @Permissions('hr:expense:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseClaimDto) {
    return this.claims.update(id, dto);
  }

  @Post(':id/submit')
  @Permissions('hr:expense:write')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.claims.submit(id);
  }

  @Post(':id/decide')
  @Permissions('hr:expense:write')
  @HttpCode(HttpStatus.OK)
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideClaimDto) {
    return this.claims.decide(id, dto);
  }

  @Post(':id/pay')
  @Permissions('hr:expense:write')
  @HttpCode(HttpStatus.OK)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayClaimDto) {
    return this.claims.pay(id, dto);
  }
}
