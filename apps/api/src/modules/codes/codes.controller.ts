import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import type { BarcodeSymbology } from './barcode.util';
import { CodeImageService } from './code-image.service';

/**
 * Code rendering, shared by every module that prints something scannable. Auth is required (the
 * global guard), but there is no feature gate: inventory, restaurant and assets all need it.
 *
 * Responses are raw images — the transform interceptor passes `StreamableFile` through untouched — so
 * these URLs can be used directly as an `<img src>` or embedded in a printable sheet.
 */
@Controller('codes')
export class CodesController {
  constructor(private readonly images: CodeImageService) {}

  @Get('qr')
  @Header('Cache-Control', 'private, max-age=300')
  async qr(
    @Query('value') value: string,
    @Query('format') format?: string,
    @Query('size') size?: string,
  ): Promise<StreamableFile> {
    const img = await this.images.qr(value, format === 'png' ? 'png' : 'svg', size ? Number(size) : undefined);
    return new StreamableFile(img.body, { type: img.contentType, disposition: 'inline' });
  }

  @Get('barcode')
  @Header('Cache-Control', 'private, max-age=300')
  barcode(
    @Query('value') value: string,
    @Query('symbology') symbology?: string,
    @Query('moduleWidth') moduleWidth?: string,
    @Query('height') height?: string,
    @Query('showText') showText?: string,
  ): StreamableFile {
    const img = this.images.barcode(value, symbology as BarcodeSymbology | undefined, {
      moduleWidth: moduleWidth ? Number(moduleWidth) : undefined,
      height: height ? Number(height) : undefined,
      showText: showText === undefined ? undefined : showText !== 'false',
    });
    return new StreamableFile(img.body, { type: img.contentType, disposition: 'inline' });
  }
}
