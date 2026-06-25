import type { Role } from './role.enum';

/** The principal attached to `request.user` by JwtAuthGuard after verifying the access token. */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  roles: Role[];
  /** Effective fine-grained permissions (built-in roles + custom-role permissions), resolved at token
   * issue and carried in the access token's `perms` claim. `['*']` for admins. */
  perms: string[];
}
