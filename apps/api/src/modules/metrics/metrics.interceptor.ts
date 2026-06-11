import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/** Records HTTP request duration + count per route (Chunk 8.2). Uses the matched route PATTERN, not
 * the raw URL, so path ids don't explode metric cardinality. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const start = Date.now();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const record = () => {
      const route = req.route?.path ?? (req.url?.split('?')[0] as string) ?? 'unknown';
      if (route === '/metrics') return; // don't measure the scrape itself
      this.metrics.observeHttp(req.method, route, res.statusCode, Date.now() - start);
    };
    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
