import { BadRequestException, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { type BarcodeSymbology, barcodeSvg, symbologyFor } from './barcode.util';

export type CodeFormat = 'svg' | 'png';

/**
 * Renders barcodes and QR codes for **any** module — inventory shelf labels, restaurant table
 * stickers, asset tags. Deliberately not owned by a vertical: a tenant that has inventory but not
 * restaurant still needs to print product codes, so gating this behind a feature entitlement would
 * be wrong.
 *
 * SVG is the default because a barcode rasterised at the wrong resolution stops scanning; PNG exists
 * for surfaces that cannot draw SVG (some PDF pipelines, older mail clients, native apps).
 */
@Injectable()
export class CodeImageService {
  async qr(value: string, format: CodeFormat = 'svg', size = 256): Promise<{ body: Buffer; contentType: string }> {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException('A value to encode is required');
    // Error correction M — survives a scuffed sticker without inflating the module count so far that
    // a phone camera struggles to resolve it.
    const opts = { errorCorrectionLevel: 'M' as const, margin: 2, width: Math.min(1024, Math.max(64, size)) };
    if (format === 'png') {
      return { body: await QRCode.toBuffer(text, { ...opts, type: 'png' }), contentType: 'image/png' };
    }
    const svg = await QRCode.toString(text, { ...opts, type: 'svg' });
    return { body: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml' };
  }

  /** Symbology is inferred from the value (a valid 13-digit EAN → EAN13, else CODE39) unless forced. */
  barcode(
    value: string,
    symbology?: BarcodeSymbology,
    opts: { moduleWidth?: number; height?: number; showText?: boolean } = {},
  ): { body: Buffer; contentType: string } {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException('A value to encode is required');
    try {
      const svg = barcodeSvg(text, symbology ?? symbologyFor(text), opts);
      return { body: Buffer.from(svg, 'utf8'), contentType: 'image/svg+xml' };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }
}
