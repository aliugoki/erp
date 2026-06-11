import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/rbac/authenticated-user';
import { AnomalyRangeDto, ForecastOptionsDto } from './dto/ai.dto';
import { MlService } from './ml.service';

/** Minimal structural type for an uploaded file (avoids a hard @types/multer dependency). */
interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * The API surface for AI features (Chunk 6.5). These delegate to the ML service through the resilient
 * {@link MlService} bridge — tenant is always taken from the authenticated principal (never the
 * client), and ML being unavailable yields a typed `degraded` response, never a 5xx.
 */
@Controller('api/ai')
export class AiController {
  constructor(private readonly ml: MlService) {}

  /** Breaker state — lets ops see whether the ML bridge is open/half-open/closed. */
  @Get('health')
  health() {
    return { ml: { breaker: this.ml.breakerState } };
  }

  @HttpCode(HttpStatus.OK)
  @Post('forecast/:productId')
  forecast(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() opts: ForecastOptionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ml.forecastDemand(user.tenantId, productId, opts);
  }

  @HttpCode(HttpStatus.OK)
  @Post('anomalies/scan')
  scanAnomalies(@Body() range: AnomalyRangeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ml.scanAnomalies(user.tenantId, range);
  }

  @HttpCode(HttpStatus.OK)
  @Post('invoice/extract')
  @UseInterceptors(FileInterceptor('file'))
  extractInvoice(@UploadedFile() file?: UploadedFileLike) {
    if (!file) throw new UnsupportedMediaTypeException('A multipart "file" field is required');
    return this.ml.extractInvoice(file);
  }
}
