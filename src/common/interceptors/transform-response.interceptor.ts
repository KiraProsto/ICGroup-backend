import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const PAGINATED_RESULT_MARKER = Symbol('paginated-result');

function getRequestPath(request: Request): string {
  return request.path;
}

/**
 * Returned by paginated service methods so the interceptor can spread
 * pagination metadata into the top-level `meta` field.
 */
export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  [PAGINATED_RESULT_MARKER]: true;
  data: T[];
  meta: PaginationMeta;
}

export function paginatedResult<T>(data: T[], meta: PaginationMeta): PaginatedResult<T> {
  return {
    [PAGINATED_RESULT_MARKER]: true,
    data,
    meta,
  };
}

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta: { timestamp: string; path: string } & Partial<PaginationMeta>;
};

type UnwrappedData<T> = T extends PaginatedResult<infer U> ? U[] : T;

// Union type used as the public Observable emission type.
// The interceptor emits either the raw value (passthrough) or a wrapped envelope
// whose `data` field preserves the original payload type (unwrapping paginated results).
type Wrapped<T> = T | ApiSuccessResponse<UnwrappedData<T>>;

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    PAGINATED_RESULT_MARKER in value &&
    (value as PaginatedResult<unknown>)[PAGINATED_RESULT_MARKER] === true
  );
}

/**
 * Wraps every non-204 JSON response in:
 *   { success: true, data: <payload>, meta: { timestamp, path, ...pagination? } }
 *
 * Paginated services return { data: T[], meta: PaginationMeta }; the interceptor
 * flattens the pagination fields into the top-level meta object.
 *
 * 204 No Content responses are passed through unchanged so the empty body is
 * preserved (e.g. POST /auth/logout).
 */
@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<T, Wrapped<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<Wrapped<T>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data): Wrapped<T> => {
        // 204 No Content — do not wrap; body must remain empty.
        if (res.statusCode === 204) return data;

        const baseMeta = {
          timestamp: new Date().toISOString(),
          path: getRequestPath(req),
        };

        if (isPaginatedResult(data)) {
          // TypeScript cannot narrow the conditional UnwrappedData<T> here —
          // the cast is safe because isPaginatedResult guarantees T extends PaginatedResult<U>.
          return {
            success: true as const,
            data: data.data,
            meta: { ...baseMeta, ...data.meta },
          } as unknown as Wrapped<T>;
        }

        return {
          success: true as const,
          data,
          meta: baseMeta,
        } as unknown as Wrapped<T>;
      }),
    );
  }
}
