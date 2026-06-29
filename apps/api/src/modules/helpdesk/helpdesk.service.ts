import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  EVENT_TYPES,
  type HelpdeskSlaBreachedV1,
  type HelpdeskTicketAssignedV1,
  type HelpdeskTicketCreatedV1,
  type HelpdeskTicketRepliedV1,
  type HelpdeskTicketResolvedV1,
} from '@metaxperts/shared';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { OutboxService } from '../outbox/outbox.service';
import type {
  AssignTicketDto, CreateTicketDto, CsatDto, ReplyDto, SetStatusDto,
  UpdateTicketDto, UpsertCannedResponseDto, UpsertSlaPolicyDto, UpsertTeamDto,
} from './dto/helpdesk.dto';
import {
  type Priority, mapCannedResponse, mapMessage, mapSlaPolicy, mapTeam, mapTicket, nextTicketNo, slaTargetsFor,
} from './helpdesk.util';

type Row = Record<string, unknown>;
type Mgr = EntityManager;

/** Ticket row enriched with assignee email, team name, and public message count. */
const TICKET_SELECT = `
  SELECT t.*,
    (SELECT email FROM users u WHERE u.id = t.assigned_to) AS assignee_name,
    (SELECT name FROM hd_team tm WHERE tm.id = t.team_id) AS team_name,
    (SELECT count(*) FROM hd_message m WHERE m.ticket_id = t.id AND m.is_internal = false) AS message_count
  FROM hd_ticket t`;

/**
 * Help Desk — support tickets with an SLA engine. Tickets carry per-priority first-response + resolution
 * targets whose clock pauses while a ticket waits on the customer (status PENDING); a threaded
 * conversation of agent replies, internal notes, and system events; agent/team assignment; CSAT; and a
 * customer portal. Domain events flow through the outbox for notifications + customer emails (ADR-004).
 */
