import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, disableTenantRlsSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Riders and customers as first-class records, and the two foreign keys that were missing under them.
 *
 * `restaurant_delivery.driver_employee_id` and `restaurant_order.customer_id` were bare `uuid`
 * columns with no FK and no table behind them. Nothing validated either one, which is why dispatch
 * asked a human to type a driver UUID into a text box, and why `customer_id` is NULL on every order
 * ever placed — the customer app had no customer to point at. Two consequences this migration exists
 * to end: a rider could not be told apart from any other employee, and a returning customer could not
 * be recognised at all.
 *
 * **`restaurant_driver`** is a rider's operational record, deliberately not a synonym for
 * `hr_employee`. `employee_id` is nullable because delivery riders are very often contractors on a
 * per-run fee rather than salaried staff, and forcing an HR row for each would either corrupt
 * headcount or block the rider from being dispatched. When the link is present, payroll and
 * attendance work off it as normal. `user_id` links the login the rider signs into the app with, and
 * is what finally lets a rider's board be scoped to their own runs.
 *
 * **`restaurant_customer`** is keyed on phone, not email: a Pakistani delivery customer has a phone
 * number and frequently no email, and the phone is what the rider calls from the gate. It is stored
 * normalised (digits, `+` prefix) so `0300 123 4567`, `+92 300 1234567` and `03001234567` are one
 * customer rather than three — the uniqueness is enforced on that normalised form.
 *
 * `restaurant_customer_otp` is a login artefact, not customer data: rows are short-lived, the code is
 * stored as a SHA-256 hash so a database leak is not a pile of live login codes, and `attempts` caps
 * brute force on a six-digit secret.
 *
 * The `users` composite unique is added here because the ERP's cross-tenant-FK-impossible pattern
 * (`FOREIGN KEY (tenant_id, col) REFERENCES parent(tenant_id, id)`) needs one on `users`, and the
 * table predates that convention. It cannot fail on live data: `id` is already the primary key, so
 * `(tenant_id, id)` is unique by construction.
 */
export class RestaurantDriverCustomer1727770000000 implements MigrationInterface {
  name = 'RestaurantDriverCustomer1727770000000';

  public async up(q: QueryRunner): Promise<void> {
    const uq = (t: string) =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "uq_${t}_tenant_id" UNIQUE ("tenant_id","id")`);
    const fk = (t: string, col: string, parent: string, onDelete = 'RESTRICT') =>
      q.query(`ALTER TABLE "${t}" ADD CONSTRAINT "fk_${t}_${col}"
        FOREIGN KEY ("tenant_id","${col}") REFERENCES "${parent}"("tenant_id","id") ON DELETE ${onDelete}`);
    const rls = async (t: string) => {
      for (const sql of enableTenantRlsSql(t)) await q.query(sql);
      await q.query(grantAppUserSql(t));
    };

    // `users` predates the composite-FK convention; everything below references it.
    await q.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_tenant_id"`);
    await uq('users');

