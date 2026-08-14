import { describe, expect, it } from 'vitest';
import { seasonRunStateDigest } from '@hoop-rush/engine';
import { seasonRunEngineSeam } from './engine-seam.ts';
import type { SeasonRunStateDigestFacts } from './engine-seam-types.ts';
import {
  buildFixtureEffectsState,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStateDigest,
} from '../testing/season-run-fixture.ts';

/**
 * M2.5/M2.6.5 state-digest parity: the persistence seam binds the engine's
 * authoritative `seasonRunStateDigest` (single implementation, no local
 * mirror), so the reload audit, the benchmark, and the fixture builders can
 * never fork from engine-recomputed digests. The seam facts contract
 * (engine-seam-types.ts) adds the M2.6.5 free-agency state; until the
 * engine binding lands, both the stored digests and the recomputation run
 * through the same engine function, so parity holds on both sides of the
 * integration.
 */

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

describe('seasonRunEngineSeam state digest parity', () => {
  it('binds the engine export by identity', () => {
    // The identity assertion is the point of this test: the seam binding
    // must be the engine function itself, never a local mirror.
    const seamDigest = seasonRunEngineSeam.seasonRunStateDigest;
    expect(seamDigest).toBe(seasonRunStateDigest);
  });

  it('recomputes every fixture-run digest identically through both bindings', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-run', schedule });
    const facts: SeasonRunStateDigestFacts = {
      stateRevision: run.stateRevision,
      stage: run.stage,
      postseason: run.postseason,
      awards: run.awards,
      completion: run.completion,
      checkpointState: run.checkpointState,
      health: run.health,
      influence: run.influence,
      transactions: run.transactions,
      trade: run.trade,
      objectives: run.objectives,
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: run.rotations,
      effects: buildFixtureEffectsState(run.rosters),
      freeAgency: run.freeAgency,
    };
    // The stored fixture digest (built through the same binding) reconciles.
    expect(buildFixtureStateDigest(run)).toBe(run.stateDigest);
    expect(buildFixtureStateDigest(run)).toBe(seasonRunStateDigest(facts));
  });
});
