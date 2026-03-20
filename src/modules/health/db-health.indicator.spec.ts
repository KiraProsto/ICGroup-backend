import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DbHealthIndicator } from './db-health.indicator.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUp = jest.fn().mockReturnValue({ database: { status: 'up' } });
const mockDown = jest.fn().mockReturnValue({ database: { status: 'down' } });
const mockCheck = jest.fn().mockReturnValue({ up: mockUp, down: mockDown });

const mockPrisma = {
  $executeRaw: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('DbHealthIndicator', () => {
  let indicator: DbHealthIndicator;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCheck.mockReturnValue({ up: mockUp, down: mockDown });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbHealthIndicator,
        { provide: HealthIndicatorService, useValue: { check: mockCheck } },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    indicator = module.get<DbHealthIndicator>(DbHealthIndicator);
  });

  describe('pingCheck', () => {
    it('returns up when the database responds', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      const result = await indicator.pingCheck('database');

      expect(mockCheck).toHaveBeenCalledWith('database');
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockUp).toHaveBeenCalledTimes(1);
      expect(mockDown).not.toHaveBeenCalled();
      expect(result).toEqual({ database: { status: 'up' } });
    });

    it('returns down when the query throws (server unreachable)', async () => {
      mockPrisma.$executeRaw.mockRejectedValue(new Error('connection refused'));

      const result = await indicator.pingCheck('database');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Database unreachable' });
      expect(mockUp).not.toHaveBeenCalled();
      expect(result).toEqual({ database: { status: 'down' } });
    });

    it('returns down when the query times out', async () => {
      jest.useFakeTimers();
      mockPrisma.$executeRaw.mockReturnValue(new Promise(() => {})); // never resolves

      const resultPromise = indicator.pingCheck('database');
      jest.advanceTimersByTime(5_000);
      const result = await resultPromise;

      expect(mockDown).toHaveBeenCalledWith({ message: 'Database unreachable' });
      expect(result).toEqual({ database: { status: 'down' } });
      jest.useRealTimers();
    });

    it('uses the provided key when building the indicator', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      await indicator.pingCheck('pg');

      expect(mockCheck).toHaveBeenCalledWith('pg');
    });
  });
});
