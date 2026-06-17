import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantTransactionService } from '../../common/tenant/tenant-transaction.service';

/** Structural shape of an uploaded file (avoids a hard `@types/multer` dependency). */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size?: number;
}

export interface StoredAttachment {
  id: string;
  byteSize: number;
  contentType: string;
}

export interface FetchedAttachment {
  contentType: string;
  fileName: string | null;
  byteSize: number;
  data: Buffer;
}

/** Default ceiling for a single attachment (8 MiB) — generous for photos/receipts, bounds memory. */
const MAX_BYTES = 8 * 1024 * 1024;

type Row = Record<string, unknown>;

/**
 * Tenant-scoped binary store over `app_attachment` (RLS). A deliberately small abstraction so the
 * storage backend can later become MinIO/S3 without touching callers: they hand over bytes and keep
 * the returned id as their reference. Size-capped in the app layer.
 */
@Injectable()
export class StorageService {
  constructor(private readonly tenantTx: TenantTransactionService) {}

  /** Persist a file and return its attachment id. `kind` namespaces the owner (e.g. `hr.employee_photo`). */
  async put(kind: string, file: UploadedFileLike): Promise<StoredAttachment> {
    return this.tenantTx.run((m) => this.putInTx(m, kind, file));
  }

  /** Same as {@link put} but joins the caller's transaction (atomic with their business write). */
  async putInTx(m: EntityManager, kind: string, file: UploadedFileLike): Promise<StoredAttachment> {
    const bytes = file.buffer;
    if (!bytes || bytes.length === 0) throw new BadRequestException('Empty file');
    if (bytes.length > MAX_BYTES) {
      throw new PayloadTooLargeException(`File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MiB limit`);
    }
    const rows = (await m.query(
      `INSERT INTO app_attachment (tenant_id, kind, content_type, file_name, byte_size, data)
       VALUES (current_setting('app.tenant_id')::uuid, $1,$2,$3,$4,$5) RETURNING id`,
      [kind, file.mimetype || 'application/octet-stream', file.originalname ?? null, bytes.length, bytes],
    )) as Row[];
    return { id: rows[0]!.id as string, byteSize: bytes.length, contentType: file.mimetype };
  }

  /** Fetch an attachment's bytes + metadata, optionally constrained to a `kind`. Null if not found. */
  async get(id: string, kind?: string): Promise<FetchedAttachment | null> {
    return this.tenantTx.run(async (m) => {
      const rows = (await m.query(
        `SELECT content_type, file_name, byte_size, data FROM app_attachment
         WHERE id=$1 AND deleted_at IS NULL ${kind ? 'AND kind=$2' : ''}`,
        kind ? [id, kind] : [id],
      )) as Row[];
      const r = rows[0];
      if (!r) return null;
      return {
        contentType: r.content_type as string,
        fileName: (r.file_name as string) ?? null,
        byteSize: Number(r.byte_size),
        data: r.data as Buffer,
      };
    });
  }

  /** Soft-delete an attachment (best-effort; callers clearing a reference). */
  async remove(id: string): Promise<void> {
    await this.tenantTx.run((m) =>
      m.query(`UPDATE app_attachment SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL`, [id]),
    );
  }
}
