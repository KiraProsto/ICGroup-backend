import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ApiErrorBody {
  success: false;
  error: {
    code: number;
    message: string;
    details?: unknown;
  };
  meta: {
    timestamp: string;
    path: string;
  };
}

/**
 * Catches every thrown exception (HTTP or otherwise) and serialises it into
 * the unified error envelope:
 *
 *   { success: false, error: { code, message, details? }, meta: { timestamp, path } }
 *
 * Validation errors from ValidationPipe (BadRequestException with string[])
 * are emitted as `message: "Validation failed"` with the array in `details`.
 *
 * Unexpected (non-HTTP) exceptions are logged server-side and the client
 * only receives a generic 500 message — no internal details leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string;
    let details: unknown;

    if (exception instanceof HttpException) {
      const raw = exception.getResponse();

      if (typeof raw === 'string') {
        message = raw;
      } else if (typeof raw === 'object' && raw !== null) {
        const body = raw as Record<string, unknown>;

        // class-validator produces message as string[] — treat specially.
        if (Array.isArray(body['message'])) {
          message = 'Validation failed';
          details = body['message'];
        } else {
          message = typeof body['message'] === 'string' ? body['message'] : String(status);
        }
      } else {
        message = String(raw);
      }
    } else {
      // Never leak internals to clients; log full detail server-side.
      message = 'Internal server error';
      this.logger.error(
        `Unhandled exception [${request.method} ${request.url}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorBody = {
      success: false,
      error: {
        code: status,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    };

    response.status(status).json(body);
  }
}
