import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  CloseShiftDto,
  CompleteSaleDto,
  CreateRegisterDto,
  CreateSaleDto,
  OpenShiftDto,
  RefundSaleDto,
  SetPosGlConfigDto,
  TerminalChargeDto,
  UpdateRegisterDto,
} from './dto/pos.dto';
import { PosService } from './pos.service';

/** Cashiers (sales reps) ring sales; admins manage registers. Reports also open to finance managers. */
const WRITE = [Role.SALES_REP, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;
const ADMIN = [Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Point of Sale — gated by the `pos` feature entitlement. */
@Controller('pos')
@RequiresFeature('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  // ── Registers ───────────────────────────────────────────────────────────────
  @Get('registers')
  listRegisters() {
    return this.pos.listRegisters();
  }

  @Post('registers')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createRegister(@Body() dto: CreateRegisterDto) {
    return this.pos.createRegister(dto);
  }

  @Get('registers/:id')
  getRegister(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.getRegister(id);
  }

  @Patch('registers/:id')
  @Roles(...ADMIN)
  updateRegister(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRegisterDto) {
    return this.pos.updateRegister(id, dto);
  }

  @Delete('registers/:id')
  @Roles(...ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRegister(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.deleteRegister(id);
  }

  @Get('registers/:id/current-shift')
  currentShift(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.currentShift(id);
  }

  /** Initiate a card charge on this register's terminal; returns the approval to attach as a tender. */
  @Post('registers/:id/charge')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.OK)
  charge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TerminalChargeDto) {
    return this.pos.chargeCard(id, dto);
  }

  // ── Shifts ────────────────────────────────────────────────────────────────────
  @Get('shifts')
  listShifts(@Query('registerId') registerId?: string) {
    return this.pos.listShifts(registerId);
  }

  @Post('shifts/open')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.openShift(dto, user.userId);
  }

  @Get('shifts/:id')
  getShift(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.getShift(id);
  }

  @Patch('shifts/:id/close')
  @Roles(...WRITE)
  closeShift(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseShiftDto) {
    return this.pos.closeShift(id, dto);
  }

  // ── Sales ─────────────────────────────────────────────────────────────────────
  @Get('sales')
  listSales(@Query('shiftId') shiftId?: string, @Query('registerId') registerId?: string) {
    return this.pos.listSales({ shiftId, registerId });
  }

  @Post('sales')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createSale(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.createSale(dto, user.userId);
  }

  @Get('sales/:id')
  getSale(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.getSale(id);
  }

  @Post('sales/:id/complete')
  @Roles(...WRITE)
  completeSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.completeParkedSale(id, dto, user.userId);
  }

  @Post('sales/:id/void')
  @Roles(...WRITE)
  voidSale(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.voidSale(id, user.userId);
  }

  @Post('sales/:id/refund')
  @Roles(...WRITE)
  refundSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.refundSale(id, dto, user.userId);
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  @Get('reports/daily')
  @Roles(Role.SALES_REP, Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  dailySummary(@Query('date') date?: string) {
    return this.pos.dailySummary(date);
  }

  @Get('reports/top-products')
  @Roles(Role.SALES_REP, Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  topProducts(@Query('limit') limit?: string) {
    return this.pos.topProducts(limit ? Number(limit) : 10);
  }

  // ── GL posting config ───────────────────────────────────────────────────────
  @Get('gl-config')
  @Roles(Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  getGlConfig() {
    return this.pos.getGlConfig();
  }

  @Put('gl-config')
  @Roles(Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetPosGlConfigDto) {
    return this.pos.setGlConfig(dto);
  }
}
