import { SetMetadata } from '@nestjs/common';

export const REQUIRES_FEATURE_KEY = 'requiresFeature';
/** Gate a route behind a tenant feature entitlement (ADR-009), e.g. `@RequiresFeature('finance.invoicing')`. */
export const RequiresFeature = (featureKey: string) => SetMetadata(REQUIRES_FEATURE_KEY, featureKey);
