import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RequiresFeature } from '../features/requires-feature.decorator';
import { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-schedule.dto';
import { ReportScheduleService } from './report-schedule.service';

/** Scheduled report emails (preset or saved report → rendered + emailed on a cadence). Feature-gated;
 * mutations require `report:write`. */
@Controller('reports/schedules')
@RequiresFeature('reporting')
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportScheduleService) {}

  @Get()
  list() {
    return this.schedules.list();
  }

  @Post()
  @Permissions('report:write')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateReportScheduleDto) {
    return this.schedules.create(dto);
  }

  @Patch(':id')
  @Permissions('report:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReportScheduleDto) {
    return this.schedules.update(id, dto);
  }

  @Delete(':id')
  @Permissions('report:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.remove(id);
  }

  /** Render + email the schedule right now (also advances its next run). */
  @Post(':id/run')
  @Permissions('report:write')
  @HttpCode(HttpStatus.OK)
  run(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.runNow(id);
  }
}
