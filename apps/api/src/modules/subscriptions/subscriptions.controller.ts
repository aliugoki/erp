import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  CancelSubscriptionDto, ChangeSubscriptionDto, CreateSubscriptionDto,
  MarkInvoicePaidDto, SetSubGlConfigDto, UpsertPlanDto,
} from './dto/subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

const MANAGER = [Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Recurring-billing console — gated by the `subscriptions` feature entitlement (ADR-009). */
@Controller('subscriptions')
@RequiresFeature('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  // ── Metrics ──────────────────────────────────────────────────────────────────────
  @Get('metrics')
  metrics() {
    return this.subs.metrics();
  }

  // ── Plans ─────────────────────────────────────────────────────────────────────────
  @Get('plans')
  listPlans() {
    return this.subs.listPlans();
  }

  @Post('plans')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.CREATED)
  createPlan(@Body() dto: UpsertPlanDto) {
    return this.subs.createPlan(dto);
  }

  @Patch('plans/:id')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertPlanDto) {
    return this.subs.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  archivePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.archivePlan(id);
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────────────
  @Get()
  list(@Query('status') status?: string, @Query('planId') planId?: string, @Query('q') q?: string) {
    return this.subs.listSubscriptions({ status, planId, q });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.getSubscription(id);
  }

  @Post()
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateSubscriptionDto) {
    return this.subs.createSubscription(dto);
  }

  @Patch(':id')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  change(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeSubscriptionDto) {
    return this.subs.changeSubscription(id, dto);
  }

  @Post(':id/pause')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.pauseSubscription(id);
  }

  @Post(':id/resume')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.resumeSubscription(id);
  }

  @Post(':id/cancel')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelSubscriptionDto) {
    return this.subs.cancelSubscription(id, dto);
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────────
  @Get('invoices/all')
  listInvoices(@Query('subscriptionId') subscriptionId?: string, @Query('status') status?: string) {
    return this.subs.listInvoices({ subscriptionId, status });
  }

  @Post('invoices/:id/pay')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  payInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkInvoicePaidDto) {
    return this.subs.markInvoicePaid(id, dto);
  }

  @Post('invoices/:id/void')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  voidInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.voidInvoice(id);
  }

  // ── Billing engine (manual trigger) ────────────────────────────────────────────────
  @Post('run-billing')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  runBilling() {
    return this.subs.runBilling();
  }

  // ── GL config ──────────────────────────────────────────────────────────────────────
  @Get('gl-config')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  getGlConfig() {
    return this.subs.getGlConfig();
  }

  @Put('gl-config')
  @Roles(...MANAGER)
  @ShadowPermissions('subscription:write')
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetSubGlConfigDto) {
    return this.subs.setGlConfig(dto);
  }
}
