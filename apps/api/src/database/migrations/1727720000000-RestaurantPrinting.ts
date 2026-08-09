import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Restaurant vertical — peripherals (ADR-011 §9): thermal receipt printers and barcode/QR scanning.
 *
 * Printing is modelled as a **spool**, not a socket the API holds open. The API renders a document and
 * queues a `restaurant_print_job`; a local print agent (or the browser/app that owns the USB device)
 * claims jobs for its printer and pushes the bytes. That keeps a cloud API off the restaurant LAN,
 * survives an offline printer (the job simply stays QUEUED and retries), and gives an audit trail of
 * what was printed for which bill — required when a KOT or a fiscal receipt is disputed.
 *
 * Scanning needs no table of its own: it resolves a scanned string against codes that already exist
 * (order_no, ticket_no, reservation checkin_code, delivery no) plus two new ones added here — a menu
 * item `barcode` (packaged goods scanned straight into the POS cart) and a per-table `qr_token`
 * (the QR sticker a guest scans to open that table's menu/order).
 */
export class RestaurantPrinting1727720000000 implements MigrationInterface {
  name = 'RestaurantPrinting1727720000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) => q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fk = (t: string, col: string, parent: string, onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "${parent}"("tenant_id","id") ON DELETE ${onDelete}`);

    // ── Printers (one row per physical device, scoped to a branch) ─────────────────
    // `kind` decides what gets routed here: RECEIPT = the guest bill at the till, KITCHEN = station
    // KOTs (bound to `station_key`), LABEL = sticker printers for delivery/takeaway bags, REPORT = the
    // end-of-shift Z report. `connection` tells the agent HOW to reach it; the API never dials it.
    await q.query(
      createTenantTableSql('restaurant_printer', [
        '"branch_id" uuid',
        '"key" text NOT NULL',
        '"name" text NOT NULL',
        `"kind" text NOT NULL DEFAULT 'RECEIPT'`,
        `"connection" text NOT NULL DEFAULT 'NETWORK'`,
        '"host" text',
        '"port" integer NOT NULL DEFAULT 9100',
        '"device_path" text',
        '"station_key" text',
        '"chars_per_line" integer NOT NULL DEFAULT 42',
        `"codepage" text NOT NULL DEFAULT 'CP437'`,
        '"copies" integer NOT NULL DEFAULT 1',
        '"cut" boolean NOT NULL DEFAULT true',
        '"cash_drawer" boolean NOT NULL DEFAULT false',
        '"is_default" boolean NOT NULL DEFAULT false',
        '"active" boolean NOT NULL DEFAULT true',
        '"last_seen_at" timestamptz',
      ]),
    );
    await uq('restaurant_printer');
    // NULLS NOT DISTINCT (PG15+) is essential here: a tenant-wide printer has branch_id NULL, and the
    // default NULL-distinct behaviour would happily accept two devices with the same key — which the
    // print agent resolves by key, so it would then serve an ambiguous printer.
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_printer_key" ON "restaurant_printer" ("tenant_id","branch_id","key") NULLS NOT DISTINCT WHERE "deleted_at" IS NULL`);
    await q.query(`CREATE INDEX "ix_restaurant_printer_route" ON "restaurant_printer" ("tenant_id","branch_id","kind","station_key")`);
    await q.query(`ALTER TABLE "restaurant_printer" ADD CONSTRAINT "ck_restaurant_printer_kind"
      CHECK ("kind" IN ('RECEIPT','KITCHEN','LABEL','REPORT'))`);
    await q.query(`ALTER TABLE "restaurant_printer" ADD CONSTRAINT "ck_restaurant_printer_conn"
      CHECK ("connection" IN ('NETWORK','USB','BLUETOOTH','BROWSER','CLOUD'))`);

    // ── Print job spool ───────────────────────────────────────────────────────────
    // `doc` is the rendered document model (blocks: text/rows/rules/QR/barcode/cut), NOT device bytes —
    // so the same job can be emitted as ESC/POS for a thermal head or as plain text for a preview, and
    // a paper-width change re-renders correctly. QUEUED → CLAIMED → PRINTED, or FAILED (retryable).
    await q.query(
      createTenantTableSql('restaurant_print_job', [
        '"branch_id" uuid',
        '"printer_id" uuid',
        `"kind" text NOT NULL DEFAULT 'RECEIPT'`,
        '"doc_type" text',
        '"doc_id" uuid',
        '"doc_no" text',
        '"station_key" text',
        `"status" text NOT NULL DEFAULT 'QUEUED'`,
        '"copies" integer NOT NULL DEFAULT 1',
        '"attempts" integer NOT NULL DEFAULT 0',
        '"doc" jsonb NOT NULL',
        '"claimed_at" timestamptz',
        '"claimed_by" text',
        '"printed_at" timestamptz',
        '"error" text',
      ]),
    );
    await uq('restaurant_print_job');
    await fk('restaurant_print_job', 'printer_id', 'restaurant_printer', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_print_job_queue" ON "restaurant_print_job" ("tenant_id","printer_id","status","created_at")`);
    await q.query(`CREATE INDEX "ix_restaurant_print_job_doc" ON "restaurant_print_job" ("tenant_id","doc_type","doc_id")`);
    await q.query(`ALTER TABLE "restaurant_print_job" ADD CONSTRAINT "ck_restaurant_print_job_kind"
      CHECK ("kind" IN ('RECEIPT','KOT','BILL_PREVIEW','LABEL','TEST','REPORT'))`);
    await q.query(`ALTER TABLE "restaurant_print_job" ADD CONSTRAINT "ck_restaurant_print_job_status"
      CHECK ("status" IN ('QUEUED','CLAIMED','PRINTED','FAILED','CANCELLED'))`);

    // ── Scanning + receipt-branding columns on existing tables ────────────────────
    // Menu items get a scannable barcode (bottled drinks, packaged desserts, retail add-ons); the POS
    // scan-to-add path looks up barcode first, then sku.
    await q.query(`ALTER TABLE "restaurant_menu_item" ADD COLUMN IF NOT EXISTS "barcode" text`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_restaurant_menu_item_barcode"
      ON "restaurant_menu_item" ("tenant_id", lower("barcode")) WHERE "barcode" IS NOT NULL AND "deleted_at" IS NULL`);

    // Per-table QR token — the sticker a guest scans to open that table (opaque, rotatable, so a
    // photographed sticker can be invalidated without reprinting the table code).
    await q.query(`ALTER TABLE "restaurant_table" ADD COLUMN IF NOT EXISTS "qr_token" text`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_restaurant_table_qr_token"
      ON "restaurant_table" ("tenant_id","qr_token") WHERE "qr_token" IS NOT NULL AND "deleted_at" IS NULL`);

    // Receipt branding + auto-print behaviour live with the rest of the per-branch config.
    for (const col of [
      '"auto_print_kot" boolean NOT NULL DEFAULT true',
      '"auto_print_bill" boolean NOT NULL DEFAULT false',
      '"receipt_header" text',
      '"receipt_footer" text',
      '"receipt_show_qr" boolean NOT NULL DEFAULT true',
      '"tax_number" text',
    ]) {
      await q.query(`ALTER TABLE "restaurant_config" ADD COLUMN IF NOT EXISTS ${col}`);
    }

    for (const t of ['restaurant_printer', 'restaurant_print_job']) {
      for (const stmt of enableTenantRlsSql(t)) await q.query(stmt);
      await q.query(grantAppUserSql(t));
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "restaurant_print_job" CASCADE`);
    await q.query(`DROP TABLE IF EXISTS "restaurant_printer" CASCADE`);
    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_menu_item_barcode"`);
    await q.query(`ALTER TABLE "restaurant_menu_item" DROP COLUMN IF EXISTS "barcode"`);
    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_table_qr_token"`);
    await q.query(`ALTER TABLE "restaurant_table" DROP COLUMN IF EXISTS "qr_token"`);
    for (const col of ['auto_print_kot', 'auto_print_bill', 'receipt_header', 'receipt_footer', 'receipt_show_qr', 'tax_number']) {
      await q.query(`ALTER TABLE "restaurant_config" DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
