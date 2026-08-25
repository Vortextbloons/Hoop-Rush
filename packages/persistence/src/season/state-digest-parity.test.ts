import { describe, expect, it } from 'vitest';
import { handleSeasonRunCommand, seasonRunStateDigest } from '@hoop-rush/engine';
import { seasonRunEngineSeam } from './engine-seam.ts';
import type { SeasonRunStateDigestFacts } from './engine-seam-types.ts';
import {
  buildFixtureEffectsState,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStateDigest,
} from '../testing/season-run-fixture.ts';

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

function digestFactsFromRun(
  run: ReturnType<typeof buildFixtureRun>,
  effects = buildFixtureEffectsState(run.rosters),
): SeasonRunStateDigestFacts {
  return {
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
    campaign: run.campaign ?? null,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
    freeAgency: run.freeAgency,
  };
}

describe('seasonRunEngineSeam state digest parity', () => {
  it('delegates to the engine when campaign is absent', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-run', schedule });
    const factsWithoutCampaign: SeasonRunStateDigestFacts = {
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
    expect(seasonRunEngineSeam.seasonRunStateDigest(factsWithoutCampaign)).toBe(
      seasonRunStateDigest(factsWithoutCampaign),
    );
  });

  it('recomputes every fixture-run digest identically through both bindings', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-run', schedule });
    const facts = digestFactsFromRun(run);

    expect(buildFixtureStateDigest(run)).toBe(run.stateDigest);
    expect(buildFixtureStateDigest(run)).toBe(seasonRunEngineSeam.seasonRunStateDigest(facts));
  });

  it('matches the engine after select-gm-identity adds campaign offers', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-campaign-run', schedule });
    const output = handleSeasonRunCommand(
      {
        schemaVersion: 11,
        command: 'select-gm-identity',
        commandId: 'gm-digest-parity',
        runId: run.runId,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
        identity: 'team-identity',
        focus: 'defense',
      },
      {
        run,
        pending: null,
        humanFranchiseId: 'lakers',
        effects: buildFixtureEffectsState(run.rosters),
      },
    );
    if (output.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const facts = digestFactsFromRun(output.run);
    expect(seasonRunEngineSeam.seasonRunStateDigest(facts)).toBe(output.run.stateDigest);
    expect(seasonRunStateDigest(facts)).toBe(output.run.stateDigest);
  });
});
