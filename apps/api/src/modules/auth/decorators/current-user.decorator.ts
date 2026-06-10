import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from '../rbac/authenticated-user';

/** Inject the authenticated principal (`request.user`) into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    return ctx.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
  },
);
