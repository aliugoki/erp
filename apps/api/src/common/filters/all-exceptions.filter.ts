import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { PROBLEM_CONTENT_TYPE, type Problem } from '@metaxperts/shared';
import { RequestContext } from '../request-context/request-context';

/**
 * Converts every thrown error into an RFC 7807 `application/problem+json` response (CLAUDE
 * conventions). Validation errors (class-validator) surface as a structured `errors` map; internal
 * errors are logged with their stack but never leak details to the client. Carries the `traceId`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail: string | undefined;
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        detail = resp;
      } else if (resp && typeof resp === 'object') {
        const r = resp as Record<string, unknown>;
        if (Array.isArray(r.message)) {
          // class-validator: { message: string[] }
          detail = 'Validation failed';
          errors = { body: r.message as string[] };
        } else if (typeof r.message === 'string') {
          detail = r.message;
        } else if (r.status === 'error' && r.error && typeof r.error === 'object') {
          // @nestjs/terminus health failure: { status, info, error, details }
          detail = `Unhealthy dependencies: ${Object.keys(r.error as object).join(', ')}`;
        }
      }
    } else if (exception instanceof Error) {
      // Unexpected — log full detail server-side, expose nothing.
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
    }

    const problem: Problem = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      ...(detail ? { detail } : {}),
      ...(errors ? { errors } : {}),
      instance: req.originalUrl ?? req.url,
      traceId: RequestContext.requestId(),
    };

    res.status(status).type(PROBLEM_CONTENT_TYPE).send(problem);
  }
}
