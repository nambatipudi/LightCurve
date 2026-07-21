/**
 * Tiny in-memory TTL cache for renderer-side admin reads.
 *
 * Navigating back and forth between tenants/namespaces/topics previously
 * re-issued the same admin API calls every time. This memoizes results for a
 * short window so repeat selections feel instant, while still going stale
 * quickly enough that metrics stay reasonably fresh. Explicit refreshes should
 * call `invalidate()` first to bypass the cache.
 */

interface CacheEntry<T = unknown> {
  value: T;
  expires: number;
}

const store = new Map<string, CacheEntry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Drop cache entries. With no argument clears everything; otherwise clears keys starting with `prefix`. */
export function invalidate(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
