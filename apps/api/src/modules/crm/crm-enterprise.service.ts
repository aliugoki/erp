import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENT_TYPES } from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  ConvertLeadDto,
  CreateActivityDto,
  CreateLeadDto,
  ListActivityQueryDto,
} from './dto/crm.dto';
import {
  type ActivityRow,
  type LeadRow,
  STAGE_PROBABILITY,
  mapActivityRow,
  mapLeadRow,
  nextCrmDocNo,
} from './crm.util';

const LEAD_COLS =
  'id, lead_no, name, company, email, phone, source, status, rating, est_value_minor, currency, owner_id, notes, converted_client_id, converted_deal_id, converted_at';
const ACTIVITY_COLS =
  'id, type, subject, body, due_at, completed, completed_at, client_id, contact_id, deal_id, lead_id, owner_id, outcome, created_at';

/** Enterprise CRM: leads + qualification/conversion, the activity timeline, and sales reports. The
 * minimal accounts/contacts/deals/pipeline live in {@link CrmService}; this service layers the sales
 * funnel on top. All writes go through the tenant-scoped tx (RLS); money stays integer minor units. */
@Injectable()
export class CrmEnterpriseService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Leads ─────────────────────────────────────────────────────────────────
  async createLead(dto: CreateLeadDto) {
    return this.tenantTx.run(async (m) => {
      const leadNo = await nextCrmDocNo(m, 'LEAD', 'LEAD');
      const rows = (await m.query(
        `INSERT INTO crm_lead
           (tenant_id, lead_no, name, company, email, phone, source, rating, est_value_minor, currency, owner_id, notes)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${LEAD_COLS}`,
        [
          leadNo,
          dto.name,
          dto.company ?? null,
          dto.email ?? null,
          dto.phone ?? null,
          dto.source ?? null,
          dto.rating ?? 'WARM',
          dto.estValueMinor ?? 0,
          dto.currency ?? 'PKR',
          dto.ownerId ?? null,
          dto.notes ?? null,
        ],
      )) as LeadRow[];
      return mapLeadRow(rows[0]!);
    });
  }

  async listLeads() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${LEAD_COLS} FROM crm_lead WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      )) as LeadRow[];
      return rows.map(mapLeadRow);
    });
  }

  async getLead(id: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${LEAD_COLS} FROM crm_lead WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )) as LeadRow[];
      if (!rows[0]) throw new NotFoundException('Lead not found');
      return mapLeadRow(rows[0]);
    });
  }

  /** Advance a lead through the qualification funnel (NEW→CONTACTED→QUALIFIED→UNQUALIFIED). The
   * terminal CONVERTED status is set only by {@link convertLead}. */
  async updateLeadStatus(id: string, status: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE crm_lead SET status=$2, updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL AND status <> 'CONVERTED'
         RETURNING ${LEAD_COLS}`,
        [id, status],
      )) as LeadRow[];
      if (!rows[0]) throw new NotFoundException('Lead not found or already converted');
      return mapLeadRow(rows[0]);
    });
  }

  /** Convert a lead into an account (+ a primary contact) and, optionally, an opportunity — all in one
   * transaction. Re-attaches to an existing account when `clientId` is given. Emits
   * `crm.lead_converted` and is idempotent (a converted lead can't be converted again). */
  async convertLead(id: string, dto: ConvertLeadDto) {
    return this.tenantTx.run(async (m) => {
      const leadRows = (await m.query(
        `SELECT ${LEAD_COLS} FROM crm_lead WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )) as LeadRow[];
      const lead = leadRows[0];
      if (!lead) throw new NotFoundException('Lead not found');
      if (lead.status === 'CONVERTED') throw new BadRequestException('Lead is already converted');

      // 1) Account — reuse the given one, else create from the lead's company/name.
      let clientId = dto.clientId ?? null;
      if (!clientId) {
        const accountNo = await nextCrmDocNo(m, 'ACC', 'ACC');
        const accRows = (await m.query(
          `INSERT INTO crm_client (tenant_id, account_no, company_name, email, phone, owner_id, status)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,'ACTIVE')
           RETURNING id`,
          [accountNo, lead.company ?? lead.name, lead.email ?? null, lead.phone ?? null, lead.owner_id ?? null],
        )) as Array<{ id: string }>;
        clientId = accRows[0]!.id;
      } else {
        const exists = (await m.query(
          `SELECT id FROM crm_client WHERE id=$1 AND deleted_at IS NULL`,
          [clientId],
        )) as Array<{ id: string }>;
        if (!exists[0]) throw new BadRequestException('Unknown account for this tenant');
      }

      // 2) Primary contact from the lead's person.
      await m.query(
        `INSERT INTO crm_contact (tenant_id, client_id, name, email, phone, is_primary)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,true)`,
        [clientId, lead.name, lead.email ?? null, lead.phone ?? null],
      );

      // 3) Optional opportunity seeded from the lead's estimate.
      let dealId: string | null = null;
      const valueMinor = dto.dealValueMinor ?? Number(lead.est_value_minor);
      if (dto.createDeal) {
        const dealRows = (await m.query(
          `INSERT INTO crm_deal
             (tenant_id, client_id, title, value_minor, currency, stage, assigned_to, probability, owner_id, source, lead_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,'QUALIFIED',$5,$6,$5,$7,$8)
           RETURNING id`,
          [
            clientId,
            dto.dealTitle ?? `${lead.company ?? lead.name} opportunity`,
            valueMinor,
            lead.currency,
            lead.owner_id ?? null,
            STAGE_PROBABILITY.QUALIFIED,
            lead.source ?? null,
            lead.id,
          ],
        )) as Array<{ id: string }>;
        dealId = dealRows[0]!.id;
      }

      // 4) Mark the lead converted.
      await m.query(
        `UPDATE crm_lead
         SET status='CONVERTED', converted_client_id=$2, converted_deal_id=$3, converted_at=now(), updated_at=now()
         WHERE id=$1`,
        [id, clientId, dealId],
      );

      await this.outbox.write(m, EVENT_TYPES.CRM_LEAD_CONVERTED, {
        leadId: id,
        clientId,
        dealId,
        valueMinor,
        currency: lead.currency,
        ownerId: lead.owner_id ?? null,
      });

      return { leadId: id, clientId, dealId, converted: true };
    });
  }

  // ── Activities / tasks ──────────────────────────────────────────────────────
  async createActivity(dto: CreateActivityDto) {
    return this.tenantTx.run(async (m) => {
      try {
        const rows = (await m.query(
          `INSERT INTO crm_activity
             (tenant_id, type, subject, body, due_at, client_id, contact_id, deal_id, lead_id, owner_id)
           VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING ${ACTIVITY_COLS}`,
          [
            dto.type,
            dto.subject,
            dto.body ?? null,
            dto.dueAt ?? null,
            dto.clientId ?? null,
            dto.contactId ?? null,
            dto.dealId ?? null,
            dto.leadId ?? null,
            dto.ownerId ?? null,
          ],
        )) as ActivityRow[];
        return mapActivityRow(rows[0]!);
      } catch (err) {
        if ((err as { code?: string })?.code === '23503') {
          throw new BadRequestException('Unknown account for this tenant');
        }
        throw err;
      }
    });
  }

  /** Activity timeline, newest first. Any subset of {deal,client,lead,contact} narrows it. */
  async listActivities(q: ListActivityQueryDto) {
    const filters: string[] = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const [col, val] of [
      ['deal_id', q.dealId],
      ['client_id', q.clientId],
      ['lead_id', q.leadId],
      ['contact_id', q.contactId],
    ] as const) {
      if (val) {
        params.push(val);
        filters.push(`${col}=$${params.length}`);
      }
    }
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${ACTIVITY_COLS} FROM crm_activity WHERE ${filters.join(' AND ')}
         ORDER BY COALESCE(due_at, created_at) DESC`,
        params,
      )) as ActivityRow[];
      return rows.map(mapActivityRow);
    });
  }

  /** Open (not completed) tasks/activities with a due date, soonest first — the "to-do" feed. */
  async listOpenTasks() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT ${ACTIVITY_COLS} FROM crm_activity
         WHERE deleted_at IS NULL AND completed = false AND due_at IS NOT NULL
         ORDER BY due_at ASC`,
      )) as ActivityRow[];
      return rows.map(mapActivityRow);
    });
  }

  async completeActivity(id: string, outcome?: string | null) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `UPDATE crm_activity SET completed=true, completed_at=now(), outcome=COALESCE($2, outcome), updated_at=now()
         WHERE id=$1 AND deleted_at IS NULL RETURNING ${ACTIVITY_COLS}`,
        [id, outcome ?? null],
      )) as ActivityRow[];
      if (!rows[0]) throw new NotFoundException('Activity not found');
      return mapActivityRow(rows[0]);
    });
  }

  // ── Sales reports ───────────────────────────────────────────────────────────
  /** Weighted pipeline forecast: per open stage the count, raw value and probability-weighted value,
   * plus grand totals. */
  async forecast() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT stage, count(*)::int AS count,
                COALESCE(sum(value_minor),0)::bigint AS total_minor,
                COALESCE(sum(value_minor * probability / 100),0)::bigint AS weighted_minor,
                min(currency) AS currency
         FROM crm_deal
         WHERE deleted_at IS NULL AND stage NOT IN ('CLOSED_WON','CLOSED_LOST')
         GROUP BY stage`,
      )) as Array<{ stage: string; count: number; total_minor: string; weighted_minor: string; currency: string | null }>;
      const currency = rows.find((r) => r.currency)?.currency ?? 'PKR';
      const stages = rows.map((r) => ({
        stage: r.stage,
        count: Number(r.count),
        total: { amountMinor: Number(r.total_minor), currency },
        weighted: { amountMinor: Number(r.weighted_minor), currency },
      }));
      const totalMinor = stages.reduce((s, r) => s + r.total.amountMinor, 0);
      const weightedMinorSum = stages.reduce((s, r) => s + r.weighted.amountMinor, 0);
      return {
        stages,
        openTotal: { amountMinor: totalMinor, currency },
        weightedTotal: { amountMinor: weightedMinorSum, currency },
      };
    });
  }

  /** Win/loss analysis: counts + values for won vs lost, and the win rate over closed deals. */
  async winLoss() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT stage, count(*)::int AS count, COALESCE(sum(value_minor),0)::bigint AS total_minor, min(currency) AS currency
         FROM crm_deal WHERE deleted_at IS NULL AND stage IN ('CLOSED_WON','CLOSED_LOST') GROUP BY stage`,
      )) as Array<{ stage: string; count: number; total_minor: string; currency: string | null }>;
      const currency = rows.find((r) => r.currency)?.currency ?? 'PKR';
      const won = rows.find((r) => r.stage === 'CLOSED_WON');
      const lost = rows.find((r) => r.stage === 'CLOSED_LOST');
      const wonCount = Number(won?.count ?? 0);
      const lostCount = Number(lost?.count ?? 0);
      const closed = wonCount + lostCount;
      return {
        won: { count: wonCount, value: { amountMinor: Number(won?.total_minor ?? 0), currency } },
        lost: { count: lostCount, value: { amountMinor: Number(lost?.total_minor ?? 0), currency } },
        winRate: closed ? Math.round((wonCount / closed) * 100) : 0,
      };
    });
  }

  /** Sales leaderboard: won deal count + value grouped by the deal owner (assigned rep). */
  async salesByOwner() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT COALESCE(owner_id, assigned_to) AS owner_id,
                count(*)::int AS won_count,
                COALESCE(sum(value_minor),0)::bigint AS won_minor,
                min(currency) AS currency
         FROM crm_deal
         WHERE deleted_at IS NULL AND stage='CLOSED_WON'
         GROUP BY COALESCE(owner_id, assigned_to)
         ORDER BY won_minor DESC`,
      )) as Array<{ owner_id: string | null; won_count: number; won_minor: string; currency: string | null }>;
      return rows.map((r) => ({
        ownerId: r.owner_id,
        wonCount: Number(r.won_count),
        wonValue: { amountMinor: Number(r.won_minor), currency: r.currency ?? 'PKR' },
      }));
    });
  }

  /** Lead funnel: lead count by status (NEW→CONVERTED). */
  async leadFunnel() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT status, count(*)::int AS count FROM crm_lead WHERE deleted_at IS NULL GROUP BY status`,
      )) as Array<{ status: string; count: number }>;
      const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));
      return ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'].map((status) => ({
        status,
        count: byStatus.get(status) ?? 0,
      }));
    });
  }
}