@Injectable()
export class HelpdeskService {
  constructor(
    private readonly tenantTx: TenantTransactionService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  // ── SLA helpers ───────────────────────────────────────────────────────────────
  private async slaTargetsInTx(m: Mgr, priority: Priority) {
    const rows = (await m.query(
      `SELECT first_response_mins, resolution_mins FROM hd_sla_policy WHERE priority = $1 AND active = true AND deleted_at IS NULL`,
      [priority],
    )) as Array<{ first_response_mins: number; resolution_mins: number }>;
    return slaTargetsFor(priority, rows[0] ? { firstResponseMins: Number(rows[0].first_response_mins), resolutionMins: Number(rows[0].resolution_mins) } : null);
  }

  private async ticketRow(m: Mgr, id: string): Promise<Row> {
    const rows = (await m.query(`${TICKET_SELECT} WHERE t.id = $1 AND t.deleted_at IS NULL`, [id])) as Row[];
    if (!rows[0]) throw new NotFoundException('Ticket not found');
    return rows[0];
  }

  private async withMessages(m: Mgr, id: string, includeInternal: boolean) {
    const ticket = mapTicket(await this.ticketRow(m, id));
    const msgs = (await m.query(
      `SELECT * FROM hd_message WHERE ticket_id = $1 ${includeInternal ? '' : 'AND is_internal = false'} ORDER BY created_at`,
      [id],
    )) as Row[];
    return { ...ticket, messages: msgs.map(mapMessage) };
  }

  private async systemNote(m: Mgr, ticketId: string, body: string) {
    await m.query(
      `INSERT INTO hd_message (tenant_id, ticket_id, author_type, author_name, body, is_internal)
       VALUES (current_setting('app.tenant_id')::uuid, $1, 'SYSTEM', 'System', $2, true)`,
      [ticketId, body],
    );
  }

  private touch(m: Mgr, ticketId: string) {
    return m.query(`UPDATE hd_ticket SET last_activity_at = now() WHERE id = $1`, [ticketId]);
  }

  private async agentEmail(m: Mgr, agentId: string): Promise<string> {
    const rows = (await m.query(`SELECT email FROM users WHERE id = $1`, [agentId])) as Array<{ email: string }>;
    return rows[0]?.email ?? 'Agent';
  }

  // ── Create ──────────────────────────────────────────────────────────────────────
  async createTicket(dto: CreateTicketDto, agentId: string | null) {
    return this.tenantTx.run(async (m) => {
      const priority = (dto.priority as Priority) ?? 'MEDIUM';
      const t = await this.slaTargetsInTx(m, priority);
      const ticketNo = await nextTicketNo(m);
      const status = dto.assignedTo ? 'OPEN' : 'NEW';
      const rows = (await m.query(
        `INSERT INTO hd_ticket (tenant_id, ticket_no, subject, requester_name, requester_email, client_id, order_id,
            channel, category, priority, status, assigned_to, team_id, tags,
            first_response_due_at, resolution_due_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6,
            COALESCE($7,'WEB'), $8, $9, $10, $11, $12, $13,
            now() + ($14 * interval '1 minute'), now() + ($15 * interval '1 minute'))
         RETURNING id`,
        [ticketNo, dto.subject, dto.requesterName, dto.requesterEmail.toLowerCase(), dto.clientId ?? null, dto.orderId ?? null,
          dto.channel ?? null, dto.category ?? null, priority, status, dto.assignedTo ?? null, dto.teamId ?? null, dto.tags ?? [],
          t.firstResponseMins, t.resolutionMins],
      )) as Array<{ id: string }>;
      const id = rows[0]!.id;
      await m.query(
        `INSERT INTO hd_message (tenant_id, ticket_id, author_type, author_name, body, is_internal)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'CUSTOMER', $2, $3, false)`,
        [id, dto.requesterName, dto.body],
      );
      const created: HelpdeskTicketCreatedV1 = {
        ticketId: id, ticketNo, subject: dto.subject, priority, requesterEmail: dto.requesterEmail.toLowerCase(),
        clientId: dto.clientId ?? null, assignedTo: dto.assignedTo ?? null, teamId: dto.teamId ?? null,
      };
      await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_CREATED, created);
      if (dto.assignedTo) {
        const assigned: HelpdeskTicketAssignedV1 = { ticketId: id, ticketNo, assignedTo: dto.assignedTo };
        await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_ASSIGNED, assigned);
      }
      void agentId;
      return this.withMessages(m, id, true);
    });
  }

  // ── Conversation ──────────────────────────────────────────────────────────────
  async reply(ticketId: string, dto: ReplyDto, agentId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.ticketRow(m, ticketId);
      if (t.status === 'CLOSED') throw new BadRequestException('Reopen the ticket before replying');
      const internal = !!dto.isInternal;
      const email = await this.agentEmail(m, agentId);
      await m.query(
        `INSERT INTO hd_message (tenant_id, ticket_id, author_type, author_id, author_name, body, is_internal)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'AGENT', $2, $3, $4, $5)`,
        [ticketId, agentId, email, dto.body, internal],
      );
      if (!internal) {
        // First public agent reply meets the first-response SLA; a reply also moves NEW/PENDING → OPEN.
        await m.query(
          `UPDATE hd_ticket SET first_responded_at = COALESCE(first_responded_at, now()),
              status = CASE WHEN status IN ('NEW','PENDING') THEN 'OPEN' ELSE status END
           WHERE id = $1`,
          [ticketId],
        );
        const payload: HelpdeskTicketRepliedV1 = {
          ticketId, ticketNo: t.ticket_no as string, requesterEmail: t.requester_email as string,
          authorType: 'AGENT', assignedTo: (t.assigned_to as string) ?? null,
        };
        await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_REPLIED, payload);
      }
      await this.touch(m, ticketId);
      return this.withMessages(m, ticketId, true);
    });
  }

  // ── Status / SLA pause-resume ─────────────────────────────────────────────────
  async setStatus(ticketId: string, dto: SetStatusDto, agentId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.ticketRow(m, ticketId);
      const agentEmail = await this.agentEmail(m, agentId);
      const cur = t.status as string;
      const next = dto.status;
      if (cur === next) return this.withMessages(m, ticketId, true);

      // Pause the SLA clock when waiting on the customer; resume (shifting the due dates) when leaving.
      if (next === 'PENDING' && cur !== 'PENDING') {
        await m.query(`UPDATE hd_ticket SET sla_paused_at = COALESCE(sla_paused_at, now()) WHERE id = $1`, [ticketId]);
      } else if (cur === 'PENDING' && next !== 'PENDING') {
        await m.query(
          `UPDATE hd_ticket SET
              resolution_due_at = resolution_due_at + (now() - sla_paused_at),
              first_response_due_at = CASE WHEN first_responded_at IS NULL THEN first_response_due_at + (now() - sla_paused_at) ELSE first_response_due_at END,
              sla_paused_at = NULL
           WHERE id = $1 AND sla_paused_at IS NOT NULL`,
          [ticketId],
        );
      }

      const reopening = ['RESOLVED', 'CLOSED'].includes(cur) && ['OPEN', 'PENDING'].includes(next);
      await m.query(
        `UPDATE hd_ticket SET status = $2,
            resolved_at = CASE WHEN $2 = 'RESOLVED' THEN COALESCE(resolved_at, now()) WHEN $3 THEN NULL ELSE resolved_at END,
            closed_at   = CASE WHEN $2 = 'CLOSED'   THEN now() WHEN $3 THEN NULL ELSE closed_at END,
            reopened_count = reopened_count + CASE WHEN $3 THEN 1 ELSE 0 END,
            last_activity_at = now()
         WHERE id = $1`,
        [ticketId, next, reopening],
      );
      await this.systemNote(m, ticketId, `Status changed from ${cur} to ${next} by ${agentEmail}`);
      if (next === 'RESOLVED' && cur !== 'RESOLVED') {
        const payload: HelpdeskTicketResolvedV1 = {
          ticketId, ticketNo: t.ticket_no as string, requesterEmail: t.requester_email as string, clientId: (t.client_id as string) ?? null,
        };
        await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_RESOLVED, payload);
      }
      return this.withMessages(m, ticketId, true);
    });
  }

  // ── Assign / update / csat ──────────────────────────────────────────────────────
  async assign(ticketId: string, dto: AssignTicketDto, agentId: string) {
    return this.tenantTx.run(async (m) => {
      const t = await this.ticketRow(m, ticketId);
      const agentEmail = await this.agentEmail(m, agentId);
      await m.query(
        `UPDATE hd_ticket SET assigned_to = $2::uuid, team_id = $3::uuid,
            status = CASE WHEN status = 'NEW' AND $2::uuid IS NOT NULL THEN 'OPEN' ELSE status END, last_activity_at = now()
         WHERE id = $1`,
        [ticketId, dto.assignedTo ?? null, dto.teamId ?? null],
      );
      await this.systemNote(m, ticketId, `Assignment updated by ${agentEmail}`);
      if (dto.assignedTo && dto.assignedTo !== (t.assigned_to as string)) {
        const payload: HelpdeskTicketAssignedV1 = { ticketId, ticketNo: t.ticket_no as string, assignedTo: dto.assignedTo };
        await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_ASSIGNED, payload);
      }
      return this.withMessages(m, ticketId, true);
    });
  }

  async updateTicket(ticketId: string, dto: UpdateTicketDto) {
    return this.tenantTx.run(async (m) => {
      const t = await this.ticketRow(m, ticketId);
      // Re-target the SLA if the priority changed (relative to creation), preserving any met targets.
      let firstMins: number | null = null;
      let resMins: number | null = null;
      if (dto.priority && dto.priority !== (t.priority as string)) {
        const tg = await this.slaTargetsInTx(m, dto.priority as Priority);
        firstMins = tg.firstResponseMins;
        resMins = tg.resolutionMins;
      }
      await m.query(
        `UPDATE hd_ticket SET subject = COALESCE($2, subject), priority = COALESCE($3, priority),
            category = COALESCE($4, category), tags = COALESCE($5, tags),
            first_response_due_at = CASE WHEN $6::int IS NOT NULL AND first_responded_at IS NULL THEN created_at + ($6 * interval '1 minute') ELSE first_response_due_at END,
            resolution_due_at = CASE WHEN $7::int IS NOT NULL AND resolved_at IS NULL THEN created_at + ($7 * interval '1 minute') ELSE resolution_due_at END,
            last_activity_at = now()
         WHERE id = $1`,
        [ticketId, dto.subject ?? null, dto.priority ?? null, dto.category ?? null, dto.tags ?? null, firstMins, resMins],
      );
      return this.withMessages(m, ticketId, true);
    });
  }

  async setCsat(ticketId: string, dto: CsatDto) {
    return this.tenantTx.run(async (m) => {
      const t = await this.ticketRow(m, ticketId);
      if (!['RESOLVED', 'CLOSED'].includes(t.status as string)) throw new BadRequestException('Only resolved tickets can be rated');
      await m.query(`UPDATE hd_ticket SET csat_rating = $2, csat_comment = $3 WHERE id = $1`, [ticketId, dto.rating, dto.comment ?? null]);
      return this.withMessages(m, ticketId, true);
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────
  async listTickets(filter: { status?: string; priority?: string; assignedTo?: string; teamId?: string; q?: string; breached?: boolean; unassigned?: boolean }) {
    return this.tenantTx.run(async (m) => {
      const conds = ['t.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter.status) conds.push(`t.status = $${params.push(filter.status)}`);
      if (filter.priority) conds.push(`t.priority = $${params.push(filter.priority)}`);
      if (filter.assignedTo) conds.push(`t.assigned_to = $${params.push(filter.assignedTo)}`);
      if (filter.teamId) conds.push(`t.team_id = $${params.push(filter.teamId)}`);
      if (filter.unassigned) conds.push(`t.assigned_to IS NULL`);
      // "Breached" = an ACTIVE breach — match the dashboard KPI by excluding resolved/closed tickets,
      // whose historical breach flags are kept only as an audit record.
      if (filter.breached) conds.push(`((t.first_response_breached OR t.resolution_breached) AND t.status NOT IN ('RESOLVED','CLOSED'))`);
      if (filter.q) conds.push(`(t.subject ILIKE $${params.push(`%${filter.q}%`)} OR t.ticket_no ILIKE $${params.length} OR t.requester_email ILIKE $${params.length})`);
      const rows = (await m.query(`${TICKET_SELECT} WHERE ${conds.join(' AND ')} ORDER BY t.last_activity_at DESC LIMIT 200`, params)) as Row[];
      return rows.map(mapTicket);
    });
  }

  async getTicket(id: string) {
    return this.tenantTx.run((m) => this.withMessages(m, id, true));
  }

  async overview() {
    return this.tenantTx.run(async (m) => {
      const byStatus = (await m.query(
        `SELECT status, count(*)::int AS n FROM hd_ticket WHERE deleted_at IS NULL GROUP BY status`,
      )) as Array<{ status: string; n: number }>;
      const agg = (await m.query(
        `SELECT
            count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED'))::int AS open,
            count(*) FILTER (WHERE assigned_to IS NULL AND status NOT IN ('RESOLVED','CLOSED'))::int AS unassigned,
            count(*) FILTER (WHERE (first_response_breached OR resolution_breached) AND status NOT IN ('RESOLVED','CLOSED'))::int AS breached,
            round(avg(csat_rating)::numeric, 2) AS csat_avg,
            count(csat_rating)::int AS csat_count
         FROM hd_ticket WHERE deleted_at IS NULL`,
      )) as Array<Row>;
      const a = agg[0] ?? {};
      return {
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
        open: Number(a.open ?? 0),
        unassigned: Number(a.unassigned ?? 0),
        breached: Number(a.breached ?? 0),
        csatAvg: a.csat_avg == null ? null : Number(a.csat_avg),
        csatCount: Number(a.csat_count ?? 0),
      };
    });
  }

  /** Users who can be assigned tickets (support agents + admins). */
  async listAgents() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT id, email FROM users WHERE roles && ARRAY['SUPPORT_AGENT','TENANT_ADMIN'] AND is_active = true AND deleted_at IS NULL ORDER BY email`,
      )) as Array<{ id: string; email: string }>;
      return rows.map((r) => ({ id: r.id, email: r.email }));
    });
  }

  // ── Teams ─────────────────────────────────────────────────────────────────────
  async listTeams() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT t.*, (SELECT count(*) FROM hd_team_member tm WHERE tm.team_id = t.id) AS member_count,
                (SELECT array_agg(tm.user_id) FROM hd_team_member tm WHERE tm.team_id = t.id) AS member_ids
         FROM hd_team t WHERE t.deleted_at IS NULL ORDER BY t.name`,
      )) as Row[];
      return rows.map(mapTeam);
    });
  }

  async createTeam(dto: UpsertTeamDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hd_team (tenant_id, name, description) VALUES (current_setting('app.tenant_id')::uuid, $1, $2) RETURNING id`,
        [dto.name, dto.description ?? null],
      )) as Array<{ id: string }>;
      if (dto.memberIds) await this.setTeamMembers(m, rows[0]!.id, dto.memberIds);
      return { id: rows[0]!.id };
    });
  }

  async updateTeam(id: string, dto: UpsertTeamDto) {
    return this.tenantTx.run(async (m) => {
      const rows = rowsOf(await m.query(
        `UPDATE hd_team SET name = COALESCE($2, name), description = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id, dto.name ?? null, dto.description ?? null],
      )) as Array<{ id: string }>;
      if (!rows[0]) throw new NotFoundException('Team not found');
      if (dto.memberIds) await this.setTeamMembers(m, id, dto.memberIds);
      return { ok: true };
    });
  }

  private async setTeamMembers(m: Mgr, teamId: string, userIds: string[]) {
    await m.query(`DELETE FROM hd_team_member WHERE team_id = $1`, [teamId]);
    for (const uid of userIds) {
      await m.query(
        `INSERT INTO hd_team_member (tenant_id, team_id, user_id) VALUES (current_setting('app.tenant_id')::uuid, $1, $2) ON CONFLICT DO NOTHING`,
        [teamId, uid],
      );
    }
  }

  async deleteTeam(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE hd_team SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── SLA policies ────────────────────────────────────────────────────────────────
  async listSlaPolicies() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM hd_sla_policy WHERE deleted_at IS NULL ORDER BY priority`)) as Row[];
      return rows.map(mapSlaPolicy);
    });
  }

  async upsertSlaPolicy(dto: UpsertSlaPolicyDto) {
    return this.tenantTx.run(async (m) => {
      await m.query(
        `INSERT INTO hd_sla_policy (tenant_id, priority, first_response_mins, resolution_mins, active)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, COALESCE($4,true))
         ON CONFLICT (tenant_id, priority) WHERE deleted_at IS NULL
         DO UPDATE SET first_response_mins = $2, resolution_mins = $3, active = COALESCE($4, hd_sla_policy.active), updated_at = now()`,
        [dto.priority, dto.firstResponseMins, dto.resolutionMins, dto.active ?? null],
      );
      return this.listSlaPolicies();
    });
  }

  // ── Canned responses ──────────────────────────────────────────────────────────
  async listCanned() {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT * FROM hd_canned_response WHERE deleted_at IS NULL ORDER BY title`)) as Row[];
      return rows.map(mapCannedResponse);
    });
  }

  async createCanned(dto: UpsertCannedResponseDto) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `INSERT INTO hd_canned_response (tenant_id, title, body) VALUES (current_setting('app.tenant_id')::uuid, $1, $2) RETURNING *`,
        [dto.title, dto.body],
      )) as Row[];
      return mapCannedResponse(rows[0]!);
    });
  }

  async deleteCanned(id: string) {
    return this.tenantTx.run(async (m) => {
      await m.query(`UPDATE hd_canned_response SET deleted_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  // ── Consumer reads (notifications / email) ──────────────────────────────────────
  async ticketForNotifyInTx(m: Mgr, ticketId: string) {
    const rows = (await m.query(
      `SELECT ticket_no, subject, requester_name, requester_email, priority, status, assigned_to FROM hd_ticket WHERE id = $1 AND deleted_at IS NULL`,
      [ticketId],
    )) as Row[];
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ticketNo: r.ticket_no as string, subject: r.subject as string, requesterName: r.requester_name as string,
      requesterEmail: r.requester_email as string, priority: r.priority as string, status: r.status as string,
      assignedTo: (r.assigned_to as string) ?? null,
    };
  }

  // ── SLA breach sweep (scheduler) ────────────────────────────────────────────────
  private async sweepBreachesInTx(m: Mgr): Promise<HelpdeskSlaBreachedV1[]> {
    const breaches: HelpdeskSlaBreachedV1[] = [];
    // First-response breaches: open, not paused, not yet responded, past due, not already flagged.
    const fr = rowsOf(await m.query(
      `UPDATE hd_ticket SET first_response_breached = true
       WHERE status IN ('NEW','OPEN') AND sla_paused_at IS NULL AND first_responded_at IS NULL
         AND first_response_due_at < now() AND first_response_breached = false AND deleted_at IS NULL
       RETURNING id, ticket_no, assigned_to, team_id`,
    )) as Array<Row>;
    const res = rowsOf(await m.query(
      `UPDATE hd_ticket SET resolution_breached = true
       WHERE status NOT IN ('RESOLVED','CLOSED') AND sla_paused_at IS NULL AND resolved_at IS NULL
         AND resolution_due_at < now() AND resolution_breached = false AND deleted_at IS NULL
       RETURNING id, ticket_no, assigned_to, team_id`,
    )) as Array<Row>;
    for (const r of fr) breaches.push({ ticketId: r.id as string, ticketNo: r.ticket_no as string, breachType: 'FIRST_RESPONSE', assignedTo: (r.assigned_to as string) ?? null, teamId: (r.team_id as string) ?? null });
    for (const r of res) breaches.push({ ticketId: r.id as string, ticketNo: r.ticket_no as string, breachType: 'RESOLUTION', assignedTo: (r.assigned_to as string) ?? null, teamId: (r.team_id as string) ?? null });
    for (const b of breaches) await this.outbox.write(m, EVENT_TYPES.HELPDESK_SLA_BREACHED, b);
    return breaches;
  }

  async sweepBreaches() {
    return this.tenantTx.run(async (m) => ({ breached: (await this.sweepBreachesInTx(m)).length }));
  }

  async sweepBreachesAllTenants(): Promise<number> {
    const tenants = (await this.dataSource.query(`SELECT id FROM tenants WHERE status = 'active'`)) as Array<{ id: string }>;
    let total = 0;
    for (const { id } of tenants) {
      try {
        total += (await this.tenantTx.runFor(id, (m) => this.sweepBreachesInTx(m))).length;
      } catch {
        /* one tenant's failure shouldn't stop the sweep */
      }
    }
    return total;
  }

  // ── Customer portal ─────────────────────────────────────────────────────────────
  async portalCreate(customer: { id: string; name: string; email: string }, dto: { subject: string; body: string; priority?: string; orderNo?: string }) {
    return this.createTicketAsCustomer(customer, dto);
  }

  private async createTicketAsCustomer(customer: { id: string; name: string; email: string }, dto: { subject: string; body: string; priority?: string; orderNo?: string }) {
    return this.tenantTx.run(async (m) => {
      let orderId: string | null = null;
      let clientId: string | null = null;
      if (dto.orderNo) {
        const ord = (await m.query(`SELECT id, client_id FROM ec_order WHERE order_no = $1 AND lower(customer_email) = lower($2) AND deleted_at IS NULL`, [dto.orderNo, customer.email])) as Array<{ id: string; client_id: string | null }>;
        if (ord[0]) { orderId = ord[0].id; clientId = ord[0].client_id ?? null; }
      }
      if (!clientId) {
        const cc = (await m.query(`SELECT client_id FROM crm_contact WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`, [customer.email])) as Array<{ client_id: string }>;
        clientId = cc[0]?.client_id ?? null;
      }
      const priority = (['LOW', 'MEDIUM', 'HIGH'].includes(dto.priority ?? '') ? dto.priority : 'MEDIUM') as Priority;
      const t = await this.slaTargetsInTx(m, priority);
      const ticketNo = await nextTicketNo(m);
      const rows = (await m.query(
        `INSERT INTO hd_ticket (tenant_id, ticket_no, subject, requester_name, requester_email, client_id, order_id, channel, priority, status, first_response_due_at, resolution_due_at)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6, 'WEB', $7, 'NEW', now() + ($8 * interval '1 minute'), now() + ($9 * interval '1 minute'))
         RETURNING id`,
        [ticketNo, dto.subject, customer.name, customer.email.toLowerCase(), clientId, orderId, priority, t.firstResponseMins, t.resolutionMins],
      )) as Array<{ id: string }>;
      const id = rows[0]!.id;
      await m.query(
        `INSERT INTO hd_message (tenant_id, ticket_id, author_type, author_id, author_name, body, is_internal)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'CUSTOMER', $2, $3, $4, false)`,
        [id, customer.id, customer.name, dto.body],
      );
      const created: HelpdeskTicketCreatedV1 = { ticketId: id, ticketNo, subject: dto.subject, priority, requesterEmail: customer.email.toLowerCase(), clientId, assignedTo: null, teamId: null };
      await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_CREATED, created);
      return this.portalView(m, id, customer.email);
    });
  }

  async portalList(customer: { email: string }) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `${TICKET_SELECT} WHERE lower(t.requester_email) = lower($1) AND t.deleted_at IS NULL ORDER BY t.last_activity_at DESC LIMIT 100`,
        [customer.email],
      )) as Row[];
      return rows.map(mapTicket);
    });
  }

  async portalGet(customer: { email: string }, ticketNo: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, requester_email FROM hd_ticket WHERE ticket_no = $1 AND deleted_at IS NULL`, [ticketNo])) as Array<{ id: string; requester_email: string }>;
      if (!rows[0] || rows[0].requester_email.toLowerCase() !== customer.email.toLowerCase()) throw new NotFoundException('Ticket not found');
      return this.portalView(m, rows[0].id, customer.email);
    });
  }

  /** Portal view: only public messages (internal notes are never exposed to the customer). */
  private async portalView(m: Mgr, id: string, email: string) {
    const ticket = mapTicket(await this.ticketRow(m, id));
    if (ticket.requesterEmail.toLowerCase() !== email.toLowerCase()) throw new ForbiddenException();
    const msgs = (await m.query(`SELECT * FROM hd_message WHERE ticket_id = $1 AND is_internal = false ORDER BY created_at`, [id])) as Row[];
    return { ...ticket, messages: msgs.map(mapMessage) };
  }

  async portalReply(customer: { id: string; name: string; email: string }, ticketNo: string, body: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, requester_email, status, assigned_to, sla_paused_at FROM hd_ticket WHERE ticket_no = $1 AND deleted_at IS NULL`, [ticketNo])) as Array<{ id: string; requester_email: string; status: string; assigned_to: string | null; sla_paused_at: unknown }>;
      const t = rows[0];
      if (!t || t.requester_email.toLowerCase() !== customer.email.toLowerCase()) throw new NotFoundException('Ticket not found');
      await m.query(
        `INSERT INTO hd_message (tenant_id, ticket_id, author_type, author_id, author_name, body, is_internal)
         VALUES (current_setting('app.tenant_id')::uuid, $1, 'CUSTOMER', $2, $3, $4, false)`,
        [t.id, customer.id, customer.name, body],
      );
      // A customer reply resumes a paused SLA and reopens a pending/resolved ticket.
      if (t.sla_paused_at != null) {
        await m.query(
          `UPDATE hd_ticket SET resolution_due_at = resolution_due_at + (now() - sla_paused_at),
              first_response_due_at = CASE WHEN first_responded_at IS NULL THEN first_response_due_at + (now() - sla_paused_at) ELSE first_response_due_at END,
              sla_paused_at = NULL WHERE id = $1`,
          [t.id],
        );
      }
      if (['PENDING', 'RESOLVED'].includes(t.status)) {
        await m.query(
          `UPDATE hd_ticket SET status = 'OPEN', resolved_at = NULL, reopened_count = reopened_count + CASE WHEN $2 = 'RESOLVED' THEN 1 ELSE 0 END WHERE id = $1`,
          [t.id, t.status],
        );
      }
      await this.touch(m, t.id);
      const payload: HelpdeskTicketRepliedV1 = { ticketId: t.id, ticketNo, requesterEmail: t.requester_email, authorType: 'CUSTOMER', assignedTo: t.assigned_to };
      await this.outbox.write(m, EVENT_TYPES.HELPDESK_TICKET_REPLIED, payload);
      return this.portalView(m, t.id, customer.email);
    });
  }

  async portalCsat(customer: { email: string }, ticketNo: string, rating: number, comment?: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(`SELECT id, requester_email, status FROM hd_ticket WHERE ticket_no = $1 AND deleted_at IS NULL`, [ticketNo])) as Array<{ id: string; requester_email: string; status: string }>;
      const t = rows[0];
      if (!t || t.requester_email.toLowerCase() !== customer.email.toLowerCase()) throw new NotFoundException('Ticket not found');
      if (!['RESOLVED', 'CLOSED'].includes(t.status)) throw new BadRequestException('You can rate a ticket once it’s resolved');
      await m.query(`UPDATE hd_ticket SET csat_rating = $2, csat_comment = $3 WHERE id = $1`, [t.id, rating, comment ?? null]);
      return this.portalView(m, t.id, customer.email);
    });
  }
}

/** TypeORM returns `[rows, affectedCount]` for UPDATE…RETURNING but a plain array otherwise. */
function rowsOf(res: unknown): unknown[] {
  if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') return res[0];
  return (res ?? []) as unknown[];
}
