import type { Role } from './role.enum';

/** The principal attached to `request.user` by JwtAuthGuard after verifying the access token. */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roles: Role[];
}
