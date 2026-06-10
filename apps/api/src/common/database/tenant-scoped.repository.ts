import { type DeepPartial, type FindManyOptions, type FindOneOptions, Repository } from 'typeorm';
import { BaseEntity } from './base.entity';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Base repository for tenant-owned entities (ADR-005). It stamps `tenantId` onto new entities and
 * folds the current tenant into read `where` clauses, so module code never has to remember tenant
 * scoping. This is convenience + defense-in-depth ONLY — Postgres RLS (ADR-002) is the authoritative
 * guard, enforced regardless of what passes through here.
 *
 * Modules extend it and register a provider, e.g.:
 *   class EmployeeRepository extends TenantScopedRepository<Employee> {}
 *   { provide: EmployeeRepository,
 *     useFactory: (ds: DataSource) => new EmployeeRepository(Employee, ds.createEntityManager()) }
 */
export abstract class TenantScopedRepository<T extends BaseEntity> extends Repository<T> {
  /** Build a where-filter narrowed to the current tenant. */
  protected withTenant(where: Record<string, unknown> = {}): Record<string, unknown> {
    const tenantId = TenantContext.current();
    return tenantId ? { ...where, tenantId } : where;
  }

  /** Stamp the current tenant onto one or many new entities. */
  createScoped(input: DeepPartial<T>): T;
  createScoped(input: DeepPartial<T>[]): T[];
  createScoped(input: DeepPartial<T> | DeepPartial<T>[]): T | T[] {
    const tenantId = TenantContext.current();
    const stamp = (entity: T): T => {
      if (tenantId && !(entity as BaseEntity).tenantId) {
        (entity as BaseEntity).tenantId = tenantId;
      }
      return entity;
    };
    if (Array.isArray(input)) {
      return this.create(input).map(stamp);
    }
    return stamp(this.create(input));
  }

  override find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return super.find({ ...options, where: this.withTenant(options.where as Record<string, unknown>) as FindManyOptions<T>['where'] });
  }

  override findOne(options: FindOneOptions<T>): Promise<T | null> {
    return super.findOne({ ...options, where: this.withTenant(options.where as Record<string, unknown>) as FindOneOptions<T>['where'] });
  }
}
