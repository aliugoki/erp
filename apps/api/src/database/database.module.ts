import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '@metaxperts/config';

/**
 * TypeORM + Postgres, wired through PgBouncer (transaction pool mode).
 *
 * - `synchronize: false` always (ADR-003) — schema changes are migrations only.
 * - Migrations are NOT auto-run at boot; run them explicitly via the CLI (`migration:run`).
 * - `autoLoadEntities` lets feature modules register their entities with `TypeOrmModule.forFeature`.
 * - PgBouncer transaction pooling: keep parameterized (unnamed) statements; no session-pinned state.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        synchronize: false,
        autoLoadEntities: true,
        migrationsRun: false,
        migrationsTableName: 'migrations',
        retryAttempts: 5,
        retryDelay: 2000,
        // Bounded pool so a stalled DB can't exhaust connections (resilience comes fully in Phase 7).
        extra: {
          max: 20,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
