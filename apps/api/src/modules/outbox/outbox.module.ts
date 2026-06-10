import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

/** Global so any module can write domain events to the outbox within its own transaction. */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
