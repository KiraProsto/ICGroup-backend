import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

// Explicit factory functions are required for these three mocks:
//  - '../generated/prisma/client.js' uses `import.meta.url` (ESM) which
//    cannot be parsed by ts-jest in CJS mode — the factory prevents Jest
//    from ever reading the real file.
//  - Providing factories for all three keeps mock setup symmetric and avoids
//    ts-jest trying to auto-analyse ESM output from @prisma/adapter-pg.
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
    it('should call $disconnect before pool.end', async () => {
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
  });

  // ── Model accessors ────────────────────────────────────────────────────────

  describe('model accessors', () => {
    it.each(['user', 'page', 'pageSection', 'newsArticle', 'company', 'purchase', 'auditLog'])(
      'should expose the %s delegate',
      (accessor) => {
        expect(service[accessor as keyof PrismaService]).toBeDefined();
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
