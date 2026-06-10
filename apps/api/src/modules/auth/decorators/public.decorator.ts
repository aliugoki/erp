import { SetMetadata } from '@nestjs/common';

/** Marks a route as part of the public allowlist (no auth required). The global JwtAuthGuard
 * (Chunk 2.2) reads this to skip authentication for `/health*` and `/auth/*`. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
