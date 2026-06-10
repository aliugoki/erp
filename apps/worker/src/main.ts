import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@metaxperts/config';
import { WorkerModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = await NestFactory.create(WorkerModule);
  app.enableShutdownHooks();

  await app.listen(config.WORKER_PORT, '0.0.0.0');
  console.log(`[worker] listening on http://localhost:${config.WORKER_PORT} (env: ${config.NODE_ENV})`);
}

void bootstrap();
