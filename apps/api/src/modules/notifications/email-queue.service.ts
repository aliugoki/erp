import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { AppConfig } from '@metaxperts/config';
import { type EmailMessage, MailerService } from './mailer.service';

const QUEUE = 'email';

/**
 * The email side-channel (Chunk 5.1). Notifications enqueue an email here; a BullMQ worker delivers
 * it via {@link MailerService} with exponential-backoff retries (ADR-004 retry/backoff applied to a
 * remote SMTP dependency). Flag-gated by `NOTIFICATIONS_EMAIL_ENABLED` — disabled by default so the
 * stack runs (and tests pass) without an SMTP server; in-app notifications are unaffected either way.
 * Producer and worker run in-process per ADR-001 until a measured need justifies a separate runtime.
 */
@Injectable()
export class EmailQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueService.name);
  private readonly enabled: boolean;
  private readonly connection: ConnectionOptions;
  private queue?: Queue<EmailMessage>;
  private worker?: Worker<EmailMessage>;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly mailer: MailerService,
  ) {
    this.enabled = config.get('NOTIFICATIONS_EMAIL_ENABLED', { infer: true });
    const url = new URL(config.get('REDIS_URL', { infer: true }));
    // BullMQ manages its own (blocking) connections; a Worker requires maxRetriesPerRequest: null.
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      maxRetriesPerRequest: null,
    };
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Email delivery disabled (NOTIFICATIONS_EMAIL_ENABLED unset) — in-app notifications only');
      return;
    }
    this.queue = new Queue<EmailMessage>(QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    this.worker = new Worker<EmailMessage>(QUEUE, (job) => this.mailer.send(job.data), { connection: this.connection });
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`email job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.logger.log('Email queue + worker started');
  }

  /**
   * Best-effort enqueue. Never throws into the caller: the in-app notification is already durable, so
   * an unavailable Redis must not fail the consumer's transaction.
   */
  async enqueue(msg: EmailMessage): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add('send', msg);
    } catch (e) {
      this.logger.warn(`failed to enqueue email to ${msg.to}: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
