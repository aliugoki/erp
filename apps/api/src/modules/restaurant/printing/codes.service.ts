import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TenantTransactionService } from '../../../common/tenant/tenant-transaction.service';
import { type CodeFormat, CodeImageService } from '../../codes/code-image.service';
import { InternalCodeService } from '../../codes/internal-code.service';
import type { GenerateBarcodeDto, PrintLabelDto } from '../dto/restaurant.dto';
import { type Row, rowsOf } from '../restaurant.util';
import { type BarcodeSymbology, isValidEan13, symbologyFor } from '../../codes/barcode.util';
import { buildLabelDoc } from './receipt.builder';
import { RestaurantPrintService } from './print.service';
import { RestaurantPrinterService } from './printer.service';

type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

/**
 * Code **generation** — the counterpart to scanning (ADR-011 §9).
 *
 * Three things a restaurant needs to produce rather than read:
 *  • a **barcode for a menu item** it sells as a packaged product, minted in the GS1 in-store range so
 *    it can never collide with a real manufacturer's product;
 *  • a **QR image** for the table sticker a guest scans; and
 *  • a **printed label** carrying either, pushed through the same spool as bills and kitchen tickets.
 *
 * Images render as SVG (crisp at any size — a barcode rasterised at the wrong resolution will not
 * scan) with PNG available for surfaces that cannot draw SVG.
 */
