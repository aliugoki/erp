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
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/rbac/role.enum';
import { RequiresFeature } from '../features/requires-feature.decorator';
import {
  CreateAttendanceDto,
  CreateDepartmentDto,
  CreateDesignationDto,
  CreateEmployeeDto,
  CreatePositionDto,
  ListEmployeesQueryDto,
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
  updateEmployee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto) {
    return this.hr.updateEmployee(id, dto);
  }

  @Delete('employees/:id')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEmployee(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteEmployee(id);
  }

  // Departments
  @Get('departments')
  listDepartments() {
    return this.hr.listDepartments();
  }

  @Post('departments')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.hr.createDepartment(dto);
  }

  @Delete('departments/:id')
  @Roles(...WRITE)
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
  @HttpCode(HttpStatus.CREATED)
  createPosition(@Body() dto: CreatePositionDto) {
    return this.hr.createPosition(dto);
  }

  // Designations (managed list for the employee form dropdown)
  @Get('designations')
  listDesignations() {
    return this.hr.listDesignations();
  }

  @Post('designations')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createDesignation(@Body() dto: CreateDesignationDto) {
    return this.hr.createDesignation(dto);
  }

  @Delete('designations/:id')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDesignation(@Param('id', ParseUUIDPipe) id: string) {
    return this.hr.deleteDesignation(id);
  }

  // Attendance
  @Post('attendance')
  @Roles(...WRITE)
  @HttpCode(HttpStatus.CREATED)
  createAttendance(@Body() dto: CreateAttendanceDto) {
    return this.hr.createAttendance(dto);
  }

  @Get('attendance/:employeeId')
  listAttendance(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.hr.listAttendance(employeeId);
  }
}
