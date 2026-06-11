import { Injectable } from '@nestjs/common';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

export type BeginOutcome =
  | { status: 'new' }
  | { status: 'replay'; statusCode: number; body: unknown }
  | { status: 'in_progress' }
  | { status: 'mismatch' };

/**
 * The idempotency store (Chunk 7.2), tenant-scoped via RLS. The claim is a single atomic
 * INSERT … ON CONFLICT DO NOTHING, so concurrent first-requests can't both proceed: exactly one
 * inserts (→ 'new'), the others observe the existing row (→ replay / in_progress / mismatch).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Claim the key, or report what the existing record says. */
  async begin(tenantId: string, key: string, requestHash: string): Promise<BeginOutcome> {
    return this.tenantTx.runFor(tenantId, async (m) => {
      const inserted = (await m.query(
        `INSERT INTO idempotency_record (tenant_id, key, request_hash, completed)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, false)
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING id`,
        [key, requestHash],
      )) as unknown[];
      if (inserted.length > 0) return { status: 'new' };

      const rows = (await m.query(
        `SELECT request_hash, status_code, response_body, completed FROM idempotency_record WHERE key=$1`,
        [key],
      )) as Array<{ request_hash: string; status_code: number | null; response_body: unknown; completed: boolean }>;
      const rec = rows[0]!;
      if (rec.request_hash !== requestHash) return { status: 'mismatch' };
      if (!rec.completed) return { status: 'in_progress' };
      return { status: 'replay', statusCode: rec.status_code ?? 200, body: rec.response_body };
    });
  }

  /** Persist the successful response so future duplicates replay it. */
  async complete(tenantId: string, key: string, statusCode: number, body: unknown): Promise<void> {
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(
        `UPDATE idempotency_record SET status_code=$2, response_body=$3::jsonb, completed=true, updated_at=now()
         WHERE key=$1`,
        [key, statusCode, JSON.stringify(body ?? null)],
      ),
    );
  }

  /** Release an uncompleted claim (handler failed) so the client can retry. */
  async abort(tenantId: string, key: string): Promise<void> {
    await this.tenantTx.runFor(tenantId, (m) =>
      m.query(`DELETE FROM idempotency_record WHERE key=$1 AND completed=false`, [key]),
    );
  }
}
