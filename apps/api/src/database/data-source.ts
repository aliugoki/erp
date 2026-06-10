import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { loadConfig } from '@metaxperts/config';

// The migration CLI runs this file outside Nest, so load .env ourselves before validating config.
// Try the package dir, then the repo root (relative to cwd and to this file).
for (const candidate of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../../../.env'),
]) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
}

/**
 * Standalone TypeORM DataSource for the migration CLI (`pnpm --filter @app/api migration:*`).
 *
 * Migrations connect DIRECTLY to Postgres (MIGRATION_DATABASE_URL), bypassing PgBouncer's
 * transaction pooler — DDL and the migrations table want a stable session. The running app, by
 * contrast, connects through PgBouncer (see database.module.ts). `synchronize` is NEVER true
 * (ADR-003): every schema change is a reviewed migration.
 */
const config = loadConfig();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.MIGRATION_DATABASE_URL ?? config.DATABASE_URL,
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsTableName: 'migrations',
});

export default AppDataSource;
