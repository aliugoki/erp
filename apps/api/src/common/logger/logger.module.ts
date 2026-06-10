import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { AppConfig } from '@metaxperts/config';
import { RequestContext } from '../request-context/request-context';

/**
 * Structured JSON logging via pino. Every log line carries `requestId`/`tenantId`/`userId` pulled
 * from the RequestContext (ADR-007). Pretty-prints in development; raw JSON in production. Secrets
 * in headers are redacted.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          autoLogging: true,
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["set-cookie"]'],
            remove: true,
          },
          customProps: () => {
            const ctx = RequestContext.get();
            return {
              requestId: ctx?.requestId,
              tenantId: ctx?.tenantId,
              userId: ctx?.userId,
            };
          },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
              : undefined,
        },
      }),
    }),
  ],
})
export class LoggerModule {}
