import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@metaxperts/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Fail fast on bad/missing env (the full ConfigModule + Joi/zod validation lands in the kernel).
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  console.log(`[api] listening on http://localhost:${config.API_PORT} (env: ${config.NODE_ENV})`);
}

void bootstrap();
