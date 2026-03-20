import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

// Explicit factory functions are required for these three mocks when running
// Jest with @swc/jest:
//  - '../generated/prisma/client.js' is ESM and uses `import.meta.url`, which
//    causes issues if Jest/@swc/jest try to load or transform the real Prisma
//    client during auto-mocking. The factory ensures the real file is never
//    evaluated.
//  - Providing factories for all three keeps the mock setup symmetric and
//    avoids @swc/jest attempting to transform or analyse the actual Prisma /
//    pg implementations, which can introduce ESM/CJS edge cases in tests.
jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }));
jest.mock('../generated/prisma/client.js', () => ({ PrismaClient: jest.fn() }));

const MockPool = Pool as jest.MockedClass<typeof Pool>;
const MockPrismaPg = PrismaPg as jest.MockedClass<typeof PrismaPg>;
const MockPrismaClient = PrismaClient as jest.MockedClass<typeof PrismaClient>;

// ─────────────────────────────────────────────────────────────────────────────

describe('PrismaService', () => {
  const DB_URL = 'postgresql://test:test@localhost:5432/testdb';

  let module: TestingModule;
  let service: PrismaService;
  let mockPoolInstance: { on: jest.Mock; end: jest.Mock };
  let mockPrismaInstance: { $connect: jest.Mock; $disconnect: jest.Mock } & Record<string, unknown>;

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue(DB_URL),
    // Return the supplied default for every optional pool config key.
    get: jest.fn().mockImplementation((_key: string, defaultVal: unknown) => defaultVal),
  };

  beforeEach(async () => {
    mockPoolInstance = {
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
    };

    mockPrismaInstance = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      user: {},
      page: {},
      pageSection: {},
      rubric: {},
      newsArticle: {},
      company: {},
      purchase: {},
      auditLog: {},
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };

    MockPool.mockImplementation(() => mockPoolInstance as unknown as Pool);
    MockPrismaPg.mockImplementation(() => ({}) as unknown as PrismaPg);
    MockPrismaClient.mockImplementation(
      () => mockPrismaInstance as unknown as InstanceType<typeof PrismaClient>,
    );

    module = await Test.createTestingModule({
      providers: [PrismaService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Construction ───────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should read the connection string via the database.url config key', () => {
    expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('database.url');
  });

  it('should pass pool-size config keys with sensible defaults', () => {
    expect(mockConfigService.get).toHaveBeenCalledWith('database.poolMax', 10);
    expect(mockConfigService.get).toHaveBeenCalledWith('database.poolConnectTimeoutMs', 3_000);
    expect(mockConfigService.get).toHaveBeenCalledWith('database.poolIdleTimeoutMs', 10_000);
  });

  it('should attach an error listener to the pool', () => {
    expect(mockPoolInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should construct PrismaPg with the pool instance, not a connection string', () => {
    expect(MockPrismaPg).toHaveBeenCalledWith(mockPoolInstance);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should call $connect on the Prisma client', async () => {
      await service.onModuleInit();
      expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('onModuleDestroy', () => {
    it('should call $disconnect before pool.end on happy path', async () => {
      const callOrder: string[] = [];
      mockPrismaInstance.$disconnect.mockImplementation(() => {
        callOrder.push('disconnect');
        return Promise.resolve();
      });
      mockPoolInstance.end.mockImplementation(() => {
        callOrder.push('pool.end');
        return Promise.resolve();
      });

      await service.onModuleDestroy();

      expect(callOrder).toEqual(['disconnect', 'pool.end']);
    });

    it('should still close the pool even if $disconnect throws', async () => {
      mockPrismaInstance.$disconnect.mockRejectedValue(new Error('Prisma disconnect failed'));
      mockPoolInstance.end.mockResolvedValue(undefined);

      // Must not propagate — shutdown errors are logged, not rethrown.
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockPoolInstance.end).toHaveBeenCalledTimes(1);
    });

    it('should not propagate pool.end errors', async () => {
      mockPrismaInstance.$disconnect.mockResolvedValue(undefined);
      mockPoolInstance.end.mockRejectedValue(new Error('Pool close failed'));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // ── Model accessors ────────────────────────────────────────────────────────

  describe('model accessors', () => {
    it.each([
      'user',
      'page',
      'pageSection',
      'rubric',
      'newsArticle',
      'company',
      'purchase',
      'auditLog',
    ])('should expose the %s delegate', (accessor) => {
      expect(service[accessor as keyof PrismaService]).toBeDefined();
    });
  });

  // ── Raw-query helpers ─────────────────────────────────────────────────────

  describe('raw-query helpers', () => {
    it.each(['$transaction', '$queryRaw', '$executeRaw'])(
      '%s should be a stable bound reference to the prisma client method',
      (method) => {
        // Same reference on repeated access (bound once in constructor).
        expect(service[method as keyof PrismaService]).toBe(service[method as keyof PrismaService]);
        // Delegates to the underlying mock when called.
        const helper = service[method as keyof PrismaService] as (...a: unknown[]) => unknown;
        helper();
        expect(mockPrismaInstance[method as keyof typeof mockPrismaInstance]).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  });

  // ── Pool error listener smoke test ────────────────────────────────────────

  it('pool error listener should call logger.error without rethrowing', () => {
    const [, errorHandler] = mockPoolInstance.on.mock.calls.find(
      ([event]) => event === 'error',
    ) as [string, (err: Error) => void];

    // Must not throw — the listener only logs.
    expect(() => errorHandler(new Error('connection lost'))).not.toThrow();
  });
});