    // ── Riders ───────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_driver', [
        '"branch_id" uuid',
        '"driver_code" text NOT NULL',
        '"display_name" text NOT NULL',
        '"phone" text',
        // Nullable on purpose — see the class comment. A contractor rider has no HR row.
        '"employee_id" uuid',
        // The login the rider uses in the driver app. Nullable so a rider can be rostered and
        // dispatched before IT has issued them an account.
        '"user_id" uuid',
        `"vehicle_type" text NOT NULL DEFAULT 'BIKE'`,
        '"vehicle_plate" text',
        `"duty_status" text NOT NULL DEFAULT 'OFF_DUTY'`,
        // How many runs this rider may hold at once. Stacking two or three nearby drops is normal
        // practice for a bike rider and is how a kitchen clears a rush; 1 is the safe default.
        '"max_concurrent_runs" integer NOT NULL DEFAULT 1',
        '"active" boolean NOT NULL DEFAULT true',
        // Last known position + heartbeat, fed by the driver app's existing GPS pings. Drives the
        // "who is actually out there" column on the roster.
        '"geo_lat" numeric(9,6)',
        '"geo_lng" numeric(9,6)',
        '"last_seen_at" timestamptz',
        '"on_duty_since" timestamptz',
      ]),
    );
    await uq('restaurant_driver');
    await fk('restaurant_driver', 'employee_id', 'hr_employee', 'SET NULL');
    await fk('restaurant_driver', 'user_id', 'users', 'SET NULL');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_driver_code"
      ON "restaurant_driver" ("tenant_id", lower("driver_code")) WHERE "deleted_at" IS NULL`);
    // One rider record per login. Two would make "my runs" ambiguous — the app would have to guess
    // which rider the signed-in human is.
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_driver_user"
      ON "restaurant_driver" ("tenant_id","user_id") WHERE "user_id" IS NOT NULL AND "deleted_at" IS NULL`);
    await q.query(`CREATE INDEX "ix_restaurant_driver_duty"
      ON "restaurant_driver" ("tenant_id","branch_id","duty_status") WHERE "deleted_at" IS NULL`);
    await q.query(`ALTER TABLE "restaurant_driver" ADD CONSTRAINT "ck_restaurant_driver_duty"
      CHECK ("duty_status" IN ('OFF_DUTY','AVAILABLE','ON_RUN'))`);
    await q.query(`ALTER TABLE "restaurant_driver" ADD CONSTRAINT "ck_restaurant_driver_vehicle"
      CHECK ("vehicle_type" IN ('BIKE','SCOOTER','BICYCLE','CAR','VAN','ON_FOOT'))`);
    await q.query(`ALTER TABLE "restaurant_driver" ADD CONSTRAINT "ck_restaurant_driver_capacity"
      CHECK ("max_concurrent_runs" BETWEEN 1 AND 10)`);
    await rls('restaurant_driver');

    // ── Customers ────────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_customer', [
        // Normalised at write time (digits + leading '+'), which is what the unique index keys on.
        '"phone" text NOT NULL',
        '"name" text',
        '"email" text',
        '"marketing_opt_in" boolean NOT NULL DEFAULT false',
        // A counter's only defence against a serial prank-orderer. Blocked customers can sign in and
        // read their history but cannot place an order.
        '"blocked" boolean NOT NULL DEFAULT false',
        '"blocked_reason" text',
        '"notes" text',
        '"last_order_at" timestamptz',
        '"last_login_at" timestamptz',
      ]),
    );
    await uq('restaurant_customer');
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_customer_phone"
      ON "restaurant_customer" ("tenant_id","phone") WHERE "deleted_at" IS NULL`);
    await rls('restaurant_customer');

    await q.query(
      createTenantTableSql('restaurant_customer_address', [
        '"customer_id" uuid NOT NULL',
        `"label" text NOT NULL DEFAULT 'HOME'`,
        '"address" text NOT NULL',
        '"geo_lat" numeric(9,6)',
        '"geo_lng" numeric(9,6)',
        // "White gate opposite the pharmacy, ring twice." The difference between a delivered order
        // and a rider circling a block for ten minutes.
        '"directions" text',
        '"is_default" boolean NOT NULL DEFAULT false',
      ]),
    );
    await uq('restaurant_customer_address');
    await fk('restaurant_customer_address', 'customer_id', 'restaurant_customer', 'CASCADE');
    await q.query(`CREATE INDEX "ix_restaurant_customer_address_customer"
      ON "restaurant_customer_address" ("tenant_id","customer_id") WHERE "deleted_at" IS NULL`);
    // At most one default per customer — two would make "deliver to my usual address" a coin toss.
    await q.query(`CREATE UNIQUE INDEX "uq_restaurant_customer_address_default"
      ON "restaurant_customer_address" ("tenant_id","customer_id")
      WHERE "is_default" AND "deleted_at" IS NULL`);
    await rls('restaurant_customer_address');

    // ── Login codes ──────────────────────────────────────────────────────────────
    await q.query(
      createTenantTableSql('restaurant_customer_otp', [
        '"phone" text NOT NULL',
        // SHA-256 of the code. A dump of this table is not a list of live login codes.
        '"code_hash" text NOT NULL',
        '"expires_at" timestamptz NOT NULL',
        '"attempts" integer NOT NULL DEFAULT 0',
        '"consumed_at" timestamptz',
        '"requested_ip" text',
      ]),
    );
    await uq('restaurant_customer_otp');
    await q.query(`CREATE INDEX "ix_restaurant_customer_otp_phone"
      ON "restaurant_customer_otp" ("tenant_id","phone","created_at")`);
    await rls('restaurant_customer_otp');

    // ── The two missing links ────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "restaurant_delivery" ADD COLUMN IF NOT EXISTS "driver_id" uuid`);
    await fk('restaurant_delivery', 'driver_id', 'restaurant_driver', 'SET NULL');
    await q.query(`CREATE INDEX "ix_restaurant_delivery_driver"
      ON "restaurant_delivery" ("tenant_id","driver_id","status") WHERE "deleted_at" IS NULL`);

    // Safe to constrain: customer_id is NULL on every existing order, precisely because nothing
    // could ever populate it.
    await fk('restaurant_order', 'customer_id', 'restaurant_customer', 'SET NULL');
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "restaurant_order" DROP CONSTRAINT IF EXISTS "fk_restaurant_order_customer_id"`);
    await q.query(`DROP INDEX IF EXISTS "ix_restaurant_delivery_driver"`);
    await q.query(`ALTER TABLE "restaurant_delivery" DROP CONSTRAINT IF EXISTS "fk_restaurant_delivery_driver_id"`);
    await q.query(`ALTER TABLE "restaurant_delivery" DROP COLUMN IF EXISTS "driver_id"`);

    for (const t of ['restaurant_customer_otp', 'restaurant_customer_address', 'restaurant_customer', 'restaurant_driver']) {
      for (const sql of disableTenantRlsSql(t)) await q.query(sql);
      await q.query(`DROP TABLE IF EXISTS "${t}"`);
    }
    await q.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_users_tenant_id"`);
  }
}
