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
import { HrProfileService } from './hr-profile.service';
import { CreateEducationDto, CreateExperienceDto, UpdateEmployeeProfileDto } from './dto/hr.dto';


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
  @Permissions('hr:profile:write')
  updateProfile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeProfileDto) {
    return this.profile.updateProfile(id, dto);
  }

  @Post('employees/:id/education')
  @Permissions('hr:profile:write')
  @HttpCode(HttpStatus.CREATED)
  addEducation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEducationDto) {
    return this.profile.addEducation(id, dto);
  }

  @Delete('education/:id')
  @Permissions('hr:profile:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEducation(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.deleteEducation(id);
  }

  @Post('employees/:id/experience')
  @Permissions('hr:profile:write')
  @HttpCode(HttpStatus.CREATED)
  addExperience(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateExperienceDto) {
    return this.profile.addExperience(id, dto);
  }

  @Delete('experience/:id')
  @Permissions('hr:profile:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteExperience(@Param('id', ParseUUIDPipe) id: string) {
    return this.profile.deleteExperience(id);
  }
}
