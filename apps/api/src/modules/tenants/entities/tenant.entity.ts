import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type TenantStatus = 'active' | 'suspended';

/**
 * A tenant (company). This is the platform registry, NOT a tenant-scoped business table, so it does
 * not extend BaseEntity and has no RLS — it is managed only through SUPER_ADMIN-guarded endpoints.
 * Every business row's `tenant_id` refers to one of these.
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', unique: true })
  slug!: string;

  @Column({ type: 'text', default: 'active' })
  status!: TenantStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
