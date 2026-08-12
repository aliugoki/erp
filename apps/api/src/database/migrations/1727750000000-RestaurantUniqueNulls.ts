import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Close the NULL-distinct hole in the station-key and table-code uniqueness rules.
 *
 * `(tenant_id, branch_id, key)` looks like it forbids two stations with the same key, but Postgres
 * treats NULLs as distinct by default — so for a **tenant-wide** row (`branch_id IS NULL`, which is
 * what a single-outlet tenant and a head-office row both use) the index accepted duplicates. The
 * consequences are operational, not cosmetic:
 *
 * - two `GRILL` stations → the KOT builder resolves the station's display name by joining on the key
 *   (`print.service.buildKot`), matches both rows and prints whichever one comes back first, so a
 *   ticket can head the wrong station; a station list also shows the key twice;
 * - two `T2` tables → one physical table appears twice on the floor map and can carry two open tabs,
 *   each with its own QR token, so a waiter and a scanning guest add items to different bills.
 *
 * `uq_restaurant_printer_key` was created with `NULLS NOT DISTINCT` (PG15+) for exactly this reason;
 * these two predate that fix.
 *
 * Because the old index permitted duplicates, a live database may already hold some. Creating the
 * stricter index would then abort the deploy, so each pair is de-duplicated first: the earliest row
 * keeps the key and later ones get a `-dup<n>` suffix (visible to an operator, and never a silent
 * delete — the rows carry orders, tickets and reservations). Only `branch_id IS NULL` rows can be
 * affected; branch-scoped duplicates were already impossible.
 */
export class RestaurantUniqueNulls1727750000000 implements MigrationInterface {
  name = 'RestaurantUniqueNulls1727750000000';

  public async up(q: QueryRunner): Promise<void> {
    await dedupeTenantWide(q, 'restaurant_station', 'key');
    await dedupeTenantWide(q, 'restaurant_table', 'code');

    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_station_key"`);
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_station_key"
      ON "restaurant_station" ("tenant_id","branch_id","key") NULLS NOT DISTINCT
      WHERE "deleted_at" IS NULL`);

    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_table_code"`);
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_table_code"
      ON "restaurant_table" ("tenant_id","branch_id","code") NULLS NOT DISTINCT
      WHERE "deleted_at" IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Back to the permissive form. The renamed rows stay renamed: re-colliding them would be a
    // deliberate step backwards, and the suffixed keys are valid on their own.
    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_station_key"`);
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_station_key"
      ON "restaurant_station" ("tenant_id","branch_id","key") WHERE "deleted_at" IS NULL`);
    await q.query(`DROP INDEX IF EXISTS "uq_restaurant_table_code"`);
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_table_code"
      ON "restaurant_table" ("tenant_id","branch_id","code") WHERE "deleted_at" IS NULL`);
  }
}

/**
 * Suffix the losers of every tenant-wide `(tenant_id, <column>)` collision so the stricter index can
 * be built. Repeats because a suffixed value can itself collide with a row that already carries that
 * name; if it somehow does not converge, the index creation is left to fail loudly rather than the
 * migration papering over data it does not understand.
 */
async function dedupeTenantWide(q: QueryRunner, table: string, column: string): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    // Counted with a SELECT rather than `UPDATE … RETURNING`, whose result shape through the pg
    // driver is `[rows, rowCount]` — a length check on it would be a check on the wrapper, not the
    // rows, and the loop would always run to its limit.
    const [{ n }] = (await q.query(`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM "${table}"
         WHERE "deleted_at" IS NULL AND "branch_id" IS NULL
         GROUP BY "tenant_id", "${column}" HAVING count(*) > 1
      ) d
    `)) as [{ n: number }];
    if (n === 0) return;

    await q.query(`
      WITH ranked AS (
        SELECT "id", row_number() OVER (
                 PARTITION BY "tenant_id", "${column}" ORDER BY "created_at", "id"
               ) AS rn
        FROM "${table}"
        WHERE "deleted_at" IS NULL AND "branch_id" IS NULL
      )
      UPDATE "${table}" t
         SET "${column}" = t."${column}" || '-dup' || r.rn, "updated_at" = now()
        FROM ranked r
       WHERE r."id" = t."id" AND r.rn > 1
    `);
  }
}
