import { Global, Inject, Module, type OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfig } from '@metaxperts/config';

/** DI token for the shared ioredis client. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Provides a single shared Redis connection (cache, queues, refresh-token store in later phases).
 * Fails fast on commands when Redis is unreachable (no infinite offline queue) so readiness can
 * report 503 rather than hang. The connection is closed on graceful shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 3000,
          lazyConnect: false,
          retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 1500)),
        });
        // Must have an error listener or ioredis throws unhandled — log and let readiness report it.
        client.on('error', (err) => logger.warn(`Redis connection error: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // Best-effort graceful close; ignore errors if already disconnected.
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
