import { SetMetadata } from '@nestjs/common';

export const SHADOW_PERMISSIONS_KEY = 'shadow_permissions';

/**
 * Path 2 dual-run marker. Declares the fine-grained permission(s) an endpoint *will* require once
 * permission-based enforcement is turned on (Phase C). In Phase A/B these are **log-only**: the
 * PermissionsGuard computes the decision and logs a divergence when the role-allowed principal would
 * be denied by the permission model — it never blocks. Phase C converts `@ShadowPermissions(...)` to
 * the enforcing `@Permissions(...)`.
 */
export const ShadowPermissions = (...permissions: string[]) =>
  SetMetadata(SHADOW_PERMISSIONS_KEY, permissions);
