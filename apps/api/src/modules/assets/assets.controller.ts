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
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
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
const WRITE = [Role.FINANCE_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

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
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.assets.createCategory(dto);
  }

  @Patch('categories/:id')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.assets.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.deleteCategory(id);
  }

  // ── Depreciation ────────────────────────────────────────────────────────────
  @Post('depreciation/run')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
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
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
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
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
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
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
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
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.updateAsset(id, dto);
  }

  @Post(':id/activate')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.activateAsset(id);
  }

  @Post(':id/dispose')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  @HttpCode(HttpStatus.OK)
  dispose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DisposeAssetDto) {
    return this.assets.disposeAsset(id, dto);
  }

  @Post(':id/write-off')
  @Roles(...WRITE)
  @ShadowPermissions('asset:write')
  @HttpCode(HttpStatus.OK)
  writeOff(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.writeOffAsset(id);
  }
}
