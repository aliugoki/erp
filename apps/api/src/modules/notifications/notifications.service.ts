import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';
import { NOTIFICATION_CATEGORIES, type Severity } from './notifications.util';

export interface NotificationSpec {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  severity?: Severity;
  category?: string;
  link?: string | null;
  /** The domain event that produced this notification — makes creation idempotent per recipient. */
  sourceEventId?: string | null;
}

export type FeedFilter = 'unread' | 'all' | 'archived';
export interface FeedQuery {
  filter?: FeedFilter;
  category?: string;
  page?: number;
  pageSize?: number;
}

const FEED_COLS =
  'id, type, title, body, severity, category, link, created_at AS "createdAt", read_at AS "readAt", archived_at AS "archivedAt"';

/**
 * In-app notifications (Chunk 5.1, completed). The durable record of a user-facing event. Created by
 * the notifications consumer inside its tenant transaction (so the row commits with the consumer's
 * `processed_event` dedupe row) and read/managed by the current user via the controller. Per-user,
 * per-category channel preferences gate both the in-app row and the email side-channel. Email is a
 * separate best-effort channel — a row here exists regardless of SMTP health.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /**
   * Insert a notification inside an EXISTING tenant transaction (the consumer's). Honors the
   * recipient's in-app preference for the category (muted → no row). Idempotent on
   * (tenant, user, source_event_id): a redelivered event returns null instead of a duplicate row.
   */
  async createInTx(m: EntityManager, spec: NotificationSpec): Promise<{ id: string } | null> {
    if (spec.category && !(await this.inAppEnabled(m, spec.userId, spec.category))) return null;
    const rows = (await m.query(
      `INSERT INTO notification (tenant_id, user_id, type, title, body, severity, category, link, source_event_id)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, COALESCE($5,'INFO'), COALESCE($6,'system'), $7, $8)
       ON CONFLICT (tenant_id, user_id, source_event_id) WHERE source_event_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [spec.userId, spec.type, spec.title, spec.body ?? null, spec.severity ?? null, spec.category ?? null, spec.link ?? null, spec.sourceEventId ?? null],
    )) as Array<{ id: string }>;
    return rows[0] ?? null;
  }

  /** The current user's unread feed (most recent first). Used by the bell + the e2e contract. */
  listUnread(userId: string) {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT ${FEED_COLS} FROM notification
         WHERE user_id=$1 AND read_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
        [userId],
      ),
    );
  }

  /** Paginated feed across states (unread | all | archived), optionally by category. */
  async feed(userId: string, q: FeedQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const filter = q.filter ?? 'unread';
    return this.tenantTx.run(async (m) => {
      const where = ['user_id=$1', 'deleted_at IS NULL'];
      const params: unknown[] = [userId];
      if (filter === 'unread') where.push('read_at IS NULL', 'archived_at IS NULL');
      else if (filter === 'all') where.push('archived_at IS NULL');
      else where.push('archived_at IS NOT NULL');
      if (q.category) where.push(`category=$${params.push(q.category)}`);
      const clause = where.join(' AND ');
      const total = Number(((await m.query(`SELECT count(*) AS c FROM notification WHERE ${clause}`, params)) as Array<{ c: string }>)[0]!.c);
      const rows = (await m.query(
        `SELECT ${FEED_COLS} FROM notification WHERE ${clause} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      )) as unknown[];
      return { data: rows, meta: { pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
    });
  }

  /** Unread (non-archived) count for the bell badge. */
  async unreadCount(userId: string): Promise<{ count: number }> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT count(*) AS c FROM notification WHERE user_id=$1 AND read_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL`,
        [userId],
      )) as Array<{ c: string }>;
      return { count: Number(rows[0]!.c) };
    });
  }

  /** Mark one of the current user's notifications read (idempotent; 404 only if it isn't theirs). */
  markRead(id: string, userId: string): Promise<{ id: string; read: true }> {
    return this.tenantTx.run(async (m) => {
      await this.mutateOwned(m, id, userId, 'read_at=COALESCE(read_at, now())');
      return { id, read: true };
    });
  }

  markUnread(id: string, userId: string): Promise<{ id: string; read: false }> {
    return this.tenantTx.run(async (m) => {
      await this.mutateOwned(m, id, userId, 'read_at=NULL');
      return { id, read: false };
    });
  }

  archive(id: string, userId: string): Promise<{ id: string; archived: true }> {
    return this.tenantTx.run(async (m) => {
      await this.mutateOwned(m, id, userId, 'archived_at=now(), read_at=COALESCE(read_at, now())');
      return { id, archived: true };
    });
  }

  remove(id: string, userId: string): Promise<void> {
    return this.tenantTx.run(async (m) => {
      await this.mutateOwned(m, id, userId, 'deleted_at=now()');
    });
  }

  /** Mark every unread (non-archived) notification read. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    return this.tenantTx.run(async (m) => {
      const res = (await m.query(
        `UPDATE notification SET read_at=now(), updated_at=now()
         WHERE user_id=$1 AND read_at IS NULL AND archived_at IS NULL AND deleted_at IS NULL`,
        [userId],
      )) as unknown;
      const affected = Array.isArray(res) && typeof res[1] === 'number' ? (res[1] as number) : 0;
      return { updated: affected };
    });
  }

  // ── Preferences ──────────────────────────────────────────────────────────────
  /** Per-category channel preferences (defaults: in-app on, email off). */
  async getPreferences(userId: string) {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT category, in_app AS "inApp", email FROM notification_preference WHERE user_id=$1 AND deleted_at IS NULL`,
        [userId],
      )) as Array<{ category: string; inApp: boolean; email: boolean }>;
      const byCat = new Map(rows.map((r) => [r.category, r]));
      return NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        inApp: byCat.get(category)?.inApp ?? true,
        email: byCat.get(category)?.email ?? false,
      }));
    });
  }

  async setPreference(userId: string, category: string, pref: { inApp: boolean; email: boolean }) {
    if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException(`Unknown category "${category}"`);
    }
    return this.tenantTx.run(async (m) => {
      await m.query(
        `INSERT INTO notification_preference (tenant_id, user_id, category, in_app, email)
         VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4)
         ON CONFLICT (tenant_id, user_id, category) DO UPDATE SET in_app=EXCLUDED.in_app, email=EXCLUDED.email, updated_at=now()`,
        [userId, category, pref.inApp, pref.email],
      );
      return { category, inApp: pref.inApp, email: pref.email };
    });
  }

  // ── Consumer helpers (run inside the consumer's tenant tx) ────────────────────
  /** Resolve active recipient users that hold any of the given roles (for role-addressed events). */
  async resolveRoleRecipients(m: EntityManager, roles: string[]): Promise<Array<{ id: string; email: string | null }>> {
    return (await m.query(
      `SELECT id, email FROM users WHERE deleted_at IS NULL AND is_active = true AND roles && $1::text[]`,
      [roles],
    )) as Array<{ id: string; email: string | null }>;
  }

  /** Whether a recipient has opted into email for a category (default: off). */
  async emailEnabled(m: EntityManager, userId: string, category: string): Promise<boolean> {
    const rows = (await m.query(
      `SELECT email FROM notification_preference WHERE user_id=$1 AND category=$2 AND deleted_at IS NULL`,
      [userId, category],
    )) as Array<{ email: boolean }>;
    return rows.length > 0 ? rows[0]!.email === true : false;
  }

  // ── internals ─────────────────────────────────────────────────────────────────
  private async inAppEnabled(m: EntityManager, userId: string, category: string): Promise<boolean> {
    const rows = (await m.query(
      `SELECT in_app FROM notification_preference WHERE user_id=$1 AND category=$2 AND deleted_at IS NULL`,
      [userId, category],
    )) as Array<{ in_app: boolean }>;
    return rows.length === 0 ? true : rows[0]!.in_app === true;
  }

  private async mutateOwned(m: EntityManager, id: string, userId: string, setSql: string): Promise<void> {
    await m.query(`UPDATE notification SET ${setSql}, updated_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId]);
    const exists = (await m.query(`SELECT id FROM notification WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`, [id, userId])) as unknown[];
    if (exists.length === 0) throw new NotFoundException('Notification not found');
  }
}
