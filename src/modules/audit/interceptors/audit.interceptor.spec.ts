import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from '../audit.service.js';
import { AuditAction, AuditResourceType } from '../../../generated/prisma/enums.js';
import type { AuditMeta } from '../decorators/audit.decorator.js';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

// Prevent Jest from loading the real Prisma generated client.
jest.mock('../../../generated/prisma/client.js', () => ({
  PrismaClient: jest.fn(),
  Prisma: { JsonNull: null },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('pg', () => ({ Pool: jest.fn() }));

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockAuditService = {
  logSync: jest.fn(),
  logAsync: jest.fn(),
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

// ── Context helpers ─────────────────────────────────────────────────────────

interface ContextOptions {
  method?: string;
  params?: Record<string, string>;
  user?: object | null;
  contextType?: string;
}

function makeContext(options: ContextOptions = {}): ExecutionContext {
  const {
    method = 'POST',
    params = {},
    user = { id: 'actor-1', email: 'a@b.com', role: 'SUPER_ADMIN' },
    contextType = 'http',
  } = options;

  const request = {
    method,
    params,
    user: user ?? undefined,
    ip: '10.0.0.1',
    get: jest.fn().mockReturnValue('Jest/1.0'),
  };

  return {
    getType: () => contextType,
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeHandler(body: unknown = { id: 'res-1' }): CallHandler {
  return { handle: () => of(body) };
}

const operationalMeta: AuditMeta = {
  action: AuditAction.CREATE,
  resourceType: AuditResourceType.NewsArticle,
};

const securityMeta: AuditMeta = {
  action: AuditAction.UPDATE,
  resourceType: AuditResourceType.User,
  security: true,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        { provide: AuditService, useValue: mockAuditService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    jest.clearAllMocks();
  });

  // ── Passthrough cases ──────────────────────────────────────────────────────

  it('passes through non-HTTP contexts without logging', (done) => {
    const ctx = makeContext({ contextType: 'ws' });

    interceptor.intercept(ctx, makeHandler()).subscribe((v) => {
      expect(v).toEqual({ id: 'res-1' });
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
      done();
    });
  });

  it('passes through GET requests without logging', (done) => {
    const ctx = makeContext({ method: 'GET' });
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);

    interceptor.intercept(ctx, makeHandler()).subscribe(() => {
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
      done();
    });
  });

  it('passes through routes without @Audit metadata', (done) => {
    const ctx = makeContext();
    mockReflector.getAllAndOverride.mockReturnValue(undefined);

    interceptor.intercept(ctx, makeHandler()).subscribe(() => {
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
      done();
    });
  });

  it('passes through unauthenticated requests (public routes handled by AuthService)', (done) => {
    const ctx = makeContext({ user: null });
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);

    interceptor.intercept(ctx, makeHandler()).subscribe(() => {
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
      done();
    });
  });

  // ── Operational (async) events ─────────────────────────────────────────────

  it('calls logAsync for operational events and passes the response through', (done) => {
    const responseBody = { id: 'art-1', title: 'Test' };
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockResolvedValue(undefined);

    interceptor
      .intercept(makeContext({ method: 'POST' }), makeHandler(responseBody))
      .subscribe((v) => {
        expect(v).toEqual(responseBody);
        expect(mockAuditService.logAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: 'actor-1',
            action: AuditAction.CREATE,
            resourceType: AuditResourceType.NewsArticle,
            beforeSnapshot: null,
            afterSnapshot: responseBody,
            actorIp: '10.0.0.1',
            actorUserAgent: 'Jest/1.0',
          }),
        );
        expect(mockAuditService.logSync).not.toHaveBeenCalled();
        done();
      });
  });

  it('does not await logAsync — returns the response before the job is enqueued', (done) => {
    // logAsync resolves on its own, but the handler should not wait for it
    let resolveAsync!: () => void;
    const asyncPromise = new Promise<void>((r) => (resolveAsync = r));
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockReturnValue(asyncPromise);

    interceptor.intercept(makeContext(), makeHandler({ id: 'x-1' })).subscribe((v) => {
      expect(v).toEqual({ id: 'x-1' });
      resolveAsync(); // resolve after subscription completes
      done();
    });
  });

  // ── Security (sync) events ─────────────────────────────────────────────────

  it('calls logSync for security events and awaits before emitting', (done) => {
    const responseBody = { id: 'user-abc', role: 'SALES_MANAGER' };
    mockReflector.getAllAndOverride.mockReturnValue(securityMeta);
    mockAuditService.logSync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'PATCH', params: { id: 'user-abc' } });

    interceptor.intercept(ctx, makeHandler(responseBody)).subscribe((v) => {
      expect(v).toEqual(responseBody);
      expect(mockAuditService.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: AuditAction.UPDATE,
          resourceType: AuditResourceType.User,
          resourceId: 'user-abc',
          beforeSnapshot: null,
        }),
      );
      expect(mockAuditService.logAsync).not.toHaveBeenCalled();
      done();
    });
  });

  // ── ResourceId extraction ──────────────────────────────────────────────────

  it('uses route param :id for PATCH (resource already exists)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(securityMeta);
    mockAuditService.logSync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'PATCH', params: { id: 'param-id-1' } });

    interceptor.intercept(ctx, makeHandler({ id: 'resp-id-2' })).subscribe(() => {
      expect(mockAuditService.logSync).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'param-id-1' }),
      );
      done();
    });
  });

  it('uses route param :id for DELETE', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue({
      ...operationalMeta,
      action: AuditAction.DELETE,
    });
    mockAuditService.logAsync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'DELETE', params: { id: 'del-1' } });

    interceptor.intercept(ctx, makeHandler(undefined)).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'del-1' }),
      );
      done();
    });
  });

  it('extracts resourceId from POST response body (new resource)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'POST', params: {} });

    interceptor.intercept(ctx, makeHandler({ id: 'new-art-99', title: 'Hi' })).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'new-art-99' }),
      );
      done();
    });
  });

  it('falls back to "unknown" when no id is available (e.g. bulk POST)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'POST', params: {} });

    interceptor.intercept(ctx, makeHandler(null)).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: 'unknown' }),
      );
      done();
    });
  });

  // ── Snapshot handling ──────────────────────────────────────────────────────

  it('sets afterSnapshot to null for DELETE with no response body (204)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue({
      ...operationalMeta,
      action: AuditAction.DELETE,
    });
    mockAuditService.logAsync.mockResolvedValue(undefined);

    const ctx = makeContext({ method: 'DELETE', params: { id: 'del-2' } });

    // null represents a 204 No Content response (no body)
    interceptor.intercept(ctx, makeHandler(null)).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ afterSnapshot: null }),
      );
      done();
    });
  });

  it('sets afterSnapshot to null when response body is a primitive (e.g. boolean)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockResolvedValue(undefined);

    interceptor.intercept(makeContext(), makeHandler(true)).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ afterSnapshot: null }),
      );
      done();
    });
  });

  it('stores object responses as afterSnapshot', (done) => {
    const body = { id: 'p-1', slug: 'home', status: 'PUBLISHED' };
    mockReflector.getAllAndOverride.mockReturnValue(operationalMeta);
    mockAuditService.logAsync.mockResolvedValue(undefined);

    interceptor.intercept(makeContext(), makeHandler(body)).subscribe(() => {
      expect(mockAuditService.logAsync).toHaveBeenCalledWith(
        expect.objectContaining({ afterSnapshot: body }),
      );
      done();
    });
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  it('does not propagate logSync errors — emits the response body despite failure', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(securityMeta);
    mockAuditService.logSync.mockRejectedValue(new Error('DB write failed'));

    const ctx = makeContext({ method: 'PATCH', params: { id: 'u-1' } });

    interceptor.intercept(ctx, makeHandler({ id: 'u-1' })).subscribe(
      (v) => {
        expect(v).toEqual({ id: 'u-1' });
        done();
      },
      () => done.fail('should not propagate the error'),
    );
  });

  it('still emits response body when logSync rejects (operation already committed)', (done) => {
    mockReflector.getAllAndOverride.mockReturnValue(securityMeta);
    mockAuditService.logSync.mockRejectedValue(new Error('Timeout'));

    const ctx = makeContext({ method: 'PATCH', params: { id: 'u-2' } });

    let emitted = false;
    interceptor.intercept(ctx, makeHandler({ id: 'u-2' })).subscribe({
      next: () => {
        emitted = true;
      },
      error: () => done.fail('must not error'),
      complete: () => {
        expect(emitted).toBe(true);
        done();
      },
    });
  });
});
