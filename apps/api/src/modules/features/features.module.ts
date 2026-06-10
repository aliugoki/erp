import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FeaturesController } from './features.controller';
import { FeatureGuard } from './feature.guard';
import { FeatureService } from './feature.service';

/**
 * Feature entitlements (ADR-009). Global so provisioning + future modules can inject FeatureService.
 * Registers the global FeatureGuard (acts only on @RequiresFeature routes).
 */
@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeatureService, { provide: APP_GUARD, useClass: FeatureGuard }],
  exports: [FeatureService],
})
export class FeaturesModule {}
