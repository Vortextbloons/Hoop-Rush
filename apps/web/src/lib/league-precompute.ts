import type { EraSimulationProfile, LeagueRecord, Seed } from '@hoop-rush/data-contracts';
import {
  leagueWorkerMessageSchema,
  leagueWorkerRequestSchema,
  type OpponentBracketCore,
} from '@hoop-rush/data-contracts';
import { newRequestId } from '$lib/ids';
import { loadRunPreamble } from '$lib/run-preamble';

export interface LeaguePrecomputeDeps {
  createWorker: () => Worker;
  loadPreamble: () => Promise<{
    profile: EraSimulationProfile;
    bracket: OpponentBracketCore;
  }>;
}

const MAX_CACHED_RECORDS = 4;

const defaultDeps: LeaguePrecomputeDeps = {
  createWorker: () =>
    new Worker(new URL('../workers/league-worker.ts', import.meta.url), { type: 'module' }),
  loadPreamble: () => loadRunPreamble(),
};

interface PendingCompute {
  seed: string;
  requestId: string;
  promise: Promise<LeagueRecord | null>;
  settle: (record: LeagueRecord | null) => void;
}

export class LeaguePrecompute {
  private worker: Worker | null = null;
  private pending: PendingCompute | null = null;
  private readonly cache = new Map<string, LeagueRecord>();

  constructor(private readonly deps: LeaguePrecomputeDeps = defaultDeps) {}

  prime(seed: Seed): void {
    void this.ensure(seed);
  }

  ensure(seed: Seed): Promise<LeagueRecord | null> {
    const cached = this.cache.get(seed);
    if (cached) return Promise.resolve(cached);
    if (this.pending?.seed === seed) return this.pending.promise;
    return this.start(seed);
  }

  private start(seed: Seed): Promise<LeagueRecord | null> {
    this.cancelPending();
    const requestId = newRequestId('league');
    let settle: (record: LeagueRecord | null) => void = () => {};
    const promise = new Promise<LeagueRecord | null>((resolve) => {
      settle = resolve;
    });
    this.pending = { seed, requestId, promise, settle };
    void this.runCompute(seed, requestId);
    return promise;
  }

  private async runCompute(seed: Seed, requestId: string): Promise<void> {
    let worker: Worker;
    try {
      const { profile, bracket } = await this.deps.loadPreamble();
      if (this.pending?.requestId !== requestId) return;
      worker = this.deps.createWorker();
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        this.handleMessage(event.data, requestId);
      };
      worker.onerror = () => {
        this.fail(requestId);
      };
      worker.postMessage(
        leagueWorkerRequestSchema.parse({
          schemaVersion: 1,
          type: 'compute',
          requestId,
          seed,
          bracket,
          profile,
        }),
      );
    } catch {
      this.fail(requestId);
    }
  }

  private handleMessage(raw: unknown, requestId: string): void {
    const parsed = leagueWorkerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.fail(requestId);
      return;
    }
    const message = parsed.data;
    if (message.requestId !== requestId || this.pending?.requestId !== requestId) return;
    if (message.type === 'progress') return;
    if (message.type === 'error') {
      this.fail(requestId);
      return;
    }
    const pending = this.pending;
    this.teardownWorker();
    this.pending = null;
    this.cache.set(pending.seed, message.record);
    if (this.cache.size > MAX_CACHED_RECORDS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    pending.settle(message.record);
  }

  private fail(requestId: string): void {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId) return;
    this.teardownWorker();
    this.pending = null;
    pending.settle(null);
  }

  private cancelPending(): void {
    const pending = this.pending;
    this.teardownWorker();
    this.pending = null;
    if (pending) pending.settle(null);
  }

  private teardownWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const leaguePrecompute = new LeaguePrecompute();
