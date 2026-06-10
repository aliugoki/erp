import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

/**
 * Opens an AsyncLocalStorage scope for every request, seeded with a `requestId` (honoring an inbound
 * `x-request-id` for trace continuity, else a fresh UUID). Echoes the id back on the response and
 * onto the request so the logger picks it up. Runs first so all downstream layers share the scope.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const headerId = req.headers['x-request-id'];
    const requestId = (Array.isArray(headerId) ? headerId[0] : headerId) || randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);
    const ip = req.ip ?? req.socket?.remoteAddress;
    RequestContext.run({ requestId, ip }, () => next());
  }
}
