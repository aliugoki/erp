import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import type { CreateCustomFieldDto, CreatePolicyDto } from './dto/hr.dto';

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dateStr = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v));

/** Configurable HR policy module. Companies define their own fields (`hr_custom_field`, an EAV catalogue
 * scoped by entity — POLICY by default), then each policy carries values for those fields
 * (`hr_policy_field_value`). This lets every tenant shape policies to its own requirements without a
 * schema change. */
@Injectable()
export class HrPolicyService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  // ── Custom field definitions ────────────────────────────────────────────────
  async createCustomField(dto: CreateCustomFieldDto, entity = 'POLICY') {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO hr_custom_field (tenant_id, entity, label, field_key, field_type, options, required, sort_order)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           RETURNING id, entity, label, field_key, field_type, options, required, sort_order`,
          [entity, dto.label, dto.fieldKey, dto.fieldType, dto.options ? JSON.stringify(dto.options) : null, dto.required ?? false, dto.sortOrder ?? 0],
        )) as Row[];
        return mapField(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23505') throw new BadRequestException(`Field key "${dto.fieldKey}" already exists`);
        throw err;
      }
    });
  }

  async listCustomFields(entity = 'POLICY') {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, entity, label, field_key, field_type, options, required, sort_order
         FROM hr_custom_field WHERE entity=$1 AND deleted_at IS NULL ORDER BY sort_order, label`,
        [entity],
      )) as Row[];
      return rows.map(mapField);
    });
  }

  async deleteCustomField(id: string) {
    await this.tenantTx.run(async (m) => {
      const res = (await m.query(
        `UPDATE hr_custom_field SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      )) as unknown[];
      if (res.length === 0) throw new NotFoundException('Custom field not found');
    });
  }

  // ── Policies ────────────────────────────────────────────────────────────────
  async createPolicy(dto: CreatePolicyDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hr_policy (tenant_id, name, category, description, effective_date)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
         RETURNING id, name, category, description, effective_date, status, version`,
        [dto.name, dto.category, dto.description ?? null, dto.effectiveDate ?? null],
      )) as Row[];
      const policyId = rows[0]!.id as string;
      for (const f of dto.fields ?? []) {
        try {
          await m.query(
            `INSERT INTO hr_policy_field_value (tenant_id, policy_id, field_id, value)
             VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3)`,
            [policyId, f.fieldId, f.value ?? null],
          );
        } catch (err) {
          if ((err as { code?: string })?.code === '23503') throw new BadRequestException('Unknown custom field for this tenant');
          throw err;
        }
      }
      return this.getPolicyWith(m, policyId);
    });
  }

  async listPolicies() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, name, category, description, effective_date, status, version FROM hr_policy WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )) as Row[];
      return rows.map(mapPolicy);
    });
  }

  async getPolicy(id: string) {
    return this.tenantTx.run((m) => this.getPolicyWith(m, id));
  }

  async updatePolicyStatus(id: string, status: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE hr_policy SET status=$2, updated_at=now() WHERE id=$1 AND deleted_at IS NULL
         RETURNING id, name, category, description, effective_date, status, version`,
        [id, status],
      )) as Row[];
      if (!rows[0]) throw new NotFoundException('Policy not found');
      return mapPolicy(rows[0]);
    });
  }

  private async getPolicyWith(m: { query: (sql: string, p?: unknown[]) => Promise<unknown> }, id: string) {
    const rows = (await m.query(
      `SELECT id, name, category, description, effective_date, status, version FROM hr_policy WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    )) as Row[];
    if (!rows[0]) throw new NotFoundException('Policy not found');
    const values = (await m.query(
      `SELECT v.field_id, v.value, f.label, f.field_key, f.field_type
       FROM hr_policy_field_value v JOIN hr_custom_field f ON f.id = v.field_id
       WHERE v.policy_id=$1 AND v.deleted_at IS NULL ORDER BY f.sort_order, f.label`,
      [id],
    )) as Row[];
    return {
      ...mapPolicy(rows[0]),
      fields: values.map((v) => ({
        fieldId: v.field_id as string,
        label: v.label as string,
        fieldKey: v.field_key as string,
        fieldType: v.field_type as string,
        value: str(v.value),
      })),
    };
  }
}

function mapField(r: Row) {
  return {
    id: r.id as string, entity: r.entity as string, label: r.label as string, fieldKey: r.field_key as string,
    fieldType: r.field_type as string, options: (r.options as string[] | null) ?? null,
    required: r.required as boolean, sortOrder: Number(r.sort_order ?? 0),
  };
}
function mapPolicy(r: Row) {
  return {
    id: r.id as string, name: r.name as string, category: r.category as string,
    description: str(r.description), effectiveDate: dateStr(r.effective_date),
    status: r.status as string, version: Number(r.version ?? 1),
  };
}
