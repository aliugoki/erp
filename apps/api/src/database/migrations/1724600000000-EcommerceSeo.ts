import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-product SEO metadata for the storefront — an optional search/share title + description used to
 * render server-side <title>/<meta>/OpenGraph tags and the sitemap. Falls back to the product title /
 * subtitle when unset. Additive columns only.
 */
export class EcommerceSeo1724600000000 implements MigrationInterface {
  name = 'EcommerceSeo1724600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ec_product" ADD COLUMN IF NOT EXISTS "seo_title" text`);
    await q.query(`ALTER TABLE "ec_product" ADD COLUMN IF NOT EXISTS "seo_description" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ec_product" DROP COLUMN IF EXISTS "seo_description"`);
    await q.query(`ALTER TABLE "ec_product" DROP COLUMN IF EXISTS "seo_title"`);
  }
}
