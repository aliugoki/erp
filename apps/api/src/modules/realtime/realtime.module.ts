import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeBridge } from './realtime.bridge';

/**
 * Realtime (Chunk 5.3): a JWT-authenticated, tenant-scoped Socket.IO gateway fed from domain events.
 * JwtModule is registered bare (the gateway verifies with the access secret per-call, like JwtAuthGuard).
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, RealtimeBridge],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
