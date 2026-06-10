import { Module } from '@nestjs/common';
import { WorkerHealthController } from './worker-health.controller';

@Module({
  controllers: [WorkerHealthController],
})
export class WorkerHealthModule {}
