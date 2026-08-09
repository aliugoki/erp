import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  AddOrderItemsDto,
  AggregatorUpdateDto,
  ClaimPrintJobDto,
  CompletePrintJobDto,
  CreatePrinterDto,
  GenerateBarcodeDto,
  AssignChefDto,
  AssignDriverDto,
  AttachModifierGroupDto,
  CompleteDeliveryDto,
  CreateDeliveryDto,
  CreateAreaDto,
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  CreateModifierDto,
  CreateModifierGroupDto,
  CreateOrderDto,
  CreateReservationDto,
  CreateTableDto,
  FailDeliveryDto,
  KdsBoardQueryDto,
  ListDeliveriesQueryDto,
  ListMenuItemsQueryDto,
  ListOrdersQueryDto,
  ListPrintJobsQueryDto,
  ListPrintersQueryDto,
  ListReservationsQueryDto,
  ListTablesQueryDto,
  MergeTablesDto,
  PrintLabelDto,
  PrintOrderDto,
  ReservationCheckinDto,
  ScanAddDto,
  ScanDto,
  SetReservationStatusDto,
  TrackLocationDto,
  SetComboComponentsDto,
  SetFiscalConfigDto,
  SetGlConfigDto,
  SetItemBranchPriceDto,
  SetKdsPriorityDto,
  SetRecipeDto,
  SetRestaurantConfigDto,
  SetTableStatusDto,
  SettleOrderDto,
  UpdateAreaDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateModifierDto,
  UpdateModifierGroupDto,
  UpdatePrinterDto,
  UpdateTableDto,
  VoidOrderDto,
} from './dto/restaurant.dto';
import { RestaurantFloorService } from './floor.service';
import { RestaurantKdsService } from './kds.service';
import { RestaurantMenuService } from './menu.service';
import { RestaurantOrderService } from './order.service';
import { RestaurantRecipeService } from './recipe.service';
import { RestaurantGlService } from './restaurant-gl.service';
import { RestaurantDeliveryService } from './delivery.service';
import { RestaurantReservationService } from './reservation.service';
import { RestaurantFiscalConfigService } from './fiscal/fiscal-config.service';
import { RestaurantPrinterService } from './printing/printer.service';
import { RestaurantPrintService } from './printing/print.service';
import { RestaurantScanService } from './scan.service';
import { type BarcodeSymbology } from '../codes/barcode.util';
import { RestaurantCodesService } from './printing/codes.service';

/**
 * Restaurant Management — gated by the `restaurant` feature entitlement (ADR-009). Reads require only
 * auth + the feature; writes require a fine-grained permission (ADR-010): `restaurant:menu:write` for
 * the catalogue, `restaurant:floor:write` to design the floor, `restaurant:operate` for live table
 * status/merge, `restaurant:config:write` for administration. Order / KDS / delivery endpoints arrive
 * in later phases on this same controller surface.
 */
@Controller('restaurant')
@RequiresFeature('restaurant')
export class RestaurantController {
  constructor(
    private readonly menu: RestaurantMenuService,
    private readonly floor: RestaurantFloorService,
    private readonly orders: RestaurantOrderService,
    private readonly kds: RestaurantKdsService,
    private readonly recipes: RestaurantRecipeService,
    private readonly glConfig: RestaurantGlService,
    private readonly delivery: RestaurantDeliveryService,
    private readonly reservations: RestaurantReservationService,
    private readonly fiscalConfig: RestaurantFiscalConfigService,
    private readonly printers: RestaurantPrinterService,
    private readonly print: RestaurantPrintService,
    private readonly scan: RestaurantScanService,
    private readonly codes: RestaurantCodesService,
  ) {}

  // ── Branches (multi-outlet) ─────────────────────────────────────────────────────
  /** The tenant's branches annotated with whether each has restaurant config — feeds the switcher. */
  @Get('branches')
  listBranches() {
    return this.menu.listBranches();
  }

