import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  CreateClientDto,
  CreateContactDto,
  CreateDealDto,
} from './dto/crm.dto';
import { type DealRow, type PipelineRow, buildPipeline, isWonTransition, mapDealRow } from './crm.util';

const DEAL_COLS = 'id, client_id, title, value_minor, currency, stage, expected_close_date, assigned_to';

@Injectable()
export class CrmService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Clients ─────────────────────────────────────────────────────────────────
  async createClient(dto: CreateClientDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO crm_client (tenant_id, company_name, industry, website, status)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
         RETURNING id, company_name, industry, website, status`,
        [dto.companyName, dto.industry ?? null, dto.website ?? null, dto.status ?? 'PROSPECT'],
      )) as Array<Record<string, unknown>>;
      return rows[0];
    });
  }

  async listClients() {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, company_name, industry, website, status FROM crm_client WHERE deleted_at IS NULL ORDER BY company_name`,
      ),
    );
  }

  // ── Contacts ────────────────────────────────────────────────────────────────
  async createContact(dto: CreateContactDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO crm_contact (tenant_id, client_id, name, email, phone, is_primary)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
           RETURNING id, client_id, name, email, phone, is_primary`,
          [dto.clientId, dto.name, dto.email ?? null, dto.phone ?? null, dto.isPrimary ?? false],
        )) as Array<Record<string, unknown>>;
        return rows[0];
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') {
          throw new BadRequestException('Unknown client for this tenant');
        }
        throw err;
      }
    });
  }

  async listContacts(clientId: string) {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, client_id, name, email, phone, is_primary FROM crm_contact
         WHERE client_id=$1 AND deleted_at IS NULL ORDER BY is_primary DESC, name`,
        [clientId],
      ),
    );
  }

  // ── Deals ───────────────────────────────────────────────────────────────────
  async createDeal(dto: CreateDealDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO crm_deal (tenant_id, client_id, title, value_minor, currency, stage, expected_close_date, assigned_to)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7)
           RETURNING ${DEAL_COLS}`,
          [
            dto.clientId,
            dto.title,
            dto.valueMinor ?? 0,
            dto.currency ?? 'PKR',
            dto.stage ?? 'LEAD',
            dto.expectedCloseDate ?? null,
            dto.assignedTo ?? null,
          ],
        )) as DealRow[];
        return mapDealRow(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') {
          throw new BadRequestException('Unknown client for this tenant');
        }
        throw err;
      }
    });
  }

  async listDeals() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${DEAL_COLS} FROM crm_deal WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )) as DealRow[];
      return rows.map(mapDealRow);
    });
  }

  /** Deals grouped by stage with Money totals — the pipeline board. */
  async pipeline() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT stage, count(*)::int AS count, COALESCE(sum(value_minor),0)::bigint AS total_minor, min(currency) AS currency
         FROM crm_deal WHERE deleted_at IS NULL GROUP BY stage`,
      )) as PipelineRow[];
      return buildPipeline(rows);
    });
  }

  async getDeal(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${DEAL_COLS} FROM crm_deal WHERE id=$1 AND deleted_at IS NULL`, [
        id,
      ])) as DealRow[];
      if (!rows[0]) throw new NotFoundException('Deal not found');
      return mapDealRow(rows[0]);
    });
  }

  /** Move a deal to a new stage; reaching CLOSED_WON emits `crm.deal_closed` to the outbox (same tx). */
  async updateStage(id: string, stage: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, client_id, title, value_minor, currency, stage, assigned_to FROM crm_deal WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Array<Record<string, unknown>>;
      const deal = rows[0];
      if (!deal) throw new NotFoundException('Deal not found');

      await m.query(`UPDATE crm_deal SET stage=$1, updated_at=now() WHERE id=$2`, [stage, id]);

      if (isWonTransition(deal.stage as string, stage)) {
        await this.outbox.write(m, EVENT_TYPES.CRM_DEAL_CLOSED, {
          dealId: deal.id,
          title: deal.title,
          clientId: deal.client_id,
          valueMinor: Number(deal.value_minor),
          currency: deal.currency,
          assignedTo: (deal.assigned_to as string | null) ?? null,
        });
      }
      return { id: deal.id, stage };
    });
  }
}
