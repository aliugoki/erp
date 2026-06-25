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
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { AssetsService } from './assets.service';
import {
  CreateAssetDto,
  CreateCategoryDto,
  CreateMaintenanceDto,
  DisposeAssetDto,
  RunDepreciationDto,
  SetGlConfigDto,
  UpdateAssetDto,
  UpdateCategoryDto,
} from './dto/assets.dto';

/** Asset writes are a finance function — gated to a finance manager (or an admin). */

/** Fixed Asset Management — gated by the `assets` feature entitlement. */
@Controller('assets')
@RequiresFeature('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  // ── Categories ────────────────────────────────────────────────────────────────
  @Get('categories')
  listCategories() {
    return this.assets.listCategories();
  }

  @Post('categories')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.assets.createCategory(dto);
  }

  @Patch('categories/:id')
  @Permissions('asset:write')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.assets.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.deleteCategory(id);
  }

  // ── Depreciation ────────────────────────────────────────────────────────────
  @Post('depreciation/run')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.CREATED)
  runDepreciation(@Body() dto: RunDepreciationDto) {
    return this.assets.runDepreciation(dto);
  }

  @Get('depreciation/runs')
  listRuns() {
    return this.assets.listRuns();
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────
  @Get('maintenance/upcoming')
  upcomingMaintenance(@Query('days') days?: string) {
    return this.assets.upcomingMaintenance(days ? Number(days) : 30);
  }

  @Get('maintenance')
  listMaintenance(@Query('assetId') assetId?: string) {
    return this.assets.listMaintenance(assetId);
  }

  @Post('maintenance')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.CREATED)
  createMaintenance(@Body() dto: CreateMaintenanceDto) {
    return this.assets.createMaintenance(dto);
  }

  // ── GL posting config ───────────────────────────────────────────────────────
  @Get('gl-config')
  getGlConfig() {
    return this.assets.getGlConfig();
  }

  @Put('gl-config')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.OK)
  setGlConfig(@Body() dto: SetGlConfigDto) {
    return this.assets.setGlConfig(dto);
  }

  // ── Reports ─────────────────────────────────────────────────────────────────
  @Get('reports/register')
  register() {
    return this.assets.register();
  }

  // ── Assets ──────────────────────────────────────────────────────────────────
  @Get()
  listAssets(@Query('status') status?: string) {
    return this.assets.listAssets(status);
  }

  @Post()
  @Permissions('asset:write')
  @HttpCode(HttpStatus.CREATED)
  createAsset(@Body() dto: CreateAssetDto) {
    return this.assets.createAsset(dto);
  }

  @Get(':id')
  getAsset(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.getAsset(id);
  }

  @Get(':id/schedule')
  schedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.schedule(id);
  }

  @Patch(':id')
  @Permissions('asset:write')
  updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.updateAsset(id, dto);
  }

  @Post(':id/activate')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.activateAsset(id);
  }

  @Post(':id/dispose')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.OK)
  dispose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeAssetDto) {
    return this.assets.disposeAsset(id, dto);
  }

  @Post(':id/write-off')
  @Permissions('asset:write')
  @HttpCode(HttpStatus.OK)
  writeOff(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.writeOffAsset(id);
  }
}
