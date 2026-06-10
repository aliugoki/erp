import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AccountController } from '../identity/account.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';

/**
 * Authentication (Chunk 2.1): login + rotating refresh tokens with reuse detection. Registers the
 * User entity so the rest of identity (RBAC, Chunk 2.2) can build on it. JwtModule is registered
 * bare; secrets/TTLs are passed per-sign from config.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User]), JwtModule.register({})],
  controllers: [AuthController, AccountController],
  providers: [
    AuthService,
    RefreshTokenService,
    // Global guards run in this order: authenticate (JWT) → authorize by role → by permission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
