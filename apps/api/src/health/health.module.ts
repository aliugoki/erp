import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';
import { ReadinessHealthIndicator, ReadinessService } from './readiness.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, ReadinessService, ReadinessHealthIndicator],
})
export class HealthModule {}
