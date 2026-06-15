import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AdjustStockDto,
  CreateGatePassDto,
  CreateGrnDto,
  CreateIssueDto,
  CreateMrnDto,
  CreatePurchaseOrderDto,
  CreateRequisitionDto,
  LedgerQueryDto,
} from './dto/inventory-docs.dto';
import { InventoryDocsService } from './inventory-docs.service';

const WRITE = [Role.INVENTORY_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Enterprise inventory documents (requisition → PO → GRN, gate pass, issuance, MRN) + valued reports. */
@Controller('inventory')
@RequiresFeature('inventory')
export class InventoryDocsController {
  constructor(private readonly docs: InventoryDocsService) {}

  // Stock adjustment / opening
  @Post('adjustments')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  adjust(@Body() dto: AdjustStockDto) {
    return this.docs.adjustStock(dto);
  }

  // Reports
  @Get('reports/stock')
  stockReport() {
    return this.docs.stockReport();
  }

  @Get('reports/reorder')
  reorderReport() {
    return this.docs.reorderReport();
  }

  @Get('products/:id/ledger')
  itemLedger(@Param('id', ParseUUIDPipe) id: string, @Query() query: LedgerQueryDto) {
    return this.docs.itemLedger(id, query);
  }

  // Requisitions
  @Get('requisitions')
  listRequisitions() {
    return this.docs.listRequisitions();
  }

  @Post('requisitions')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createRequisition(@Body() dto: CreateRequisitionDto) {
    return this.docs.createRequisition(dto);
  }

  @Get('requisitions/:id')
  getRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.getRequisition(id);
  }

  @Post('requisitions/:id/submit')
  @Roles(...WRITE)
  submitRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.setRequisitionStatus(id, 'SUBMITTED');
  }

  @Post('requisitions/:id/approve')
  @Roles(...WRITE)
  approveRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.setRequisitionStatus(id, 'APPROVED');
  }

  @Post('requisitions/:id/cancel')
  @Roles(...WRITE)
  cancelRequisition(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.setRequisitionStatus(id, 'CANCELLED');
  }

  // Purchase orders
  @Get('purchase-orders')
  listPurchaseOrders() {
    return this.docs.listPurchaseOrders();
  }

  @Post('purchase-orders')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto) {
    return this.docs.createPurchaseOrder(dto);
  }

  @Get('purchase-orders/:id')
  getPurchaseOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.getPurchaseOrder(id);
  }

  @Post('purchase-orders/:id/approve')
  @Roles(...WRITE)
  approvePO(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.setPurchaseOrderStatus(id, 'APPROVED');
  }

  @Post('purchase-orders/:id/cancel')
  @Roles(...WRITE)
  cancelPO(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.setPurchaseOrderStatus(id, 'CANCELLED');
  }

  // Goods receipt notes
  @Post('grns')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createGrn(@Body() dto: CreateGrnDto) {
    return this.docs.createGrn(dto);
  }

  // Gate passes
  @Get('gate-passes')
  listGatePasses() {
    return this.docs.listGatePasses();
  }

  @Post('gate-passes')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createGatePass(@Body() dto: CreateGatePassDto) {
    return this.docs.createGatePass(dto);
  }

  @Post('gate-passes/:id/close')
  @Roles(...WRITE)
  closeGatePass(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.closeGatePass(id);
  }

  // Store issuance
  @Post('issues')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createIssue(@Body() dto: CreateIssueDto) {
    return this.docs.createIssue(dto);
  }

  // Material return notes
  @Post('mrns')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createMrn(@Body() dto: CreateMrnDto) {
    return this.docs.createMrn(dto);
  }
}
