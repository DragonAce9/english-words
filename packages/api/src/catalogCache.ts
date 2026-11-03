const TTL_MS = 10_000;
const MAX_ENTRIES = 200;

interface Entry<T> {
  at: number;
  value: T;
}

const entries = new Map<string, Entry<unknown>>();
const generations = new Map<string, number>();

function enabled(): boolean {
  return process.env.VITEST !== "true";
}

export function catalogGeneration(userId: string): number {
  return generations.get(userId) ?? 0;
}

export function readThemeCatalog<T>(key: string): T | undefined {
  if (!enabled()) return undefined;
  const entry = entries.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL_MS) {
    entries.delete(key);
    return undefined;
  }
  return entry.value;
}

/** Stores the payload only when nothing has invalidated this user since `generation` was read. */
export function storeThemeCatalog<T>(key: string, value: T, userId: string, generation: number): void {
  if (!enabled()) return;
  if ((generations.get(userId) ?? 0) !== generation) return;
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest) entries.delete(oldest);
  }
  entries.set(key, { at: Date.now(), value });
}

export function invalidateThemeCatalog(userId: string): void {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  const prefix = `${userId}:`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
