import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { AuditService } from './audit.service';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SENSITIVE = /pass(word)?|secret|token|hash|credential/i;

/** Recursively redact sensitive values so audit rows never store passwords/tokens. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Auto-logs every successful mutating request (POST/PATCH/PUT/DELETE) on a non-public route as an
 * audit row, with the (redacted) request body as `newValue`. Routes that record their own richer
 * before/after diff opt out with `@SkipAudit()`.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const shouldAudit = !isPublic && !skip && MUTATING.has(req.method);

    return next.handle().pipe(
      tap((result) => {
        if (!shouldAudit) return;
        const resourceId = req.params?.id ?? (result as { id?: string })?.id ?? null;
        void this.audit.record({
          action: req.method,
          resource: (req.baseUrl ?? '') + (req.route?.path ?? req.path ?? ''),
          resourceId: resourceId ? String(resourceId) : null,
          newValue: redact(req.body),
        });
      }),
    );
  }
}
