import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '@metaxperts/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap(): Promise<void> {
  // Bad/missing env throws during ConfigModule init here → the app refuses to boot (fail fast).
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Route Nest's own logs through pino (structured JSON).
  app.useLogger(app.get(Logger));
  app.flushLogs();

  // Reject unknown fields; coerce/validate DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // { data, meta } success envelope + RFC 7807 problem+json errors.
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Drain in-flight work on SIGTERM/SIGINT before exit.
  app.enableShutdownHooks();

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const port = config.get('API_PORT', { infer: true });
  // Bind IPv4 explicitly (standard for containers; avoids colliding with IPv6-loopback listeners).
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API listening on http://localhost:${port} (${config.get('NODE_ENV', { infer: true })})`);
}

void bootstrap();
