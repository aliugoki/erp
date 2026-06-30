import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { SaveFbrConfigDto } from './dto/fbr.dto';
import { FbrService } from './fbr.service';

/**
 * Tax & compliance — FBR (Pakistan) digital invoicing. Feature-gated (`tax`); config + reporting are
 * admin actions. Reporting a POS sale builds + sends the FBR payload and records the FBR invoice
 * number + QR (sandbox by default).
 */
@Controller('tax/fbr')
@RequiresFeature('tax')
@Roles(Role.TENANT_ADMIN, Role.SUPER_ADMIN)
export class FbrController {
  constructor(private readonly fbr: FbrService) {}

  @Get('config')
  getConfig() {
    return this.fbr.getConfig();
  }

  @Put('config')
  saveConfig(@Body() dto: SaveFbrConfigDto) {
    return this.fbr.saveConfig(dto);
  }

  @Get('invoices')
  invoices() {
    return this.fbr.listInvoices();
  }

  /** The FBR record for a sale — powers the POS receipt QR. Broadened to cashiers (SALES_REP). */
  @Get('sale/:saleId')
  @Roles(Role.SUPER_ADMIN, Role.TENANT_ADMIN, Role.SALES_REP)
  forSale(@Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.fbr.getForSale(saleId);
  }

  @Post('report/:saleId')
  @HttpCode(HttpStatus.OK)
  report(@Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.fbr.reportSale(saleId);
  }
}
