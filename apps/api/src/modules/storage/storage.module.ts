import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global so any module can persist attachments (employee photos, receipts, …) without re-importing.
 * Backed by the tenant-scoped `app_attachment` table; swappable for MinIO/S3 later behind the same API.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
