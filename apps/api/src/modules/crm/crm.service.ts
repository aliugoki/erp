import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  CreateClientDto,
  CreateContactDto,
  CreateDealDto,
  UpdateClientDto,
  UpdateContactDto,
  UpdateDealDto,
} from './dto/crm.dto';
import {
  type ClientRow,
  type ContactRow,
  type DealRow,
  type DealStage,
  type PipelineRow,
  STAGE_PROBABILITY,
  buildPipeline,
  isWonTransition,
  mapClientRow,
  mapContactRow,
  mapDealRow,
  nextCrmDocNo,
  rowsOf,
} from './crm.util';

const DEAL_COLS =
  'id, client_id, title, value_minor, currency, stage, expected_close_date, assigned_to, probability, owner_id, source';
const CLIENT_COLS =
  'id, account_no, company_name, industry, website, status, phone, email, address, city, country, owner_id, annual_revenue_minor';
const CONTACT_COLS = 'id, client_id, name, email, phone, is_primary';

@Injectable()
export class CrmService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Accounts (clients) ──────────────────────────────────────────────────────
  async createClient(dto: CreateClientDto) {
    return this.tenantTx.run(async (m) => {
      const accountNo = await nextCrmDocNo(m, 'ACC', 'ACC');
      const rows = (await m.query(
        `INSERT INTO crm_client
           (tenant_id, account_no, company_name, industry, website, status, phone, email, address, city, country, owner_id, annual_revenue_minor)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${CLIENT_COLS}`,
        [
          accountNo,
          dto.companyName,
          dto.industry ?? null,
          dto.website ?? null,
          dto.status ?? 'PROSPECT',
          dto.phone ?? null,
          dto.email ?? null,
          dto.address ?? null,
          dto.city ?? null,
          dto.country ?? null,
          dto.ownerId ?? null,
          dto.annualRevenueMinor ?? 0,
        ],
      )) as ClientRow[];
      return mapClientRow(rows[0]!);
    });
  }

  async listClients() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${CLIENT_COLS} FROM crm_client WHERE deleted_at IS NULL ORDER BY company_name`,
      )) as ClientRow[];
      return rows.map(mapClientRow);
    });
  }

  async getClient(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT ${CLIENT_COLS} FROM crm_client WHERE id=$1 AND deleted_at IS NULL`, [id])) as ClientRow[];
      if (!rows[0]) throw new NotFoundException('Account not found');
      return mapClientRow(rows[0]);
    });
  }

  async updateClient(id: string, dto: UpdateClientDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<ClientRow>(await m.query(
        `UPDATE crm_client SET
            company_name=COALESCE($2,company_name), industry=COALESCE($3,industry), website=COALESCE($4,website),
            status=COALESCE($5,status), phone=COALESCE($6,phone), email=COALESCE($7,email), address=COALESCE($8,address),
            city=COALESCE($9,city), country=COALESCE($10,country), owner_id=COALESCE($11,owner_id),
            annual_revenue_minor=COALESCE($12,annual_revenue_minor), updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL RETURNING ${CLIENT_COLS}`,
        [id, dto.companyName ?? null, dto.industry ?? null, dto.website ?? null, dto.status ?? null, dto.phone ?? null,
          dto.email ?? null, dto.address ?? null, dto.city ?? null, dto.country ?? null, dto.ownerId ?? null, dto.annualRevenueMinor ?? null],
      ));
      if (!rows[0]) throw new NotFoundException('Account not found');
      return mapClientRow(rows[0]);
    });
  }

  /** Soft-delete an account and its contacts (deals are kept for history). */
  async deleteClient(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<{ id: string }>(await m.query(`UPDATE crm_client SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]));
      if (!rows[0]) throw new NotFoundException('Account not found');
      await m.query(`UPDATE crm_contact SET deleted_at=now() WHERE client_id=$1 AND deleted_at IS NULL`, [id]);
      return { ok: true };
    });
  }

  // ── Contacts ────────────────────────────────────────────────────────────────
  async createContact(dto: CreateContactDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO crm_contact (tenant_id, client_id, name, email, phone, is_primary)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5)
           RETURNING ${CONTACT_COLS}`,
          [dto.clientId, dto.name, dto.email ?? null, dto.phone ?? null, dto.isPrimary ?? false],
        )) as ContactRow[];
        return mapContactRow(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') {
          throw new BadRequestException('Unknown client for this tenant');
        }
        throw err;
      }
    });
  }

  async listContacts(clientId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${CONTACT_COLS} FROM crm_contact WHERE client_id=$1 AND deleted_at IS NULL ORDER BY is_primary DESC, name`,
        [clientId],
      )) as ContactRow[];
      return rows.map(mapContactRow);
    });
  }

  async updateContact(id: string, dto: UpdateContactDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<ContactRow>(await m.query(
        `UPDATE crm_contact SET name=COALESCE($2,name), email=COALESCE($3,email), phone=COALESCE($4,phone),
            is_primary=COALESCE($5,is_primary), updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL RETURNING ${CONTACT_COLS}`,
        [id, dto.name ?? null, dto.email ?? null, dto.phone ?? null, dto.isPrimary ?? null],
      ));
      if (!rows[0]) throw new NotFoundException('Contact not found');
      return mapContactRow(rows[0]);
    });
  }

  async deleteContact(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<{ id: string }>(await m.query(`UPDATE crm_contact SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]));
      if (!rows[0]) throw new NotFoundException('Contact not found');
      return { ok: true };
    });
  }

  // ── Deals ───────────────────────────────────────────────────────────────────
  async createDeal(dto: CreateDealDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const stage = (dto.stage ?? 'LEAD') as DealStage;
        const probability = dto.probability ?? STAGE_PROBABILITY[stage];
        const rows = (await m.query(
          `INSERT INTO crm_deal
             (tenant_id, client_id, title, value_minor, currency, stage, expected_close_date, assigned_to, probability, owner_id, source, lead_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING ${DEAL_COLS}`,
          [
            dto.clientId,
            dto.title,
            dto.valueMinor ?? 0,
            dto.currency ?? 'PKR',
            stage,
            dto.expectedCloseDate ?? null,
            dto.assignedTo ?? null,
            probability,
            dto.ownerId ?? dto.assignedTo ?? null,
            dto.source ?? null,
            dto.leadId ?? null,
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

  /** Deals grouped by stage with Money totals + a probability-weighted forecast — the pipeline board. */
  async pipeline() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT stage, count(*)::int AS count,
                COALESCE(sum(value_minor),0)::bigint AS total_minor,
                COALESCE(sum(value_minor * probability / 100),0)::bigint AS weighted_minor,
                min(currency) AS currency
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

  /** Move a deal to a new stage; the win probability re-defaults to the stage, closed stages stamp
   * `closed_at` (and CLOSED_LOST may record a reason), and reaching CLOSED_WON emits `crm.deal_closed`
   * to the outbox (same tx). */
  async updateStage(id: string, stage: string, lostReason?: string | null) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, client_id, title, value_minor, currency, stage, assigned_to FROM crm_deal WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as Array<Record<string, unknown>>;
      const deal = rows[0];
      if (!deal) throw new NotFoundException('Deal not found');

      const probability = STAGE_PROBABILITY[stage as DealStage] ?? 0;
      const closed = stage === 'CLOSED_WON' || stage === 'CLOSED_LOST';
      await m.query(
        `UPDATE crm_deal
         SET stage=$1, probability=$2,
             closed_at = CASE WHEN $3 THEN now() ELSE NULL END,
             lost_reason = CASE WHEN $1 = 'CLOSED_LOST' THEN $4 ELSE NULL END,
             updated_at=now()
         WHERE id=$5`,
        [stage, probability, closed, lostReason ?? null, id],
      );

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

  /** Edit a deal's details (title, value, dates, owner) — not its stage. */
  async updateDeal(id: string, dto: UpdateDealDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<DealRow>(await m.query(
        `UPDATE crm_deal SET
            title=COALESCE($2,title), value_minor=COALESCE($3,value_minor), currency=COALESCE($4,currency),
            expected_close_date=COALESCE($5,expected_close_date), assigned_to=COALESCE($6,assigned_to),
            probability=COALESCE($7,probability), owner_id=COALESCE($8,owner_id), source=COALESCE($9,source), updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL RETURNING ${DEAL_COLS}`,
        [id, dto.title ?? null, dto.valueMinor ?? null, dto.currency ?? null, dto.expectedCloseDate ?? null,
          dto.assignedTo ?? null, dto.probability ?? null, dto.ownerId ?? null, dto.source ?? null],
      ));
      if (!rows[0]) throw new NotFoundException('Deal not found');
      return mapDealRow(rows[0]);
    });
  }

  async deleteDeal(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf<{ id: string }>(await m.query(`UPDATE crm_deal SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]));
      if (!rows[0]) throw new NotFoundException('Deal not found');
      return { ok: true };
    });
  }
}
