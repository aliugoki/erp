import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { InternalController } from './internal.controller';
import { ServiceAuthGuard } from './service-auth.guard';
import { ServiceTokenService } from './service-token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [InternalController],
  providers: [ServiceTokenService, { provide: APP_GUARD, useClass: ServiceAuthGuard }],
  exports: [ServiceTokenService],
})
export class ServiceAuthModule {}
