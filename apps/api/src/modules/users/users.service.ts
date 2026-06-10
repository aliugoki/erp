import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

export interface UserView {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
}

@Injectable()
export class UsersService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Look up a user by id WITHIN the caller's tenant. RLS makes a cross-tenant id simply "not found". */
  async findByIdInTenant(id: string): Promise<UserView> {
    const rows = (await this.tenantTx.run((manager) =>
      manager.query('SELECT id, email, roles, is_active FROM users WHERE id = $1', [id]),
    )) as Array<{ id: string; email: string; roles: string[]; is_active: boolean }>;
    const user = rows[0];
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, email: user.email, roles: user.roles, isActive: user.is_active };
  }
}
