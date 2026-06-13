import type { MigrationInterface, QueryRunner } from 'typeorm';
import { enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Voucher types + the 4-level chart-of-accounts depth marker.
 *
 * - `finance_account.level` (1..4) records the account's depth so the service can cap the tree at the
 *   classic 4 levels (Main head → Control → Subsidiary → Detail). Backfilled from the parent chain.
 * - `finance_transaction.voucher_type` (BRV/BPV/CPV/CRV/JV) classifies each entry, and `voucher_no`
 *   is a per-tenant, per-type running number (e.g. BRV-000001), allocated from `finance_voucher_seq`.
 *
 * Idempotent: columns/tables guarded with IF [NOT] EXISTS, the CHECK constraint with a catalog guard,
 * and every backfill only touches NULLs (or upserts with GREATEST), so a second run is a no-op.
 */
export class FinanceVouchersAndLevels1720100000000 implements MigrationInterface {
  name = 'FinanceVouchersAndLevels1720100000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Account depth (4-level chart of accounts) ──────────────────────────────
    await q.query(`ALTER TABLE "finance_account" ADD COLUMN IF NOT EXISTS "level" int NOT NULL DEFAULT 1`);
    // Backfill the depth of every account from its parent chain (runs as owner → all tenants).
    await q.query(`
      WITH RECURSIVE chain AS (
        SELECT id, 1 AS lvl FROM finance_account WHERE parent_id IS NULL
        UNION ALL
        SELECT c.id, t.lvl + 1 FROM finance_account c JOIN chain t ON c.parent_id = t.id
      )
      UPDATE finance_account a SET level = chain.lvl FROM chain WHERE a.id = chain.id AND a.level <> chain.lvl
    `);

    // ── Voucher type + number on the transaction header ────────────────────────
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "voucher_type" text NOT NULL DEFAULT 'JV'`);
    await q.query(`ALTER TABLE "finance_transaction" ADD COLUMN IF NOT EXISTS "voucher_no" text`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_txn_voucher_type') THEN
          ALTER TABLE "finance_transaction" ADD CONSTRAINT "ck_finance_txn_voucher_type"
            CHECK ("voucher_type" IN ('BRV','BPV','CPV','CRV','JV'));
        END IF;
      END $$;
    `);

    // ── Per-tenant, per-type voucher counter ───────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS "finance_voucher_seq" (
        "tenant_id" uuid NOT NULL,
        "voucher_type" text NOT NULL,
        "last_no" bigint NOT NULL DEFAULT 0,
        PRIMARY KEY ("tenant_id", "voucher_type")
      )
    `);
    for (const stmt of enableTenantRlsSql('finance_voucher_seq')) await q.query(stmt);
    await q.query(grantAppUserSql('finance_voucher_seq'));

    // Backfill existing transactions: number them per (tenant, type) by creation order, then seed seq.
    await q.query(`
      WITH numbered AS (
        SELECT id, tenant_id, voucher_type,
               row_number() OVER (PARTITION BY tenant_id, voucher_type ORDER BY created_at, id) AS rn
          FROM finance_transaction
         WHERE voucher_no IS NULL
      )
      UPDATE finance_transaction t
         SET voucher_no = n.voucher_type || '-' || lpad(n.rn::text, 6, '0')
        FROM numbered n
       WHERE t.id = n.id
    `);
    await q.query(`
      INSERT INTO "finance_voucher_seq" ("tenant_id", "voucher_type", "last_no")
      SELECT tenant_id, voucher_type, count(*) FROM finance_transaction GROUP BY tenant_id, voucher_type
      ON CONFLICT ("tenant_id", "voucher_type")
        DO UPDATE SET "last_no" = GREATEST("finance_voucher_seq"."last_no", EXCLUDED."last_no")
    `);

    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_finance_txn_voucher_no" ON "finance_transaction" ("tenant_id","voucher_no") WHERE "voucher_no" IS NOT NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "ix_finance_txn_voucher_type" ON "finance_transaction" ("tenant_id","voucher_type")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_finance_txn_voucher_type"`);
    await q.query(`DROP INDEX IF EXISTS "uq_finance_txn_voucher_no"`);
    for (const stmt of disableRls('finance_voucher_seq')) await q.query(stmt);
    await q.query(`DROP TABLE IF EXISTS "finance_voucher_seq"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP CONSTRAINT IF EXISTS "ck_finance_txn_voucher_type"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "voucher_no"`);
    await q.query(`ALTER TABLE "finance_transaction" DROP COLUMN IF EXISTS "voucher_type"`);
    await q.query(`ALTER TABLE "finance_account" DROP COLUMN IF EXISTS "level"`);
  }
}

function disableRls(table: string): string[] {
  const policy = `${table}_tenant_isolation`;
  return [
    `DROP POLICY IF EXISTS "${policy}" ON "${table}"`,
    `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
  ];
}
