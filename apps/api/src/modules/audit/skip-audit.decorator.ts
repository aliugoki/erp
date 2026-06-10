import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';
/** Opt a route out of the automatic AuditInterceptor (e.g. it records richer before/after itself). */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
