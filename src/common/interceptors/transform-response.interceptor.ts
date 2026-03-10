import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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
  data: T[];
  meta: PaginationMeta;
}

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta: { timestamp: string; path: string } & Partial<PaginationMeta>;
};

// Intersection type used as the public Observable emission type.
// The interceptor emits either the raw value (passthrough) or a wrapped envelope.
type Wrapped<T> = T | ApiSuccessResponse<unknown>;

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Array.isArray((value as PaginatedResult<unknown>).data) &&
    'meta' in value &&
    typeof (value as PaginatedResult<unknown>).meta === 'object' &&
    (value as PaginatedResult<unknown>).meta !== null
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
      map((data) => {
        // 204 No Content — do not wrap; body must remain empty.
        if (res.statusCode === 204) return data;

        const baseMeta = {
          timestamp: new Date().toISOString(),
          path: req.url,
        };

        if (isPaginatedResult(data)) {
          return {
            success: true as const,
            data: data.data,
            meta: { ...baseMeta, ...data.meta },
          };
        }

        return {
          success: true as const,
          data,
          meta: baseMeta,
        };
      }),
    );
  }
}
