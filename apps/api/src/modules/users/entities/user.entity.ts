import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity';

/**
 * Application user. Tenant-scoped (RLS) like all business data, but email is globally unique so
 * login can resolve a user → tenant before any tenant context exists (via a SECURITY DEFINER lookup
 * — see the Users migration). Roles/permissions are added in Chunk 2.2.
 */
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
}
