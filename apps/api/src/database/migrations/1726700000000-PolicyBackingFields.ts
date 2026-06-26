import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backing fields that let two more policies (ADR-011) be enforced:
 *  - `vendor_bill.po_ref` — the purchase-order reference required by `finance.require_po_for_bill`.
 *  - `sales_*_line.discount_percent` — per-line discount % capped by `crm.discount_cap_percent`
 *    (also folds into the line total). Default 0 so existing rows/behaviour are unchanged.
 */
export class PolicyBackingFields1726700000000 implements MigrationInterface {
  name = 'PolicyBackingFields1726700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill" ADD COLUMN IF NOT EXISTS "po_ref" text`);
    await q.query(`ALTER TABLE "sales_quotation_line" ADD COLUMN IF NOT EXISTS "discount_percent" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "sales_so_line" ADD COLUMN IF NOT EXISTS "discount_percent" integer NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "vendor_bill" DROP COLUMN IF EXISTS "po_ref"`);
    await q.query(`ALTER TABLE "sales_quotation_line" DROP COLUMN IF EXISTS "discount_percent"`);
    await q.query(`ALTER TABLE "sales_so_line" DROP COLUMN IF EXISTS "discount_percent"`);
  }
}
