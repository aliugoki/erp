import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

export interface NotificationSpec {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  /** The domain event that produced this notification — makes creation idempotent per recipient. */
  sourceEventId?: string | null;
}

/**
 * In-app notifications (Chunk 5.1). The durable record of a user-facing event. Created by the
 * notifications consumer inside its tenant transaction (so the row commits with the consumer's
 * `processed_event` dedupe row), and read/marked by the current user via the controller. Email is a
 * separate best-effort channel — a row here exists regardless of SMTP health.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /**
   * Insert a notification inside an EXISTING tenant transaction (the consumer's). Idempotent on
   * (tenant, user, source_event_id): a redelivered event returns null instead of a duplicate row.
   */
  async createInTx(m: EntityManager, spec: NotificationSpec): Promise<{ id: string } | null> {
    const rows = (await m.query(
      `INSERT INTO notification (tenant_id, user_id, type, title, body, source_event_id)
       VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id, source_event_id) WHERE source_event_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [spec.userId, spec.type, spec.title, spec.body ?? null, spec.sourceEventId ?? null],
    )) as Array<{ id: string }>;
    return rows[0] ?? null;
  }

  /** The current user's unread feed (most recent first). */
  listUnread(userId: string) {
    return this.tenantTx.run((m) =>
      m.query(
        `SELECT id, type, title, body, created_at AS "createdAt", read_at AS "readAt"
         FROM notification
         WHERE user_id=$1 AND read_at IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
        [userId],
      ),
    );
  }

  /** Mark one of the current user's notifications read (idempotent; 404 only if it isn't theirs). */
  async markRead(id: string, userId: string): Promise<{ id: string; read: true }> {
    return this.tenantTx.run(async (m) => {
      await m.query(
        `UPDATE notification SET read_at=COALESCE(read_at, now()), updated_at=now()
         WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [id, userId],
      );
      const exists = (await m.query(
        `SELECT id FROM notification WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [id, userId],
      )) as unknown[];
      if (exists.length === 0) throw new NotFoundException('Notification not found');
      return { id, read: true };
    });
  }
}
