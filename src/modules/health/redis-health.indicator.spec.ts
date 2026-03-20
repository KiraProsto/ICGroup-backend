import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';
import { REDIS_CLIENT } from '../../redis/redis.module.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUp = jest.fn().mockReturnValue({ redis: { status: 'up' } });
const mockDown = jest.fn().mockReturnValue({ redis: { status: 'down' } });
const mockCheck = jest.fn().mockReturnValue({ up: mockUp, down: mockDown });

const mockRedis = {
  ping: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCheck.mockReturnValue({ up: mockUp, down: mockDown });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        { provide: HealthIndicatorService, useValue: { check: mockCheck } },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  describe('pingCheck', () => {
    it('returns up when Redis responds with PONG', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await indicator.pingCheck('redis');

      expect(mockCheck).toHaveBeenCalledWith('redis');
      expect(mockRedis.ping).toHaveBeenCalledTimes(1);
      expect(mockUp).toHaveBeenCalledTimes(1);
      expect(mockDown).not.toHaveBeenCalled();
      expect(result).toEqual({ redis: { status: 'up' } });
    });

    it('returns down when Redis responds with unexpected value', async () => {
      mockRedis.ping.mockResolvedValue('LOADING');

      const result = await indicator.pingCheck('redis');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Unexpected PING response' });
      expect(mockUp).not.toHaveBeenCalled();
      expect(result).toEqual({ redis: { status: 'down' } });
    });

    it('returns down when ping throws (server unreachable)', async () => {
      mockRedis.ping.mockRejectedValue(new Error('connection refused'));

      const result = await indicator.pingCheck('redis');

      expect(mockDown).toHaveBeenCalledWith({ message: 'Redis unreachable' });
      expect(mockUp).not.toHaveBeenCalled();
      expect(result).toEqual({ redis: { status: 'down' } });
    });

    it('returns down when ping times out', async () => {
      jest.useFakeTimers();
      mockRedis.ping.mockReturnValue(new Promise(() => {})); // never resolves

      const resultPromise = indicator.pingCheck('redis');
      jest.advanceTimersByTime(5_000);
      const result = await resultPromise;

      expect(mockDown).toHaveBeenCalledWith({ message: 'Redis unreachable' });
      expect(result).toEqual({ redis: { status: 'down' } });
      jest.useRealTimers();
    });

    it('uses the provided key when building the indicator', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      await indicator.pingCheck('cache');

      expect(mockCheck).toHaveBeenCalledWith('cache');
    });
  });
});
