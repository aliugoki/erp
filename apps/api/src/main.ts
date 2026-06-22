import './tracing'; // MUST be first — starts OpenTelemetry before instrumented modules load.
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '@metaxperts/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap(): Promise<void> {
  // Bad/missing env throws during ConfigModule init here → the app refuses to boot (fail fast).
  // bodyParser:false so we can set explicit payload size limits below (Phase 8.3).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });

  // Route Nest's own logs through pino (structured JSON).
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  // Security headers (Phase 8.3): HSTS, X-Frame-Options (deny), X-Content-Type-Options, etc. CSP is
  // disabled — this is a JSON API (no HTML), and the Next.js web app sets its own CSP.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));

  // Bounded request payloads → 413 on oversize (Phase 8.3).
  const maxBody = config.get('MAX_BODY_SIZE', { infer: true });
  app.use(json({ limit: maxBody }));
  app.use(urlencoded({ extended: true, limit: maxBody }));

  // CORS: locked to the configured allowlist (CORS_ORIGINS). When unset, reflect the origin in
  // development only; in production deny cross-origin outright (the web is same-origin via /api, so it
  // never needs CORS — a permissive reflect-any-with-credentials default would be a footgun).
  const origins = config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()).filter(Boolean);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  app.enableCors({ origin: origins.length ? origins : !isProd, credentials: true });

  // Reject unknown fields; coerce/validate DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // { data, meta } success envelope + RFC 7807 problem+json errors.
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Drain in-flight work on SIGTERM/SIGINT before exit.
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  // Bind IPv4 explicitly (standard for containers; avoids colliding with IPv6-loopback listeners).
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API listening on http://localhost:${port} (${config.get('NODE_ENV', { infer: true })})`);
}

void bootstrap();
