import { BadRequestException, Injectable } from '@nestjs/common';
import { generateInternalEan13 } from './barcode.util';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const TENANT = `current_setting('app.tenant_id')::uuid`;
const MAX_ATTEMPTS = 20;

/**
 * Mints internal product barcodes from a **single tenant-wide counter**.
 *
 * A barcode is a physical identity: whatever is printed on a shelf must mean exactly one thing across
 * the whole business. Per-module counters cannot guarantee that — two modules each starting at 1 will
 * issue the same code, and a scan then resolves to whichever catalogue happens to be searched first.
 * So the counter lives here, above the verticals, and each caller only supplies a `taken` probe to
 * defend against codes that were hand-entered rather than minted.
 *
 * Runs inside the caller's transaction so the counter advances with the write that uses it.
 */
@Injectable()
export class InternalCodeService {
  /**
   * Draw the next free internal EAN-13. `taken` is asked about each candidate so a hand-entered code
   * that happens to occupy a number is stepped over rather than colliding at INSERT time.
   */
  async mintProductBarcode(
    m: Mgr,
    opts: { prefix?: string; taken?: (candidate: string) => Promise<boolean> } = {},
  ): Promise<string> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const seq = (await m.query(
        `INSERT INTO code_seq (tenant_id, kind, last_no) VALUES (${TENANT}, 'PRODUCT_BARCODE', 1)
         ON CONFLICT (tenant_id, kind) DO UPDATE SET last_no = code_seq.last_no + 1
         RETURNING last_no`,
      )) as Array<{ last_no: string }>;
      const candidate = generateInternalEan13(Number(seq[0]!.last_no), opts.prefix);
      if (!opts.taken || !(await opts.taken(candidate))) return candidate;
    }
    throw new BadRequestException('Could not mint a free barcode — check the catalogue for duplicates');
  }
}
