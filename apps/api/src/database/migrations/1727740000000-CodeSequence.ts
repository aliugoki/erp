import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * One tenant-wide counter for **internally minted scannable codes**.
 *
 * Modules were minting internal EAN-13s from their own per-module counters (`restaurant_doc_seq`,
 * `inventory_doc_seq`), and both start at 1 — so a menu item and an ingredient could be issued the
 * *same* barcode. A scan then resolves to whichever catalogue is checked first: scanning a carton of
 * beef in the store rings up a chicken dish. A barcode is a physical, cross-module identity, so the
 * counter behind it has to be cross-module too.
 *
 * Keyed by `kind` so future code families (asset tags, pallet labels) get their own run without
 * colliding with product barcodes.
 */
export class CodeSequence1727740000000 implements MigrationInterface {
  name = 'CodeSequence1727740000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "code_seq" (
        "tenant_id" uuid NOT NULL,
        "kind" text NOT NULL,
        "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id", "kind")
      )
    `);
    for (const stmt of enableTenantRlsSql('code_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('code_seq'));

    // Start the shared counter above whatever the per-module counters already issued, so codes minted
    // from here can never repeat one that is already printed on a shelf.
    await q.query(`
      INSERT INTO "code_seq" ("tenant_id", "kind", "last_no")
      SELECT t.tenant_id, 'PRODUCT_BARCODE', max(t.last_no)
      FROM (
        SELECT tenant_id, last_no FROM "restaurant_doc_seq" WHERE doc_type = 'BARCODE'
        UNION ALL
        SELECT tenant_id, last_no FROM "inventory_doc_seq" WHERE doc_type = 'BARCODE'
      ) t
      GROUP BY t.tenant_id
      ON CONFLICT ("tenant_id", "kind") DO UPDATE SET "last_no" = GREATEST("code_seq"."last_no", EXCLUDED."last_no")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "code_seq" CASCADE`);
  }
}
