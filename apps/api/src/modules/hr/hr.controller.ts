import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShadowPermissions } from '../auth/decorators/shadow-permissions.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import type { UploadedFileLike } from '../storage/storage.service';
import {
  CreateAttendanceDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateEmployeeDto,
  CreatePositionDto,
  ListEmployeesQueryDto,
  UpdateDepartmentDto,
  UpdateDesignationDto,
  UpdatePositionDto,
  UpdateEmployeeDto,
} from './dto/hr.dto';
import { HrService } from './hr.service';

/** HR module — gated by the `hr` feature entitlement; writes require an HR manager (or an admin). */
const WRITE = [Role.HR_MANAGER, Role.TENANT_ADMIN, Role.SUPER_ADMIN] as const;

@Controller('hr')
@RequiresFeature('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  // Employees
  @Get('employees')
  listEmployees(@Query() query: ListEmployeesQueryDto) {
    return this.hr.listEmployees(query);
  }

  @Post('employees')
  @Roles(...WRITE)
  @ShadowPermissions('hr:employee:write')
  @HttpCode(HttpStatus.CREATED)
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.hr.createEmployee(dto);
  }

  @Get('employees/:id')
  getEmployee(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.getEmployee(id);
  }

  @Patch('employees/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:employee:write')
  updateEmployee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.hr.updateEmployee(id, dto);
  }

  @Delete('employees/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:employee:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEmployee(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteEmployee(id);
  }

  /** Upload (or replace) an employee photo — multipart `file` field (image, ≤8 MiB). */
  @Post('employees/:id/photo')
  @Roles(...WRITE)
  @ShadowPermissions('hr:employee:write')
  @UseInterceptors(FileInterceptor('file'))
  uploadPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('A multipart "file" field is required');
    return this.hr.setEmployeePhoto(id, file);
  }

  /** Stream the employee photo bytes (raw image; not enveloped). 404 if the employee has no photo. */
  @Get('employees/:id/photo')
  @Header('Cache-Control', 'private, max-age=300')
  async getPhoto(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const photo = await this.hr.getEmployeePhoto(id);
    if (!photo) throw new NotFoundException('Employee has no photo');
    return new StreamableFile(photo.data, { type: photo.contentType, length: photo.byteSize });
  }

  // Departments
  @Get('departments')
  listDepartments() {
    return this.hr.listDepartments();
  }

  @Post('departments')
  @Roles(...WRITE)
  @ShadowPermissions('hr:department:write')
  @HttpCode(HttpStatus.CREATED)
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.hr.createDepartment(dto);
  }

  @Patch('departments/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:department:write')
  updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.hr.updateDepartment(id, dto);
  }

  @Delete('departments/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:department:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDepartment(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteDepartment(id);
  }

  // Positions
  @Get('positions')
  listPositions() {
    return this.hr.listPositions();
  }

  @Post('positions')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  @HttpCode(HttpStatus.CREATED)
  createPosition(@Body() dto: CreatePositionDto) {
    return this.hr.createPosition(dto);
  }

  @Patch('positions/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  updatePosition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePositionDto) {
    return this.hr.updatePosition(id, dto);
  }

  @Delete('positions/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deletePosition(id);
  }

  // Designations (managed list for the employee form dropdown)
  @Get('designations')
  listDesignations() {
    return this.hr.listDesignations();
  }

  @Post('designations')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  @HttpCode(HttpStatus.CREATED)
  createDesignation(@Body() dto: CreateDesignationDto) {
    return this.hr.createDesignation(dto);
  }

  @Patch('designations/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  updateDesignation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDesignationDto) {
    return this.hr.updateDesignation(id, dto);
  }

  @Delete('designations/:id')
  @Roles(...WRITE)
  @ShadowPermissions('hr:org:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDesignation(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteDesignation(id);
  }

  // Attendance
  @Post('attendance')
  @Roles(...WRITE)
  @ShadowPermissions('hr:attendance:write')
  @HttpCode(HttpStatus.CREATED)
  createAttendance(@Body() dto: CreateAttendanceDto) {
    return this.hr.createAttendance(dto);
  }

  @Get('attendance/:employeeId')
  listAttendance(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.hr.listAttendance(employeeId);
  }
}
