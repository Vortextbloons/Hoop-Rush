import { describe, expect, it } from 'vitest';
import {
  generateSeasonCampaignOffers,
  handleSeasonRunCommand,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import { commandIdSchema, buildEmptyCampaignState, buildEmptyChallengeState } from '@hoop-rush/data-contracts';
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
    challenges: run.challenges ?? buildEmptyChallengeState(),
    campaign: run.campaign ?? null,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
    freeAgency: run.freeAgency,
    authority: run.authority,
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
      challenges: run.challenges ?? buildEmptyChallengeState(),
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: run.rotations,
      effects: buildFixtureEffectsState(run.rosters),
      freeAgency: run.freeAgency,
      authority: run.authority,
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
  it('rejects retired select-gm-identity without mutating the digest', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-campaign-run', schedule });
    const output = handleSeasonRunCommand(
      {
        schemaVersion: 11,
        command: 'select-gm-identity',
        commandId: commandIdSchema.parse('gm-digest-parity'),
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
    if (output.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(output.result.result.rejection.code).toBe('retired');
    const facts = digestFactsFromRun(output.run);
    expect(seasonRunEngineSeam.seasonRunStateDigest(facts)).toBe(output.run.stateDigest);
    expect(seasonRunStateDigest(facts)).toBe(output.run.stateDigest);
  });
  it('matches the engine after select-campaign-opportunity with no identity', () => {
    const schedule = buildFixtureSchedule(SEED);
    const base = buildFixtureRun({ seed: SEED, runId: 'digest-parity-opportunity-run', schedule });
    const offers = generateSeasonCampaignOffers({
      rootSeed: base.rootSeed,
      blockIndex: 0,
      humanFranchiseId: 'lakers',
      schedule,
      standings: base.standings,
      health: base.health,
      rotations: base.rotations,
      rosters: base.rosters,
      transactions: base.transactions,
      summaries: [],
      campaignState: base.campaign ?? buildEmptyCampaignState(),
    });
    const first = offers[0];
    if (first === undefined) throw new Error('expected block-0 offers');
    const campaign = base.campaign ?? buildEmptyCampaignState();
    const run = {
      ...base,
      campaign: { ...campaign, offers: { 0: offers } },
    };
    const output = handleSeasonRunCommand(
      {
        schemaVersion: 11,
        command: 'select-campaign-opportunity',
        commandId: commandIdSchema.parse('camp-digest-parity'),
        runId: run.runId,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
        blockIndex: 0,
        opportunityId: first.opportunityId,
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
  it('includes challenges in fixture digests identically through both bindings', () => {
    const schedule = buildFixtureSchedule(SEED);
    const run = buildFixtureRun({ seed: SEED, runId: 'digest-parity-challenges-run', schedule });
    const facts = digestFactsFromRun(run);
    expect(facts.challenges).toBeDefined();
    expect(buildFixtureStateDigest(run)).toBe(run.stateDigest);
    expect(seasonRunEngineSeam.seasonRunStateDigest(facts)).toBe(run.stateDigest);
    expect(seasonRunStateDigest(facts)).toBe(run.stateDigest);
    const withoutChallenges = { ...facts, challenges: undefined };
    expect(seasonRunStateDigest(withoutChallenges)).not.toBe(run.stateDigest);
  });
});
