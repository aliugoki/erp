import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AppConfig } from '@metaxperts/config';
import { TenantThrottlerGuard } from './tenant-throttler.guard';

/**
 * Per-tenant / per-IP rate limiting (Phase 7.4). In-memory storage (per instance); swap in
 * `@nestjs/throttler-storage-redis` for a shared limit across a horizontally-scaled fleet.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => [
        {
          ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: TenantThrottlerGuard }],
})
export class RateLimitModule {}
