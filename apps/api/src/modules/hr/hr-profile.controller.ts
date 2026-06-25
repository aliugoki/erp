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
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { HrProfileService } from './hr-profile.service';
import { CreateEducationDto, CreateExperienceDto, UpdateEmployeeProfileDto } from './dto/hr.dto';

const WRITE = [Role.HR_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

/** Complete employee profile — personal/contact/job detail plus academic and work history. Shares the
 * `hr` feature gate and `/hr` prefix with {@link HrController}. */
@Controller('hr')
@RequiresFeature('hr')
export class HrProfileController {
  constructor(private readonly profile: HrProfileService) {}

  @Get('employees/:id/profile')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.getProfile(id);
  }

  @Patch('employees/:id/profile')
  @Roles(...WRITE)
  @ShadowPermissions('hr:profile:write')
  updateProfile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeProfileDto) {
    return this.profile.updateProfile(id, dto);
  }

  @Post('employees/:id/education')
  @Roles(...WRITE)
  @ShadowPermissions('hr:profile:write')
  @HttpCode(HttpStatus.CREATED)
  addEducation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEducationDto) {
    return this.profile.addEducation(id, dto);
  }

  @Delete('education/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:profile:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEducation(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.deleteEducation(id);
  }

  @Post('employees/:id/experience')
  @Roles(...WRITE)
  @ShadowPermissions('hr:profile:write')
  @HttpCode(HttpStatus.CREATED)
  addExperience(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateExperienceDto) {
    return this.profile.addExperience(id, dto);
  }

  @Delete('experience/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:profile:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteExperience(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.deleteExperience(id);
  }
}
