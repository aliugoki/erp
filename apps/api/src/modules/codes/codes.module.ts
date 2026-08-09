import { Global, Module } from '@nestjs/common';
import { CodesController } from './codes.controller';
import { CodeImageService } from './code-image.service';
import { InternalCodeService } from './internal-code.service';

/**
 * Barcode / QR generation shared across verticals (@Global so any module can inject the renderer
 * without importing this one). The pure encoding lives in `barcode.util.ts`; only image rendering
 * needs a provider.
 */
@Global()
@Module({
  controllers: [CodesController],
  providers: [CodeImageService, InternalCodeService],
  exports: [CodeImageService, InternalCodeService],
})
export class CodesModule {}
