import { createHash } from 'node:crypto';
import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { type Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import { RequestContext } from '../../common/request-context/request-context';
import { IdempotencyService } from './idempotency.service';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Deterministic JSON (sorted keys) so the request fingerprint is stable across key orderings. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * Idempotency-Key support on unsafe requests (Chunk 7.2). When a request carries an `Idempotency-Key`
 * and a tenant is in context, the first one claims the key and (on success) stores its response; a
 * duplicate REPLAYS that stored response without re-running the handler — one effect, identical
 * response. The interceptor captures and replays at its OWN level in the chain, so it stays correct
 * regardless of where it sits relative to the response-envelope interceptor. Reusing a key for a
 * different body → 422; a still-in-flight key → 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly store: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    const tenantId = RequestContext.tenantId();
    if (!UNSAFE.has(req.method) || !key || !tenantId) return next.handle();

    const fingerprint = createHash('sha256')
      .update(`${req.method}:${req.originalUrl ?? req.url}:${stableStringify(req.body ?? null)}`)
      .digest('hex');

    const outcome = await this.store.begin(tenantId, key, fingerprint);
    if (outcome.status === 'mismatch') {
      throw new UnprocessableEntityException('Idempotency-Key was already used for a different request');
    }
    if (outcome.status === 'in_progress') {
      throw new ConflictException('A request with this Idempotency-Key is already in progress');
    }
    if (outcome.status === 'replay') {
      res.status(outcome.statusCode);
      res.setHeader('Idempotency-Replayed', 'true');
      return of(outcome.body);
    }

    // First time through: run the handler, persist its response, then return it.
    const status =
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ?? (req.method === 'POST' ? 201 : 200);
    return next.handle().pipe(
      mergeMap((payload) => from(this.store.complete(tenantId, key, status, payload)).pipe(map(() => payload))),
      catchError((err) => from(this.store.abort(tenantId, key)).pipe(mergeMap(() => throwError(() => err)))),
    );
  }
}
