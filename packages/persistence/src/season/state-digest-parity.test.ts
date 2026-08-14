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

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

describe('seasonRunEngineSeam state digest parity', () => {
  it('binds the engine export by identity', () => {
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

    expect(buildFixtureStateDigest(run)).toBe(run.stateDigest);
    expect(buildFixtureStateDigest(run)).toBe(seasonRunStateDigest(facts));
  });
});
