import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { loadConfig, type AppConfig } from '@metaxperts/config';

/**
 * Global configuration. Loads `.env`, then validates the full environment through the shared zod
 * schema (`@metaxperts/config`). A bad/missing variable throws here, so the app refuses to boot
 * (fail fast). Inject `ConfigService<AppConfig, true>` to read typed values anywhere.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      // `validate` receives the merged env and returns the validated, typed config object.
      validate: (raw: Record<string, unknown>): AppConfig =>
        loadConfig(raw as NodeJS.ProcessEnv),
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}

/** Typed ConfigService alias used throughout the API. */
export type TypedConfigService = ConfigService<AppConfig, true>;
