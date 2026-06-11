import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createTenantTableSql, enableTenantRlsSql, grantAppUserSql } from '../sql/tenancy.sql';

/**
 * Vector store for semantic search (Chunk 6.4). Enables the pgvector `vector` extension and a
 * tenant-scoped (RLS) `ml_embedding` table: the ML service embeds a document's text (sentence
 * transformer, 384-dim) and stores it here; `POST /ml/search` queries by cosine distance. Tenant
 * isolation is enforced by RLS (the search filters by `app.tenant_id` / explicit tenant) so one
 * tenant can never retrieve another's vectors.
 */
export class MlEmbeddings1719600000000 implements MigrationInterface {
  name = 'MlEmbeddings1719600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await q.query(
      createTenantTableSql('ml_embedding', [
        '"module" text NOT NULL',
        '"ref_id" uuid NOT NULL',
        '"content" text NOT NULL',
        '"embedding" vector(384) NOT NULL',
      ]),
    );
    await q.query(`CREATE UNIQUE INDEX "uq_ml_embedding" ON "ml_embedding" ("tenant_id", "module", "ref_id")`);
    // Btree to narrow to a tenant+module before the (exact) cosine sort. We deliberately use EXACT
    // KNN rather than an ivfflat/hnsw ANN index: per-tenant vector counts at ERP scale are modest, and
    // exact search is both correct (no recall loss) and avoids ANN's poor recall on small, filtered
    // sets. Swap in an ANN index here if a tenant's corpus ever grows enough to need it.
    await q.query(`CREATE INDEX "ix_ml_embedding_scope" ON "ml_embedding" ("tenant_id", "module")`);

    for (const stmt of enableTenantRlsSql('ml_embedding')) await q.query(stmt);
    await q.query(grantAppUserSql('ml_embedding'));
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ml_embedding" CASCADE`);
    // Leave the extension installed (other objects may use it); dropping is intentionally omitted.
  }
}
