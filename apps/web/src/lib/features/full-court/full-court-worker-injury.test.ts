/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression -- bun-types declares .resolves/.rejects matchers as void; Bun docs require awaiting them */
import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  fullCourtHealthProfileSetSchema,
  type FullCourtHealthProfileSet,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  type FullCourtRegularSeason,
} from '@hoop-rush/engine';
import { fullCourtTestSeasonLock } from './full-court-test-support';
import type { FullCourtWorkerMessage } from './full-court-worker-protocol';
import { createFullCourtWorkerRunner } from './full-court-worker-runner';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {}

  emit(message: FullCourtWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

const CATALOG_HASH = 'a'.repeat(64);

function profilesOf(season: FullCourtRegularSeason): FullCourtHealthProfileSet {
  const players: Record<string, unknown> = {};
  for (const team of season.teams) {
    for (const player of team.roster) {
      if (player.playerVersionId === undefined) throw new Error('Missing test player version');
      players[player.playerVersionId] = {
        cohortId: 'test-cohort',
        episodesPer10kAppearances: 100,
        playerEvidence: { source: 'population' },
      };
    }
  }
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash: CATALOG_HASH,
    evidenceHash: 'b'.repeat(64),
    cohorts: { 'test-cohort': { observedAppearances: 1_000, durationCounts: [1, 0, 0, 0] } },
    players,
  });
}

describe('FullCourtWorkerRunner injury profiles', () => {
  it('validates and carries the locked profile set with the season', async () => {
    const base = fullCourtTestSeasonLock();
    const lock = lockFullCourtRegularSeason(base.season, {
      profiles: profilesOf(base.season),
      catalogAssetHash: CATALOG_HASH,
    });
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: () => 'full-court-injury-1',
    });
    const pending = runner.simulateSlot(lock, createFullCourtSeasonCheckpoint(lock));
    expect(fake.posted[0]).toMatchObject({
      type: 'full-court-simulate-slot',
      lock: { digest: lock.digest, injuryProfiles: { catalogHash: CATALOG_HASH } },
    });
    fake.emit({
      schemaVersion: 1,
      type: 'full-court-slot-result',
      requestId: 'full-court-injury-1',
      outcome: { kind: 'season-complete' },
    });
    await expect(pending).resolves.toMatchObject({ kind: 'season-complete' });
    runner.dispose();
  });
});
