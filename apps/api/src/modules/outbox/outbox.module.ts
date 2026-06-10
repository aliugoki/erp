import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AppConfig } from '@metaxperts/config';
import { OutboxService } from './outbox.service';
import { PUBLISHER } from './relay/publisher';
import { OutboxRelay, RELAY_DATA_SOURCE } from './relay/outbox-relay.service';
import { OutboxRelayScheduler } from './relay/outbox-relay.scheduler';
import { RabbitMqPublisher } from '../eventbus/rabbitmq.publisher';

/**
 * Outbox + relay (ADR-004). `OutboxService` writes events inside business transactions; the relay
 * publishes them. The relay uses a PRIVILEGED DataSource (owner connection, direct to Postgres) so it
 * can see every tenant's pending events — the app role is RLS-restricted. The connection is only
 * opened when the relay is enabled.
 */
@Global()
@Module({
  providers: [
    OutboxService,
    // The relay publishes through the RabbitMQ EventBus (provided globally by EventBusModule).
    { provide: PUBLISHER, useExisting: RabbitMqPublisher },
    {
      provide: RELAY_DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>) => {
        const ds = new DataSource({
          type: 'postgres',
          url: config.get('MIGRATION_DATABASE_URL', { infer: true }) ?? config.get('DATABASE_URL', { infer: true }),
          synchronize: false,
          logging: false,
          extra: { max: 4 },
        });
        if (config.get('OUTBOX_RELAY_ENABLED', { infer: true })) await ds.initialize();
        return ds;
      },
    },
    OutboxRelay,
    OutboxRelayScheduler,
  ],
  exports: [OutboxService, OutboxRelay],
})
export class OutboxModule implements OnModuleDestroy {
  constructor(@Inject(RELAY_DATA_SOURCE) private readonly relayDs: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.relayDs.isInitialized) await this.relayDs.destroy();
  }
}
