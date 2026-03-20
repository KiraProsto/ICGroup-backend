import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the promise completes before the deadline', async () => {
    const result = await withTimeout(Promise.resolve(42), 5_000, 'test');
    expect(result).toBe(42);
  });

  it('rejects with a timeout error when the promise does not resolve in time', async () => {
    const never = new Promise<string>(() => {}); // never resolves
    const resultPromise = withTimeout(never, 5_000, 'operation timed out');
    jest.advanceTimersByTime(5_000);
    await expect(resultPromise).rejects.toThrow('operation timed out');
  });

  it('propagates the original rejection when the promise fails before the deadline', async () => {
    const failing = Promise.reject(new Error('upstream failure'));
    await expect(withTimeout(failing, 5_000, 'should not appear')).rejects.toThrow(
      'upstream failure',
    );
  });

  it('clears the timer after the promise resolves so it does not leak', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 5_000, 'test');
    expect(clearSpy).toHaveBeenCalledTimes(1);
    clearSpy.mockRestore();
  });
});
