import { Global, Module } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { RabbitMqPublisher } from './rabbitmq.publisher';

/** Global RabbitMQ event bus. Exports the bus + the relay's Publisher implementation. */
@Global()
@Module({
  providers: [EventBusService, RabbitMqPublisher],
  exports: [EventBusService, RabbitMqPublisher],
})
export class EventBusModule {}
