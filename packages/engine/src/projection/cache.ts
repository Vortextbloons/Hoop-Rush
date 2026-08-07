import { seasonDigestHex } from '@hoop-rush/data-contracts';
import type { BaseFiveProjection } from '@hoop-rush/data-contracts';

/**
 * Canonical projection cache (projection milestone). Every unique legal five
 * is cached by canonical player set, slot assignment, era, model version,
 * and reference id, so the Season projector and candidate search never
 * recompute a base projection. Bounded by entry and byte budgets.
 */

export interface ProjectionCacheStats {
  hits: number;
  misses: number;
  entries: number;
  bytes: number;
}

export class ProjectionCache {
  private readonly entries = new Map<string, { value: BaseFiveProjection; bytes: number }>();
  private hits = 0;
  private misses = 0;
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(maxEntries = 10_000, maxBytes = 32 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  /** Canonical cache key for one base projection. */
  static key(input: {
    eraId: string;
    modelVersion: string;
    referenceId: string;
    slots: readonly string[];
    playerIds: readonly string[];
    playerVersionIds: readonly (string | null)[];
  }): string {
    return seasonDigestHex(
      JSON.stringify([
        input.eraId,
        input.modelVersion,
        input.referenceId,
        input.slots,
        input.playerIds,
        input.playerVersionIds,
      ]),
    );
  }

  get(key: string): BaseFiveProjection | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // LRU refresh.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: BaseFiveProjection): void {
    const bytes = JSON.stringify(value).length;
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.bytes -= existing.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    this.evict();
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      const entry = this.entries.get(oldest);
      if (entry !== undefined) this.bytes -= entry.bytes;
      this.entries.delete(oldest);
    }
  }

  stats(): ProjectionCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      bytes: this.bytes,
    };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.bytes = 0;
  }
}
