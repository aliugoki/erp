import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { type BaseEvent, EVENT_DOMAINS, domainOf } from '@metaxperts/shared';
import type { AppConfig } from '@metaxperts/config';

export interface SubscribeOptions {
  /** Queue name; defaults to the routing key. */
  queue?: string;
  /** Consumer concurrency cap (channel prefetch). */
  prefetch?: number;
  /** Persist the queue across broker restarts (default true). */
  durable?: boolean;
  /** Delete the queue when its last consumer goes away (default false). */
  autoDelete?: boolean;
  /** Restrict the queue to this connection and delete on close (default false; handy for tests). */
  exclusive?: boolean;
}

/**
 * Typed publish/subscribe over RabbitMQ (ADR-004). Topology: one durable TOPIC exchange per domain
 * (hr/finance/inventory/crm/notifications); the routing key is the full versioned event type. The
 * connection is resilient — it reconnects, and a publish before connect lazily connects. Messages are
 * persistent so a broker restart doesn't lose them.
 */
@Injectable()
export class EventBusService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly url: string;
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private connecting?: Promise<void>;

  constructor(config: ConfigService<AppConfig, true>) {
    this.url = config.get('RABBITMQ_URL', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.connect().catch((e) => this.logger.warn(`EventBus initial connect failed: ${(e as Error).message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async connect(): Promise<void> {
    if (this.channel) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      this.connection = await amqp.connect(this.url);
      this.connection.on('error', (e) => this.logger.warn(`RabbitMQ connection error: ${e.message}`));
      this.connection.on('close', () => {
        this.channel = undefined;
        this.connection = undefined;
      });
      this.channel = await this.connection.createChannel();
      for (const domain of EVENT_DOMAINS) {
        await this.channel.assertExchange(domain, 'topic', { durable: true });
      }
      this.logger.log('EventBus connected; domain exchanges asserted');
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async ensureChannel(): Promise<amqp.Channel> {
    if (!this.channel) await this.connect();
    if (!this.channel) throw new Error('EventBus is not connected');
    return this.channel;
  }

  /** The live channel (connecting if needed) — for consumers that build their own retry/DLQ topology. */
  getChannel(): Promise<amqp.Channel> {
    return this.ensureChannel();
  }

  /** Publish a domain event to its domain exchange, keyed by the full event type. */
  async publish(event: BaseEvent): Promise<void> {
    const channel = await this.ensureChannel();
    const domain = domainOf(event.type);
    channel.publish(domain, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      messageId: event.id,
      contentType: 'application/json',
      headers: { tenantId: event.tenantId, eventType: event.type },
    });
  }

  /** Bind a durable queue to a domain exchange for a routing key and consume it. Returns the tag. */
  async subscribe(
    type: string,
    handler: (event: BaseEvent) => Promise<void> | void,
    opts: SubscribeOptions = {},
  ): Promise<string> {
    const channel = await this.ensureChannel();
    const domain = domainOf(type);
    const queue = opts.queue ?? type;
    await channel.assertQueue(queue, {
      durable: opts.durable ?? true,
      autoDelete: opts.autoDelete ?? false,
      exclusive: opts.exclusive ?? false,
    });
    await channel.bindQueue(queue, domain, type);
    if (opts.prefetch) await channel.prefetch(opts.prefetch);
    const { consumerTag } = await channel.consume(queue, (msg) => {
      if (!msg) return;
      let event: BaseEvent;
      try {
        event = JSON.parse(msg.content.toString()) as BaseEvent;
      } catch {
        channel.nack(msg, false, false); // malformed -> drop (DLQ wiring in 4.3)
        return;
      }
      Promise.resolve(handler(event))
        .then(() => channel.ack(msg))
        .catch((err) => {
          this.logger.warn(`handler failed for ${type}: ${(err as Error).message}`);
          channel.nack(msg, false, false);
        });
    });
    return consumerTag;
  }

  async close(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // best-effort
    }
    this.channel = undefined;
    this.connection = undefined;
  }
}
