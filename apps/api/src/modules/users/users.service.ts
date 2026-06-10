import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { AuditService } from '../audit/audit.service';

export interface UserView {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly audit: AuditService,
  ) {}

  /** Look up a user by id WITHIN the caller's tenant. RLS makes a cross-tenant id simply "not found". */
  async findByIdInTenant(id: string): Promise<UserView> {
    const rows = (await this.tenantTx.run((manager) =>
      manager.query('SELECT id, email, roles, is_active FROM users WHERE id = $1', [id]),
    )) as Array<{ id: string; email: string; roles: string[]; is_active: boolean }>;
    const user = rows[0];
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, email: user.email, roles: user.roles, isActive: user.is_active };
  }

  /** Activate/deactivate a user, recording the before/after in the audit trail (same transaction). */
  async setActive(id: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
    return this.tenantTx.run(async (manager) => {
      const rows = (await manager.query('SELECT id, is_active FROM users WHERE id = $1', [id])) as Array<{
        id: string;
        is_active: boolean;
      }>;
      const existing = rows[0];
      if (!existing) throw new NotFoundException('User not found');

      await manager.query('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [
        isActive,
        id,
      ]);
      await this.audit.recordWith(manager, {
        action: 'USER_SET_ACTIVE',
        resource: 'users',
        resourceId: id,
        oldValue: { isActive: existing.is_active },
        newValue: { isActive },
      });
      return { id, isActive };
    });
  }
}
