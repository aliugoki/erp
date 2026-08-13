import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a delivery order is going, recorded on the order itself.
 *
 * `restaurant_delivery` has carried `address`/`geo_lat`/`geo_lng` since the vertical was built, but
 * `restaurant_order` never had anywhere to put them — so a DELIVERY-channel order taken in the
 * customer app or the POS had no destination at all, and `CreateOrderDto` (under a
 * `forbidNonWhitelisted` pipe) rejected any request that tried to send one. The customer app has been
 * catching that 400 and retrying without the address, which is why every delivery order on the live
 * system reads as "somewhere in Lahore".
 *
 * The columns live on the order rather than only on the delivery because the order is where the
 * address is *known* — at checkout, before any delivery job exists — and because a job that fails and
 * is re-dispatched must not lose it. The delivery row still keeps its own copy: it is the rider's
 * working document and may be corrected ("gate is round the back") without rewriting the order.
 */
export class RestaurantDeliveryAddress1727760000000 implements MigrationInterface {
  name = 'RestaurantDeliveryAddress1727760000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "restaurant_order" ADD COLUMN IF NOT EXISTS "delivery_address" text`);
    // Same precision as restaurant_delivery.geo_lat/geo_lng — the pair is copied between them, and a
    // narrower column here would silently round a rider's destination.
    await q.query(`ALTER TABLE "restaurant_order" ADD COLUMN IF NOT EXISTS "delivery_geo_lat" numeric(9,6)`);
    await q.query(`ALTER TABLE "restaurant_order" ADD COLUMN IF NOT EXISTS "delivery_geo_lng" numeric(9,6)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "restaurant_order" DROP COLUMN IF EXISTS "delivery_geo_lng"`);
    await q.query(`ALTER TABLE "restaurant_order" DROP COLUMN IF EXISTS "delivery_geo_lat"`);
    await q.query(`ALTER TABLE "restaurant_order" DROP COLUMN IF EXISTS "delivery_address"`);
  }
}
