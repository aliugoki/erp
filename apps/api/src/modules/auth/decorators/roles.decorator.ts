import { SetMetadata } from '@nestjs/common';
import type { Role } from '../rbac/role.enum';

export const ROLES_KEY = 'roles';
/** Restrict a route/controller to users holding at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
