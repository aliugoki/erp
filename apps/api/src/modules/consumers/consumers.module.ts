import { Global, Module } from '@nestjs/common';
import { AdminDlqController } from './admin-dlq.controller';
import { DlqService } from './dlq.service';
import { IdempotentConsumer } from './idempotent-consumer.service';

/** Reliable event consumption framework (idempotency + retry + DLQ) + the admin DLQ endpoint.
 * Global so workers/handlers (Chunk 4.4) can register consumers. */
@Global()
@Module({
  controllers: [AdminDlqController],
  providers: [IdempotentConsumer, DlqService],
  exports: [IdempotentConsumer, DlqService],
})
export class ConsumersModule {}
