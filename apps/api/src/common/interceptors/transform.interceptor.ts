import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { SuccessEnvelope } from '@metaxperts/shared';

/**
 * Wraps every successful response in the `{ data, meta }` envelope (CLAUDE conventions). A handler
 * that already returns an envelope (an object with a `data` key) is passed through untouched, so a
 * controller can attach pagination `meta` itself. Raw binary responses (`StreamableFile`, `Buffer`)
 * are passed through verbatim — enveloping them would corrupt the bytes.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T>> {
    return next.handle().pipe(
      map((payload): SuccessEnvelope<T> => {
        if (payload instanceof StreamableFile || Buffer.isBuffer(payload)) {
          return payload as unknown as SuccessEnvelope<T>;
        }
        if (payload !== null && typeof payload === 'object' && 'data' in payload) {
          return payload as unknown as SuccessEnvelope<T>;
        }
        return { data: payload };
      }),
    );
  }
}
