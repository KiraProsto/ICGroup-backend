import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { paginatedResult, TransformResponseInterceptor } from './transform-response.interceptor.js';

describe('TransformResponseInterceptor', () => {
  function createExecutionContext(statusCode = 200): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          url: '/api/v1/items?token=secret',
          path: '/api/v1/items',
        }),
        getResponse: () => ({ statusCode }),
      }),
    } as never as ExecutionContext;
  }

  it('wraps plain data and uses a sanitized path', (done) => {
    const interceptor = new TransformResponseInterceptor();

    interceptor
      .intercept(createExecutionContext(), {
        handle: () => of({ id: 'item-1' }),
      })
      .subscribe((value) => {
        expect(value).toEqual({
          success: true,
          data: { id: 'item-1' },
          meta: {
            timestamp: expect.any(String),
            path: '/api/v1/items',
          },
        });
        done();
      });
  });

  it('only flattens pagination for explicitly marked results', (done) => {
    const interceptor = new TransformResponseInterceptor();

    interceptor
      .intercept(createExecutionContext(), {
        handle: () =>
          of(
            paginatedResult([{ id: 'item-1' }], {
              total: 1,
              page: 1,
              perPage: 20,
              totalPages: 1,
            }),
          ),
      })
      .subscribe((value) => {
        expect(value).toEqual({
          success: true,
          data: [{ id: 'item-1' }],
          meta: {
            timestamp: expect.any(String),
            path: '/api/v1/items',
            total: 1,
            page: 1,
            perPage: 20,
            totalPages: 1,
          },
        });
        done();
      });
  });

  it('does not reinterpret unmarked objects that happen to contain data and meta fields', (done) => {
    const interceptor = new TransformResponseInterceptor();

    interceptor
      .intercept(createExecutionContext(), {
        handle: () =>
          of({
            data: [{ id: 'item-1' }],
            meta: { source: 'domain-payload' },
          }),
      })
      .subscribe((value) => {
        expect(value).toEqual({
          success: true,
          data: {
            data: [{ id: 'item-1' }],
            meta: { source: 'domain-payload' },
          },
          meta: {
            timestamp: expect.any(String),
            path: '/api/v1/items',
          },
        });
        done();
      });
  });

  it('preserves 204 responses without wrapping them', (done) => {
    const interceptor = new TransformResponseInterceptor();

    interceptor
      .intercept(createExecutionContext(204), {
        handle: () => of(undefined),
      })
      .subscribe((value) => {
        expect(value).toBeUndefined();
        done();
      });
  });
});
