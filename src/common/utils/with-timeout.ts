/**
 * Wraps a promise with a timeout to avoid hanging indefinitely.
 *
 * The timer is `.unref()`'d so it does not keep the Node.js event loop
 * alive on its own (useful during graceful shutdown). The `unref` call is
 * guarded because fake timers (used in tests) don't always implement it.
 *
 * @param promise - The async operation to race against the timeout.
 * @param ms      - Deadline in milliseconds.
 * @param label   - Human-readable description included in the timeout error.
 * @returns The resolved value of `promise`, or rejects with an Error if the deadline is exceeded.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label)), ms);
    timeoutId.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  }) as Promise<T>;
}
