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
} from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { HrPolicyService } from './hr-policy.service';
import { CreateCustomFieldDto, CreatePolicyDto, UpdatePolicyStatusDto } from './dto/hr.dto';


/** Configurable HR policy module — company-defined custom fields + policies that carry their values.
 * Gated by the `hr` feature; writes require an HR manager (or admin). */
@Controller('hr')
@RequiresFeature('hr')
export class HrPolicyController {
  constructor(private readonly policy: HrPolicyService) {}

  // ── Custom field definitions ────────────────────────────────────────────────
  @Get('custom-fields')
  listFields() {
    return this.policy.listCustomFields('POLICY');
  }

  @Post('custom-fields')
  @Permissions('hr:policy:write')
  @HttpCode(HttpStatus.CREATED)
  createField(@Body() dto: CreateCustomFieldDto) {
    return this.policy.createCustomField(dto, 'POLICY');
  }

  @Delete('custom-fields/:id')
  @Permissions('hr:policy:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteField(@Param('id', ParseUUIDPipe) id: string) {
    return this.policy.deleteCustomField(id);
  }

  // ── Policies ────────────────────────────────────────────────────────────────
  @Get('policies')
  listPolicies() {
    return this.policy.listPolicies();
  }

  @Post('policies')
  @Permissions('hr:policy:write')
  @HttpCode(HttpStatus.CREATED)
  createPolicy(@Body() dto: CreatePolicyDto) {
    return this.policy.createPolicy(dto);
  }

  @Get('policies/:id')
  getPolicy(@Param('id', ParseUUIDPipe) id: string) {
    return this.policy.getPolicy(id);
  }

  @Patch('policies/:id/status')
  @Permissions('hr:policy:write')
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePolicyStatusDto) {
    return this.policy.updatePolicyStatus(id, dto.status);
  }
}