  /** Bootstrap a branch's restaurant config (clone head-office defaults) so it can take orders. */
  @Post('branches/:id/provision')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:config:write')
  provisionBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.provisionBranch(id);
  }

  // ── Configuration ───────────────────────────────────────────────────────────────
  @Get('config')
  getConfig(@Query('branchId') branchId?: string) {
    return this.menu.getConfig(branchId);
  }

  @Put('config')
  @Permissions('restaurant:config:write')
  setConfig(@Body() dto: SetRestaurantConfigDto) {
    return this.menu.setConfig(dto);
  }

  @Get('gl-config')
  @Permissions('restaurant:config:write')
  getGlConfig() {
    return this.glConfig.get();
  }

  @Put('gl-config')
  @Permissions('restaurant:config:write')
  setGlConfig(@Body() dto: SetGlConfigDto) {
    return this.glConfig.set(dto);
  }

  // ── Dynamic fiscalization (PRA/FBR/SRB/KPRA/BRA) ────────────────────────────────--
  @Get('fiscal-config')
  @Permissions('restaurant:config:write')
  getFiscalConfig(@Query('branchId') branchId?: string) {
    return this.fiscalConfig.get(branchId);
  }

  @Put('fiscal-config')
  @Permissions('restaurant:config:write')
  setFiscalConfig(@Body() dto: SetFiscalConfigDto) {
    return this.fiscalConfig.set(dto);
  }

  // ── Menu: categories ─────────────────────────────────────────────────────────────
  @Get('categories')
  listCategories() {
    return this.menu.listCategories();
  }

  @Post('categories')
  @Permissions('restaurant:menu:write')
  createCategory(@Body() dto: CreateMenuCategoryDto) {
    return this.menu.createCategory(dto);
  }

  @Patch('categories/:id')
  @Permissions('restaurant:menu:write')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuCategoryDto) {
    return this.menu.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Permissions('restaurant:menu:write')
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteCategory(id);
  }

  // ── Menu: items ──────────────────────────────────────────────────────────────────
  @Get('items')
  listItems(@Query() query: ListMenuItemsQueryDto) {
    return this.menu.listItems(query);
  }

  @Post('items')
  @Permissions('restaurant:menu:write')
  createItem(@Body() dto: CreateMenuItemDto) {
    return this.menu.createItem(dto);
  }

  @Get('items/:id')
  getItem(@Param('id', ParseUUIDPipe) id: string, @Query('branchId') branchId?: string) {
    return this.menu.getItem(id, branchId);
  }

  @Patch('items/:id')
  @Permissions('restaurant:menu:write')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menu.updateItem(id, dto);
  }

  @Delete('items/:id')
  @Permissions('restaurant:menu:write')
  deleteItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteItem(id);
  }

  @Put('items/:id/branch-price')
  @Permissions('restaurant:menu:write')
  setBranchPrice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetItemBranchPriceDto) {
    return this.menu.setBranchPrice(id, dto);
  }

  @Put('items/:id/modifier-groups')
  @Permissions('restaurant:menu:write')
  attachModifierGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachModifierGroupDto) {
    return this.menu.attachModifierGroup(id, dto);
  }

  @Delete('items/:id/modifier-groups/:groupId')
  @Permissions('restaurant:menu:write')
  detachModifierGroup(@Param('id', ParseUUIDPipe) id: string, @Param('groupId', ParseUUIDPipe) groupId: string) {
    return this.menu.detachModifierGroup(id, groupId);
  }

  @Put('items/:id/combo')
  @Permissions('restaurant:menu:write')
  setComboComponents(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetComboComponentsDto) {
    return this.menu.setComboComponents(id, dto);
  }

  // ── Menu: modifier groups + modifiers ─────────────────────────────────────────────
  @Get('modifier-groups')
  listModifierGroups() {
    return this.menu.listModifierGroups();
  }

  @Post('modifier-groups')
  @Permissions('restaurant:menu:write')
  createModifierGroup(@Body() dto: CreateModifierGroupDto) {
    return this.menu.createModifierGroup(dto);
  }

  @Get('modifier-groups/:id')
  getModifierGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.getModifierGroup(id);
  }

  @Patch('modifier-groups/:id')
  @Permissions('restaurant:menu:write')
  updateModifierGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModifierGroupDto) {
    return this.menu.updateModifierGroup(id, dto);
  }

  @Delete('modifier-groups/:id')
  @Permissions('restaurant:menu:write')
  deleteModifierGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteModifierGroup(id);
  }

  @Post('modifiers')
  @Permissions('restaurant:menu:write')
  createModifier(@Body() dto: CreateModifierDto) {
    return this.menu.createModifier(dto);
  }

  @Patch('modifiers/:id')
  @Permissions('restaurant:menu:write')
  updateModifier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModifierDto) {
    return this.menu.updateModifier(id, dto);
  }

  @Delete('modifiers/:id')
  @Permissions('restaurant:menu:write')
  deleteModifier(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deleteModifier(id);
  }

  // ── Floor: areas ──────────────────────────────────────────────────────────────────
  @Get('areas')
  listAreas(@Query('branchId') branchId?: string) {
    return this.floor.listAreas(branchId);
  }

  @Post('areas')
  @Permissions('restaurant:floor:write')
  createArea(@Body() dto: CreateAreaDto) {
    return this.floor.createArea(dto);
  }

  @Patch('areas/:id')
  @Permissions('restaurant:floor:write')
  updateArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAreaDto) {
    return this.floor.updateArea(id, dto);
  }

  @Delete('areas/:id')
  @Permissions('restaurant:floor:write')
  deleteArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.floor.deleteArea(id);
  }

  // ── Floor: tables ─────────────────────────────────────────────────────────────────
  @Get('tables')
  listTables(@Query() query: ListTablesQueryDto) {
    return this.floor.listTables(query);
  }

  @Post('tables')
  @Permissions('restaurant:floor:write')
  createTable(@Body() dto: CreateTableDto) {
    return this.floor.createTable(dto);
  }

  /** Every table's QR payload (issuing tokens for any that lack one) — feeds a printable sheet. */
  @Get('tables/qr-sheet')
  tableQrSheet(@Query('branchId') branchId?: string) {
    return this.codes.tableQrSheet(branchId);
  }

  @Get('tables/:id')
  getTable(@Param('id', ParseUUIDPipe) id: string) {
    return this.floor.getTable(id);
  }

  @Patch('tables/:id')
  @Permissions('restaurant:floor:write')
  updateTable(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.floor.updateTable(id, dto);
  }

  @Delete('tables/:id')
  @Permissions('restaurant:floor:write')
  deleteTable(@Param('id', ParseUUIDPipe) id: string) {
    return this.floor.deleteTable(id);
  }

  @Put('tables/:id/status')
  @Permissions('restaurant:operate')
  setTableStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTableStatusDto) {
    return this.floor.setStatus(id, dto);
  }

  @Post('tables/merge')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:operate')
  mergeTables(@Body() dto: MergeTablesDto) {
    return this.floor.merge(dto);
  }

  @Post('tables/:id/split')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:operate')
  splitTable(@Param('id', ParseUUIDPipe) id: string) {
    return this.floor.split(id);
  }

  // ── Orders ────────────────────────────────────────────────────────────────────────
  @Get('orders')
  listOrders(@Query() query: ListOrdersQueryDto) {
    return this.orders.list(query);
  }

  @Post('orders')
  @Permissions('restaurant:order:write')
  createOrder(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Post('orders/:id/items')
  @Permissions('restaurant:order:write')
  addOrderItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddOrderItemsDto) {
    return this.orders.addItems(id, dto);
  }

  @Delete('orders/:id/items/:itemId')
  @Permissions('restaurant:order:write')
  voidOrderItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.orders.voidItem(id, itemId);
  }

  @Post('orders/:id/place')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:order:write')
  placeOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.place(id);
  }

  @Post('orders/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:order:write')
  confirmOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirm(id);
  }

  @Post('orders/:id/settle')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:order:write')
  settleOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleOrderDto) {
    return this.orders.settle(id, dto);
  }

  @Post('orders/:id/void')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:order:write')
  voidOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidOrderDto) {
    return this.orders.void(id, dto);
  }

  // ── Kitchen Display System ──────────────────────────────────────────────────────--
  @Get('kds/board')
  @Permissions('restaurant:kds:operate')
  kdsBoard(@Query() query: KdsBoardQueryDto) {
    return this.kds.board(query);
  }

  @Post('kds/tickets/:id/start')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:kds:operate')
  kdsStart(@Param('id', ParseUUIDPipe) id: string) {
    return this.kds.start(id);
  }

  @Post('kds/tickets/:id/ready')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:kds:operate')
  kdsReady(@Param('id', ParseUUIDPipe) id: string) {
    return this.kds.ready(id);
  }

  @Post('kds/tickets/:id/bump')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:kds:operate')
  kdsBump(@Param('id', ParseUUIDPipe) id: string) {
    return this.kds.bump(id);
  }

  @Put('kds/tickets/:id/priority')
  @Permissions('restaurant:kds:operate')
  kdsPriority(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetKdsPriorityDto) {
    return this.kds.setPriority(id, dto);
  }

  @Put('kds/tickets/:id/chef')
  @Permissions('restaurant:kds:operate')
  kdsAssignChef(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignChefDto) {
    return this.kds.assignChef(id, dto);
  }

  // ── Delivery ────────────────────────────────────────────────────────────────────--
  @Get('deliveries')
  @Permissions('restaurant:delivery:dispatch')
  listDeliveries(@Query() query: ListDeliveriesQueryDto) {
    return this.delivery.list(query);
  }

  @Post('deliveries')
  @Permissions('restaurant:delivery:dispatch')
  createDelivery(@Body() dto: CreateDeliveryDto) {
    return this.delivery.create(dto);
  }

  @Get('deliveries/:id')
  @Permissions('restaurant:delivery:dispatch')
  getDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.get(id);
  }

  @Get('deliveries/:id/trail')
  @Permissions('restaurant:delivery:dispatch')
  getDeliveryTrail(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.trail(id);
  }

  @Post('deliveries/:id/assign')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  assignDriver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDriverDto) {
    return this.delivery.assign(id, dto);
  }

  @Post('deliveries/:id/pickup')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  pickupDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.pickup(id);
  }

  @Post('deliveries/:id/enroute')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  enrouteDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.enroute(id);
  }

  @Post('deliveries/:id/track')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  trackDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TrackLocationDto) {
    return this.delivery.track(id, dto);
  }

  @Post('deliveries/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  completeDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteDeliveryDto) {
    return this.delivery.complete(id, dto);
  }

  @Post('deliveries/:id/fail')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  failDelivery(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FailDeliveryDto) {
    return this.delivery.fail(id, dto);
  }

  @Post('deliveries/aggregator/:provider')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:delivery:dispatch')
  aggregatorUpdate(@Param('provider') provider: string, @Body() dto: AggregatorUpdateDto) {
    return this.delivery.ingestAggregatorUpdate(provider.toUpperCase(), dto);
  }

  // ── Reservations ────────────────────────────────────────────────────────────────--
  @Get('reservations')
  listReservations(@Query() query: ListReservationsQueryDto) {
    return this.reservations.list(query);
  }

  @Post('reservations')
  @Permissions('restaurant:operate')
  createReservation(@Body() dto: CreateReservationDto) {
    return this.reservations.create(dto);
  }

  @Get('reservations/:id')
  getReservation(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.get(id);
  }

  @Put('reservations/:id/status')
  @Permissions('restaurant:operate')
  setReservationStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetReservationStatusDto) {
    return this.reservations.setStatus(id, dto);
  }

  @Post('reservations/checkin')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:operate')
  reservationCheckin(@Body() dto: ReservationCheckinDto) {
    return this.reservations.checkin(dto);
  }

  // ── Recipes ─────────────────────────────────────────────────────────────────────--
  @Get('recipes')
  listRecipes() {
    return this.recipes.list();
  }

  @Get('items/:id/recipe')
  getRecipe(@Param('id', ParseUUIDPipe) id: string) {
    return this.recipes.getForItem(id);
  }

  @Put('items/:id/recipe')
  @Permissions('restaurant:menu:write')
  setRecipe(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRecipeDto) {
    return this.recipes.setForItem(id, dto);
  }

  @Delete('items/:id/recipe')
  @Permissions('restaurant:menu:write')
  deleteRecipe(@Param('id', ParseUUIDPipe) id: string) {
    return this.recipes.deleteForItem(id);
  }

  // ── Printers (peripherals) ──────────────────────────────────────────────────────
  @Get('printers')
  listPrinters(@Query() query: ListPrintersQueryDto) {
    return this.printers.list(query);
  }

  @Post('printers')
  @Permissions('restaurant:config:write')
  createPrinter(@Body() dto: CreatePrinterDto) {
    return this.printers.create(dto);
  }

  @Get('printers/:id')
  getPrinter(@Param('id', ParseUUIDPipe) id: string) {
    return this.printers.get(id);
  }

  @Patch('printers/:id')
  @Permissions('restaurant:config:write')
  updatePrinter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePrinterDto) {
    return this.printers.update(id, dto);
  }

  @Delete('printers/:id')
  @Permissions('restaurant:config:write')
  deletePrinter(@Param('id', ParseUUIDPipe) id: string) {
    return this.printers.remove(id);
  }

  /** Queue a test page — proves the device is reachable and the paper width is right. */
  @Post('printers/:id/test')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  testPrint(@Param('id', ParseUUIDPipe) id: string) {
    return this.print.testPrint(id);
  }

  // ── Print spool ─────────────────────────────────────────────────────────────────
  @Get('print-jobs')
  listPrintJobs(@Query() query: ListPrintJobsQueryDto) {
    return this.print.listJobs(query);
  }

  /**
   * The print agent's poll: hands out the next queued job for a printer and marks it claimed. The
   * response carries both the ESC/POS bytes (base64) and a plain-text rendering.
   */
  @Post('print-jobs/claim')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  claimPrintJob(@Body() dto: ClaimPrintJobDto) {
    return this.print.claim(dto);
  }

  @Get('print-jobs/:id')
  getPrintJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.print.getJob(id);
  }

  /** The agent reports the outcome; a failure stays retryable until the attempt limit. */
  @Post('print-jobs/:id/complete')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  completePrintJob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompletePrintJobDto) {
    return this.print.complete(id, dto);
  }

  @Post('print-jobs/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  retryPrintJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.print.retry(id);
  }

  @Post('print-jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  cancelPrintJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.print.cancel(id);
  }

  // ── Documents: preview + print ──────────────────────────────────────────────────
  /** Render the guest bill without printing — the on-screen preview / browser-print fallback. */
  @Get('orders/:id/receipt')
  previewReceipt(@Param('id', ParseUUIDPipe) id: string, @Query('charsPerLine') charsPerLine?: string) {
    return this.print.previewBill(id, charsPerLine ? Number(charsPerLine) : undefined);
  }

  @Post('orders/:id/print')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  printBill(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintOrderDto) {
    return this.print.printOrder(id, dto);
  }

  @Get('kds/tickets/:id/kot')
  previewKot(@Param('id', ParseUUIDPipe) id: string, @Query('charsPerLine') charsPerLine?: string) {
    return this.print.previewKot(id, charsPerLine ? Number(charsPerLine) : undefined);
  }

  /** Reprint a station ticket (paper jam, lost slip) — banner-marked so it reads as a duplicate. */
  @Post('kds/tickets/:id/print')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  printKot(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintOrderDto) {
    return this.print.printKot(id, dto);
  }

  // ── Scanning (barcode / QR) ─────────────────────────────────────────────────────
  /** Resolve any scanned code to the thing it identifies. Read-only: a mis-scan changes nothing. */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  resolveScan(@Body() dto: ScanDto) {
    return this.scan.resolve(dto);
  }

  /** Scan-to-add at the till: resolve a product barcode and put it on the open order. */
  @Post('orders/:id/scan-add')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:order:write')
  scanAdd(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanAddDto) {
    return this.scan.scanAdd(id, dto);
  }

  /** The table's QR sticker payload (issued on first request). */
  @Get('tables/:id/qr')
  tableQr(@Param('id', ParseUUIDPipe) id: string) {
    return this.scan.issueTableQr(id);
  }

  /** Rotate the token — invalidates a photographed or leaked sticker. */
  @Post('tables/:id/qr/rotate')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:floor:write')
  rotateTableQr(@Param('id', ParseUUIDPipe) id: string) {
    return this.scan.issueTableQr(id, true);
  }

  // ── Code generation (barcodes / QR) ─────────────────────────────────────────────
  /**
   * Render any value as a QR image. Raw image response (the transform interceptor passes binary
   * through), so it can be used directly as an `<img src>` or embedded in a print sheet.
   */
  @Get('codes/qr')
  @Header('Cache-Control', 'private, max-age=300')
  async qrImage(
    @Query('value') value: string,
    @Query('format') format?: string,
    @Query('size') size?: string,
  ): Promise<StreamableFile> {
    const fmt = format === 'png' ? 'png' : 'svg';
    const img = await this.codes.qrImage(value, fmt, size ? Number(size) : undefined);
    return new StreamableFile(img.body, { type: img.contentType, disposition: 'inline' });
  }

  /** Render a value as a 1-D barcode (SVG). Symbology is inferred unless given. */
  @Get('codes/barcode')
  @Header('Cache-Control', 'private, max-age=300')
  barcodeImage(
    @Query('value') value: string,
    @Query('symbology') symbology?: string,
    @Query('moduleWidth') moduleWidth?: string,
    @Query('height') height?: string,
    @Query('showText') showText?: string,
  ): StreamableFile {
    const img = this.codes.barcodeImage(value, symbology as BarcodeSymbology | undefined, {
      moduleWidth: moduleWidth ? Number(moduleWidth) : undefined,
      height: height ? Number(height) : undefined,
      showText: showText === undefined ? undefined : showText !== 'false',
    });
    return new StreamableFile(img.body, { type: img.contentType, disposition: 'inline' });
  }

  /** Mint (or record) a menu item's barcode — internal EAN-13 by default. */
  @Post('items/:id/barcode')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:menu:write')
  generateItemBarcode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateBarcodeDto) {
    return this.codes.generateItemBarcode(id, dto);
  }

  /** Give every barcode-less item one — for a menu imported without codes. */
  @Post('items/barcodes/generate-missing')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:menu:write')
  generateMissingBarcodes(@Body() dto: GenerateBarcodeDto) {
    return this.codes.generateMissingItemBarcodes(dto.prefix);
  }

  /** Print a table's QR as a label/tent card on the label (or receipt) printer. */
  @Post('tables/:id/qr/print')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  printTableQrLabel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintLabelDto) {
    return this.codes.printTableQrLabel(id, dto);
  }

  /** Print a shelf/product label carrying the item's barcode. */
  @Post('items/:id/barcode/print')
  @HttpCode(HttpStatus.OK)
  @Permissions('restaurant:print')
  printItemBarcodeLabel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintLabelDto) {
    return this.codes.printItemBarcodeLabel(id, dto);
  }
}
