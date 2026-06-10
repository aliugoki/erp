import { SetMetadata } from '@nestjs/common';

export const SERVICE_ONLY_KEY = 'serviceOnly';
/** Marks an endpoint as internal: callable only with a valid service-to-service token (not a user). */
export const ServiceOnly = () => SetMetadata(SERVICE_ONLY_KEY, true);
