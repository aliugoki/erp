import { Module } from '@nestjs/common';
import { WorkerHealthModule } from './health/worker-health.module';

@Module({
  imports: [WorkerHealthModule],
})
export class WorkerModule {}
