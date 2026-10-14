import "server-only";

// In-memory failed-attempt limiter. Good enough for a single app instance; if the app is
// ever scaled to several instances, back this with a shared store (e.g. the database).
type Entry = { failures: number; resetAt: number };
const store = new Map<string, Entry>();

export function isBlocked(key: string, max: number) {
  const entry = store.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    store.delete(key);
    return false;
  }
  return entry.failures >= max;
}

export function recordFailure(key: string, windowMs: number) {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { failures: 1, resetAt: now + windowMs });
  } else {
    entry.failures += 1;
  }
}

export function clearFailures(key: string) {
  store.delete(key);
}