@Injectable()
export class RestaurantCodesService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly print: RestaurantPrintService,
    private readonly printers: RestaurantPrinterService,
    private readonly images: CodeImageService,
    private readonly minter: InternalCodeService,
  ) {}

  // ── Images ──────────────────────────────────────────────────────────────────────

  /** QR image — delegates to the shared renderer (also served module-agnostically at `GET /codes/qr`). */
  qrImage(value: string, format: CodeFormat = 'svg', size = 256) {
    return this.images.qr(value, format, size);
  }

  /** Barcode image — see `GET /codes/barcode` for the shared, non-feature-gated route. */
  barcodeImage(value: string, symbology?: BarcodeSymbology, opts: { moduleWidth?: number; height?: number; showText?: boolean } = {}) {
    return this.images.barcode(value, symbology, opts);
  }

  // ── Minting an item barcode ─────────────────────────────────────────────────────

  /**
   * Give a menu item a scannable barcode. Without an explicit value we mint an internal EAN-13 from a
   * per-tenant counter, so every dish the till scans has a unique, check-digit-valid code. Existing
   * codes are returned untouched unless the caller explicitly asks to regenerate — silently changing
   * a barcode would orphan every label already stuck on a shelf.
   */
  async generateItemBarcode(itemId: string, dto: GenerateBarcodeDto = {}) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, barcode FROM restaurant_menu_item WHERE id=$1 AND deleted_at IS NULL`,
        [itemId],
      )) as Row[];
      const item = rows[0];
      if (!item) throw new NotFoundException('Menu item not found');

      const existing = (item.barcode as string) ?? null;
      if (existing && !dto.regenerate && !dto.value) {
        return { itemId, name: item.name, barcode: existing, symbology: symbologyFor(existing), generated: false };
      }

      let barcode: string;
      if (dto.value) {
        barcode = String(dto.value).trim();
        // A caller-supplied 13-digit code is meant to be a real EAN; a bad check digit means a label
        // that fails at the till, so reject it here rather than at the counter.
        if (/^\d{13}$/.test(barcode) && !isValidEan13(barcode)) {
          throw new BadRequestException(`"${barcode}" has an invalid EAN-13 check digit`);
        }
      } else {
        barcode = await this.mintEan13(m, dto.prefix);
      }

      try {
        const upd = rowsOf(await m.query(
          `UPDATE restaurant_menu_item SET barcode=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
          [itemId, barcode],
        ));
        if (!upd[0]) throw new NotFoundException('Menu item not found');
      } catch (err) {
        if (isUnique(err)) throw new BadRequestException(`Barcode "${barcode}" is already used by another item`);
        throw err;
      }
      return { itemId, name: item.name, barcode, symbology: symbologyFor(barcode), generated: true };
    });
  }

  /**
   * Draw the next internal code from the **tenant-wide** counter. A barcode identifies a physical
   * thing, so it must be unique across modules — a menu item and an inventory product minted from
   * separate counters would collide, and a scanned carton would ring up a dish.
   */
  private async mintEan13(m: Mgr, prefix?: string): Promise<string> {
    return this.minter.mintProductBarcode(m, {
      prefix,
      taken: async (candidate) => {
        const clash = (await m.query(
          `SELECT 1 FROM restaurant_menu_item WHERE barcode=$1 AND deleted_at IS NULL
           UNION ALL
           SELECT 1 FROM inventory_product WHERE barcode=$1 AND deleted_at IS NULL
           LIMIT 1`,
          [candidate],
        )) as Row[];
        return Boolean(clash[0]);
      },
    });
  }

  /** Bulk mint: give every item that lacks a barcode one, for a menu imported without codes. */
  async generateMissingItemBarcodes(prefix?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name FROM restaurant_menu_item WHERE deleted_at IS NULL AND barcode IS NULL ORDER BY name`,
      )) as Row[];
      const issued: Array<{ itemId: string; name: string; barcode: string }> = [];
      for (const r of rows) {
        const barcode = await this.mintEan13(m, prefix);
        await m.query(`UPDATE restaurant_menu_item SET barcode=$2, updated_at=now() WHERE id=$1`, [r.id, barcode]);
        issued.push({ itemId: r.id as string, name: r.name as string, barcode });
      }
      return { issued: issued.length, items: issued };
    });
  }

  // ── Labels ──────────────────────────────────────────────────────────────────────

  /**
   * Queue a printed label. A label printer is preferred; failing that the job goes to the receipt
   * printer, because a table tent printed on till paper still beats no sticker at all.
   */
  async printTableQrLabel(tableId: string, dto: PrintLabelDto = {}) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, code, qr_token, branch_id FROM restaurant_table WHERE id=$1 AND deleted_at IS NULL`,
        [tableId],
      )) as Row[];
      const t = rows[0];
      if (!t) throw new NotFoundException('Table not found');
      // Issue the sticker token on demand: someone printing a table's QR label plainly wants a QR,
      // and making them call another endpoint first is a trap, not a safeguard.
      let token = (t.qr_token as string) ?? null;
      if (!token) {
        token = randomToken();
        await m.query(`UPDATE restaurant_table SET qr_token=$2, updated_at=now() WHERE id=$1`, [tableId, token]);
      }
      const branchId = (t.branch_id as string) ?? null;
      const printer = await this.labelPrinter(m, branchId);
      const doc = buildLabelDoc({
        charsPerLine: printer?.charsPerLine,
        title: `TABLE ${t.code as string}`,
        qr: `mx://table/${token}`,
        caption: dto.caption ?? 'Scan to view the menu & open your tab',
        copies: dto.copies,
      });
      return this.print.enqueueDocInTx(m, {
        branchId, printerId: printer?.id ?? null, kind: 'LABEL', docType: 'TABLE', docId: tableId,
        docNo: t.code as string, copies: dto.copies ?? 1, doc,
      });
    });
  }

  /** A shelf/product label carrying the item's barcode. */
  async printItemBarcodeLabel(itemId: string, dto: PrintLabelDto = {}) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, barcode, base_price_minor, currency FROM restaurant_menu_item WHERE id=$1 AND deleted_at IS NULL`,
        [itemId],
      )) as Row[];
      const it = rows[0];
      if (!it) throw new NotFoundException('Menu item not found');
      const barcode = (it.barcode as string) ?? null;
      if (!barcode) throw new BadRequestException('This item has no barcode yet — generate one first');
      const printer = await this.labelPrinter(m, null);
      const doc = buildLabelDoc({
        charsPerLine: printer?.charsPerLine,
        title: it.name as string,
        barcode,
        symbology: symbologyFor(barcode),
        caption: dto.caption,
        copies: dto.copies,
      });
      return this.print.enqueueDocInTx(m, {
        branchId: null, printerId: printer?.id ?? null, kind: 'LABEL', docType: 'MENU_ITEM', docId: itemId,
        docNo: barcode, copies: dto.copies ?? 1, doc,
      });
    });
  }

  private async labelPrinter(m: Mgr, branchId: string | null) {
    return (
      (await this.printers.routeInTx(m, { branchId, kind: 'LABEL' })) ??
      (await this.printers.routeInTx(m, { branchId, kind: 'RECEIPT' }))
    );
  }

  /** Every table's QR payload in one call — what a "print all stickers" sheet needs. */
  async tableQrSheet(branchId?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.id, t.code, t.qr_token, a.name AS area_name
         FROM restaurant_table t LEFT JOIN restaurant_floor_area a ON a.id = t.area_id
         WHERE t.deleted_at IS NULL AND ($1::uuid IS NULL OR t.branch_id = $1::uuid)
         ORDER BY a.name NULLS FIRST, t.code`,
        [branchId ?? null],
      )) as Row[];
      // Issue a token for any table that has never had one, so the sheet is never half-empty.
      const out: Array<{ tableId: string; code: string; area: string | null; payload: string }> = [];
      for (const r of rows) {
        let token = (r.qr_token as string) ?? null;
        if (!token) {
          token = randomToken();
          await m.query(`UPDATE restaurant_table SET qr_token=$2, updated_at=now() WHERE id=$1`, [r.id, token]);
        }
        out.push({
          tableId: r.id as string, code: r.code as string,
          area: (r.area_name as string) ?? null, payload: `mx://table/${token}`,
        });
      }
      return out;
    });
  }
}

/** Opaque, non-guessable sticker token (mirrors the one issued by the scan service). */
function randomToken(): string {
  return randomBytes(9).toString('base64url');
}
