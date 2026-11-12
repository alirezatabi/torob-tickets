/**
 * In-memory TTL cache for provider responses and search results.
 *
 * Purpose is compliance as much as speed: a user who refreshes five times in a minute
 * must not generate five scrapes. The cache is process-local on purpose — a shared
 * Redis cache would need invalidation we cannot justify yet.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.store.size >= this.maxEntries) {
      // Map preserves insertion order: drop the oldest entry.
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Test helper. */
  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

/** Cache key for a provider search; every input that changes the response is included. */
export function providerCacheKey(parts: {
  providerId: string;
  originAirport: string;
  destinationAirport: string;
  departDate: string;
  passengers: number;
  cabin: string;
}): string {
  return [
    parts.providerId,
    parts.originAirport,
    parts.destinationAirport,
    parts.departDate,
    `p${parts.passengers}`,
    parts.cabin,
  ].join("|");
}
