import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { MailerService } from './mailer.service';
import { EmailQueueService } from './email-queue.service';

/**
 * Event-driven notifications (Chunk 5.1): in-app feed + best-effort email side-channel. The consumer
 * (flag-gated) turns domain events into notifications; the controller serves the current user's feed.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsConsumer, MailerService, EmailQueueService],
  exports: [NotificationsService, EmailQueueService],
})
export class NotificationsModule {}
