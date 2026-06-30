import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

/**
 * Company branches. Core company infra (not feature-gated) referenced by HR/Inventory/POS/Finance.
 * Reads are available to any authenticated tenant user (employee / warehouse / register forms need the
 * list); writes require `branch:write` (TENANT_ADMIN via the `*` wildcard, or HR_MANAGER).
 */
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list() {
    return this.branches.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.get(id);
  }

  @Post()
  @Permissions('branch:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Patch(':id')
  @Permissions('branch:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Delete(':id')
  @Permissions('branch:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.remove(id);
  }
}
