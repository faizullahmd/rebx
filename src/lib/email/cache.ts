// Tiny in-process cache so every transactional email doesn't hit the database. Entries expire
// quickly (so another app instance's publish is picked up within seconds) and publishing,
// restoring or (de)activating a template invalidates the local entry immediately.
const TTL_MS = 30_000;
const store = new Map<string, { value: unknown; expires: number }>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: unknown) {
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

export function invalidateTemplateCache(key?: string) {
  if (key) store.delete(key);
  else store.clear();
}
