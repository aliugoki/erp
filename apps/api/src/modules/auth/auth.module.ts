import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Authentication (Chunk 2.1): login + rotating refresh tokens with reuse detection. Registers the
 * User entity so the rest of identity (RBAC, Chunk 2.2) can build on it. JwtModule is registered
 * bare; secrets/TTLs are passed per-sign from config.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
  exports: [AuthService],
})
export class AuthModule {}
