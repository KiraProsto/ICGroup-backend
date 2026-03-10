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

interface ParsedHttpError {
  message: string;
  details?: unknown;
}

function getRequestPath(request: Request): string {
  return request.path;
}

function parseHttpException(exception: HttpException): ParsedHttpError {
  const raw = exception.getResponse();

  if (typeof raw === 'string') {
    return { message: raw };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { message: String(raw) };
  }

  const body = raw as Record<string, unknown>;

  if (Array.isArray(body['message'])) {
    const { message: validationMessages, statusCode: _statusCode, ...rest } = body;
    const details =
      Object.keys(rest).length > 0 ? { ...rest, messages: validationMessages } : validationMessages;

    return {
      message: 'Validation failed',
      details,
    };
  }

  const { message: rawMessage, statusCode: _statusCode, ...rest } = body;
  const message =
    typeof rawMessage === 'string'
      ? rawMessage
      : typeof body['error'] === 'string'
        ? body['error']
        : String(exception.getStatus());

  return {
    message,
    ...(Object.keys(rest).length > 0 ? { details: rest } : {}),
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

    let parsedError: ParsedHttpError;

    if (exception instanceof HttpException) {
      parsedError = parseHttpException(exception);
    } else {
      // Never leak internals to clients; log full detail server-side.
      parsedError = { message: 'Internal server error' };
      this.logger.error(
        `Unhandled exception [${request.method} ${getRequestPath(request)}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorBody = {
      success: false,
      error: {
        code: status,
        message: parsedError.message,
        ...(parsedError.details !== undefined ? { details: parsedError.details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: getRequestPath(request),
      },
    };

    response.status(status).json(body);
  }
}
