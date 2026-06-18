type Mgr = { query: (sql: string, params?: unknown[]) => Promise<unknown> };
type Row = Record<string, unknown>;

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'NEW' | 'OPEN' | 'PENDING' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';

/** Allocate the next per-tenant ticket number (TKT-000001). */
export async function nextTicketNo(m: Mgr, prefix = 'TKT'): Promise<string> {
  const seq = (await m.query(
    `INSERT INTO hd_doc_seq (tenant_id, doc_type, last_no)
     VALUES (current_setting('app.tenant_id')::uuid, 'TICKET', 1)
     ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_no = hd_doc_seq.last_no + 1
     RETURNING last_no`,
  )) as Array<{ last_no: string }>;
  return `${prefix}-${String(Number(seq[0]!.last_no)).padStart(6, '0')}`;
}

/** Built-in default SLA targets (minutes) used when a tenant hasn't configured a policy for a priority. */
export const DEFAULT_SLA: Record<Priority, { firstResponseMins: number; resolutionMins: number }> = {
  URGENT: { firstResponseMins: 30, resolutionMins: 240 },
  HIGH: { firstResponseMins: 60, resolutionMins: 480 },
  MEDIUM: { firstResponseMins: 240, resolutionMins: 1440 },
  LOW: { firstResponseMins: 480, resolutionMins: 2880 },
};

/** SLA targets for a priority — a tenant policy overrides the built-in default. */
export function slaTargetsFor(priority: Priority, policy?: { firstResponseMins: number; resolutionMins: number } | null) {
  return policy ?? DEFAULT_SLA[priority] ?? DEFAULT_SLA.MEDIUM;
}

// ── Customer email templates ────────────────────────────────────────────────────
export interface TicketEmailInfo {
  ticketNo: string;
  subject: string;
  requesterName: string;
  link: string | null;
  storeName: string;
}

/** Build the customer email for a ticket event. `kind` is 'created' | 'replied' | 'resolved'. */
export function ticketEmail(kind: 'created' | 'replied' | 'resolved', info: TicketEmailInfo): { subject: string; text: string } {
  const hi = `Hi ${info.requesterName.split(' ')[0] || 'there'},`;
  const ref = `your request ${info.ticketNo} ("${info.subject}")`;
  const view = info.link ? `\n\nView the conversation: ${info.link}` : '';
  const sign = `\n\n— The ${info.storeName} support team`;
  switch (kind) {
    case 'created':
      return { subject: `[${info.ticketNo}] We’ve received your request`, text: `${hi}\n\nThanks for getting in touch. We’ve opened ${ref} and a support agent will reply shortly.${view}${sign}` };
    case 'replied':
      return { subject: `[${info.ticketNo}] New reply to your request`, text: `${hi}\n\nThere’s a new reply on ${ref}.${view}${sign}` };
    case 'resolved':
      return { subject: `[${info.ticketNo}] Your request has been resolved`, text: `${hi}\n\nWe’ve marked ${ref} as resolved. If it’s sorted, no action is needed — and we’d love a quick rating.${view}${sign}` };
  }
}

// ── Mappers ───────────────────────────────────────────────────────────────────
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : ((v as string) ?? null));

export function mapTicket(r: Row) {
  return {
    id: r.id as string,
    ticketNo: r.ticket_no as string,
    subject: r.subject as string,
    requesterName: r.requester_name as string,
    requesterEmail: r.requester_email as string,
    clientId: (r.client_id as string) ?? null,
    orderId: (r.order_id as string) ?? null,
    channel: r.channel as string,
    category: (r.category as string) ?? null,
    priority: r.priority as string,
    status: r.status as string,
    assignedTo: (r.assigned_to as string) ?? null,
    assigneeName: (r.assignee_name as string) ?? null,
    teamId: (r.team_id as string) ?? null,
    teamName: (r.team_name as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    firstResponseDueAt: iso(r.first_response_due_at),
    resolutionDueAt: iso(r.resolution_due_at),
    firstRespondedAt: iso(r.first_responded_at),
    resolvedAt: iso(r.resolved_at),
    closedAt: iso(r.closed_at),
    slaPaused: r.sla_paused_at != null,
    firstResponseBreached: !!r.first_response_breached,
    resolutionBreached: !!r.resolution_breached,
    reopenedCount: Number(r.reopened_count ?? 0),
    csatRating: r.csat_rating == null ? null : Number(r.csat_rating),
    csatComment: (r.csat_comment as string) ?? null,
    messageCount: r.message_count == null ? undefined : Number(r.message_count),
    lastActivityAt: iso(r.last_activity_at),
    createdAt: iso(r.created_at),
  };
}

export function mapMessage(r: Row) {
  return {
    id: r.id as string,
    ticketId: r.ticket_id as string,
    authorType: r.author_type as string,
    authorId: (r.author_id as string) ?? null,
    authorName: r.author_name as string,
    body: r.body as string,
    isInternal: !!r.is_internal,
    createdAt: iso(r.created_at),
  };
}

export function mapTeam(r: Row) {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? null,
    memberCount: r.member_count == null ? undefined : Number(r.member_count),
    memberIds: (r.member_ids as string[]) ?? undefined,
  };
}

export function mapSlaPolicy(r: Row) {
  return {
    id: r.id as string,
    priority: r.priority as string,
    firstResponseMins: Number(r.first_response_mins),
    resolutionMins: Number(r.resolution_mins),
    active: !!r.active,
  };
}

export function mapCannedResponse(r: Row) {
  return { id: r.id as string, title: r.title as string, body: r.body as string };
}
