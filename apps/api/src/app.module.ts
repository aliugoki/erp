import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { LoggerModule } from './common/logger/logger.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './common/redis/redis.module';
import { TenantModule } from './common/tenant/tenant.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { FeaturesModule } from './modules/features/features.module';
import { ServiceAuthModule } from './modules/service-auth/service-auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HrModule } from './modules/hr/hr.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './health/health.module';
import { RequestContextMiddleware } from './common/request-context/request-context.middleware';

/**
 * The API kernel root module. Pure platform — no business logic yet. Order of cross-cutting concerns:
 * config (fail-fast) → logging → database → redis → health. The RequestContext middleware wraps every
 * request so requestId/tenantId/userId flow through logs, RLS, and errors.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    TenantModule,
    AuditModule,
    // AuthModule must precede FeaturesModule so the global JwtAuthGuard runs (and populates the
    // tenant into RequestContext) BEFORE the FeatureGuard reads it. Global APP_GUARDs execute in
    // module-registration order.
    AuthModule,
    ServiceAuthModule,
    FeaturesModule,
    OutboxModule,
    UsersModule,
    TenantsModule,
    HrModule,
    FinanceModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
