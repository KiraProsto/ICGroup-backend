import { RedisThrottlerStorage } from './throttler-storage.js';

const mockEval = jest.fn();

const mockRedis = {
  eval: mockEval,
} as never;

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new RedisThrottlerStorage(mockRedis);
  });

  const TTL_MS = 60_000; // 60 s in ms — as supplied by ThrottlerModule
  const LIMIT = 5;
  const BLOCK_DURATION_MS = 0; // 0 means fall back to TTL
  const THROTTLER_NAME = 'login';
  const KEY = '127.0.0.1';

  const FULL_KEY = `throttler:${THROTTLER_NAME}:${KEY}`;
  const BLOCK_KEY = `${FULL_KEY}:blocked`;
  const TTL_S = 60; // Math.ceil(60000 / 1000)
  const BLOCK_S = 0; // Math.ceil(0 / 1000)

  function call(ttlMs = TTL_MS, limit = LIMIT, blockMs = BLOCK_DURATION_MS) {
    return storage.increment(KEY, ttlMs, limit, blockMs, THROTTLER_NAME);
  }

  // ── Happy path: first hit ────────────────────────────────────────────────

  it('returns totalHits=1 and isBlocked=false on first request', async () => {
    mockEval.mockResolvedValue([1, 59, 0, 0]);

    const result = await call();

    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 59,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  // ── Happy path: subsequent hits within limit ─────────────────────────────

  it('increments totalHits and stays unblocked while under the limit', async () => {
    mockEval.mockResolvedValue([3, 45, 0, 0]);

    const result = await call();

    expect(result.totalHits).toBe(3);
    expect(result.isBlocked).toBe(false);
  });

  // ── Limit exceeded: first over-limit hit triggers block ──────────────────

  it('returns isBlocked=true when the limit is exceeded', async () => {
    // Lua script returns blocked=1 once hits exceed the limit
    mockEval.mockResolvedValue([6, 55, 1, 60]);

    const result = await call();

    expect(result.isBlocked).toBe(true);
    expect(result.timeToBlockExpire).toBe(60);
  });

  // ── Already blocked: subsequent hits respect the block ───────────────────

  it('returns isBlocked=true when the tracker is already blocked', async () => {
    mockEval.mockResolvedValue([6, 60, 1, 42]);

    const result = await call();

    expect(result.isBlocked).toBe(true);
    expect(result.timeToBlockExpire).toBe(42);
  });

  // ── Key construction ─────────────────────────────────────────────────────

  it('passes the correct keys and arguments to redis.eval', async () => {
    mockEval.mockResolvedValue([1, 59, 0, 0]);

    await call();

    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      2, // number of KEYS
      FULL_KEY,
      BLOCK_KEY,
      TTL_S,
      LIMIT,
      BLOCK_S,
    );
  });

  it('converts ms TTL to whole seconds (ceiling)', async () => {
    mockEval.mockResolvedValue([1, 1, 0, 0]);

    // 1 ms → Math.ceil(1/1000) = 1 s
    await storage.increment(KEY, 1, LIMIT, 0, THROTTLER_NAME);

    const [, , , , ttlArg] = mockEval.mock.calls[0];
    expect(ttlArg).toBe(1);
  });

  it('converts ms blockDuration to whole seconds (ceiling)', async () => {
    mockEval.mockResolvedValue([6, 30, 1, 30]);

    // 29_001 ms → Math.ceil(29001/1000) = 30 s
    await storage.increment(KEY, TTL_MS, LIMIT, 29_001, THROTTLER_NAME);

    const [, , , , , , blockArg] = mockEval.mock.calls[0];
    expect(blockArg).toBe(30);
  });

  // ── Throttler name isolation ─────────────────────────────────────────────

  it('namespaces keys by throttlerName so global and login counters are isolated', async () => {
    mockEval.mockResolvedValue([1, 59, 0, 0]);

    await storage.increment(KEY, TTL_MS, 120, 0, 'global');

    const [, , globalKey] = mockEval.mock.calls[0];
    expect(globalKey).toBe(`throttler:global:${KEY}`);
  });

  // ── Redis eval error propagation ─────────────────────────────────────────

  it('propagates Redis errors so the guard can surface a 500', async () => {
    mockEval.mockRejectedValue(new Error('Redis connection lost'));

    await expect(call()).rejects.toThrow('Redis connection lost');
  });
});
