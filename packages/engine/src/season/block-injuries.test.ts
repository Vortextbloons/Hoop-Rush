import { beforeAll, describe, expect, it } from 'vitest';
import {
  SEASON_CHALLENGE_CATALOG,
  franchiseIdSchema,
  seasonGameIdSchema,
  type SeasonChallengeDeal,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
} from '@hoop-rush/data-contracts';
import { buildTestRun, pipelineInput, scheduleOf, blockCommand } from './block-test-support.ts';
import {
  assembleSeasonBlockCandidate,
  auditSeasonBlock,
  deriveSeasonPostBlockState,
  handleSubmitSeasonBlockCommand,
  seasonBlockGamesOf,
  seasonBlockRejection,
  simulateSeasonBlock,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from './block.ts';
import { assembleSeasonPendingBlock } from './health.ts';
import { dealSeasonBlockChallenges } from './challenges.ts';
import { applySeasonBlockInfluenceGrants } from './influence.ts';
function challengeDealOf(
  run: ReturnType<typeof buildTestRun>['run'],
  blockIndex: number,
): SeasonChallengeDeal {
  const schedule = scheduleOf(run);
  const deal = dealSeasonBlockChallenges(run.rootSeed, blockIndex, {
    league: run.league,
    schedule,
    standings: run.standings,
    humanFranchiseId: 'lakers',
  });
  if (deal === null) throw new Error(`no challenge deal for block ${String(blockIndex)}`);
  return deal;
}
function blockedHealthOf(run: SeasonBlockSimulationInput['run']): SeasonHealthState {
  const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
  if (roster === undefined) throw new Error('lakers roster');
  const injuries: SeasonInjuryRecord[] = roster.players.map((player, index) => ({
    injuryId: `inj-${String(index).padStart(32, '0')}`,
    playerVersionId: player.playerVersionId,
    franchiseId: franchiseIdSchema.parse('lakers'),
    gameId: seasonGameIdSchema.parse('s000001'),
    type: 'lower-body',
    severity: 'major',
    occurredBeforeHalftime: false,
    sameGameReturn: false,
    sameGameReturned: null,
    missedGamesTotal: 10,
    missedGamesRemaining: 10,
    actualReturnRound: null,
    seasonEnding: false,
    rehabModifier: 0,
    recurrenceWindowRoundsRemaining: 0,
    seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
  }));
  return { schemaVersion: 1, healthVersion: 'season-health-v2', injuries };
}
describe('M2.5 block pipeline with injuries', () => {
  let input: SeasonBlockSimulationInput;
  let checkpoint: ReturnType<typeof simulateSeasonBlock>;
  let totalInjuryEvents = 0;
  beforeAll(() => {
    const { run, catalog } = buildTestRun();
    input = pipelineInput(run, catalog, 0);
    checkpoint = simulateSeasonBlock(input);
    for (const summary of checkpoint.gameSummaries) {
      totalInjuryEvents += summary.injuryEvents.length;
    }
  }, 60000);
  it('rolls injuries into the block, carries compact events, and reconciles health', () => {
    expect(totalInjuryEvents).toBeGreaterThan(0);
    const eventKeys = new Set<string>();
    for (const summary of checkpoint.gameSummaries) {
      for (const event of summary.injuryEvents) {
        eventKeys.add(`${summary.gameId}\u0000${event.playerVersionId}`);
      }
    }
    const recordKeys = new Set<string>();
    for (const record of checkpoint.health.injuries) {
      recordKeys.add(`${record.gameId}\u0000${record.playerVersionId}`);
      const summary = checkpoint.gameSummaries.find((entry) => entry.gameId === record.gameId);
      const event = summary?.injuryEvents.find(
        (entry) => entry.playerVersionId === record.playerVersionId,
      );
      expect(event).toBeDefined();
      if (event !== undefined) {
        expect(event.type).toBe(record.type);
        expect(event.severity).toBe(record.severity);
      }
    }
    expect(eventKeys.size).toBe(recordKeys.size);
    expect(checkpoint.health.injuries.length).toBe(totalInjuryEvents);
    expect(checkpoint.recap.injuryEvidence.injuries).toBe(totalInjuryEvents);
    const bySeverity = checkpoint.recap.injuryEvidence.bySeverity;
    const sumSeverity =
      bySeverity.minor + bySeverity.moderate + bySeverity.major + bySeverity['season-ending'];
    expect(sumSeverity).toBe(totalInjuryEvents);
    expect(auditSeasonBlock(checkpoint, input)).toEqual([]);
    for (const record of checkpoint.health.injuries) {
      if (record.missedGamesRemaining > 0 && record.sameGameReturned !== true) {
        expect(record.actualReturnRound).toBeNull();
      }
    }
  });
  it('folds the dealt challenges, influence grants, and transactions into the candidate', () => {
    const { run, catalog } = buildTestRun();
    const deal = challengeDealOf(run, 0);
    const baseInput = pipelineInput(run, catalog, 0);
    const withChallenges: SeasonBlockSimulationInput = {
      ...baseInput,
      challengeDeal: deal,
      command: {
        ...baseInput.command,
        objectiveId: null,
        challengeIds: [...deal.challengeIds],
      },
    };
    const candidate = simulateSeasonBlock(withChallenges);
    expect(candidate.challenges).toBeDefined();
    expect(candidate.challenges?.blockIndex).toBe(0);
    expect(candidate.challenges?.results).toHaveLength(3);
    expect(candidate.challengeIds).toEqual([...deal.challengeIds].sort());
    const resultIds = (
      candidate.challenges?.results.map((result) => result.challengeId) ?? []
    ).sort();
    expect(resultIds).toEqual([...deal.challengeIds].sort());
    for (const result of candidate.challenges?.results ?? []) {
      expect(typeof result.success).toBe('boolean');
    }
    const earned = (candidate.challenges?.results ?? []).reduce(
      (sum, result) =>
        sum +
        (result.success
          ? (SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
              ?.reward ?? 0)
          : 0),
      0,
    );
    const franchiseIds = run.league.teams.map((team) => team.franchiseId);
    for (const franchiseId of franchiseIds) {
      const balance = candidate.influence.balances[franchiseId] ?? 0;
      expect(balance).toBeGreaterThanOrEqual(3);
      expect(balance).toBeLessThanOrEqual(3 + 4);
    }
    const humanDelta = candidate.influence.ledger
      .filter((entry) => entry.franchiseId === 'lakers' && entry.blockIndex === 0)
      .reduce((sum, entry) => sum + entry.appliedDelta, 0);
    expect(humanDelta).toBe(1 + earned);
    expect(candidate.recap.tradeEvidence.influenceDelta).toBe(humanDelta);
    expect(candidate.recap.influenceBalance.humanBalance).toBe(
      candidate.influence.balances[franchiseIdSchema.parse('lakers')] ?? 0,
    );
    expect(candidate.transactions.some((entry) => entry.type === 'block-grant')).toBe(true);
    const successes = (candidate.challenges?.results ?? []).filter(
      (result) => result.success,
    ).length;
    expect(candidate.transactions.filter((entry) => entry.type === 'challenge-reward').length).toBe(
      successes,
    );
    expect(candidate.recap.challengeEvidence).toHaveLength(3);
    expect(auditSeasonBlock(candidate, withChallenges)).toEqual([]);
  }, 60000);
  it('audits newly appended challenge-reward transactions independently of prior history', () => {
    const { run, catalog } = buildTestRun();
    const checkpoint0 = simulateSeasonBlock(pipelineInput(run, catalog, 0));
    const stateFacts0 = deriveSeasonPostBlockState({
      run,
      candidate: checkpoint0,
      commandId: blockCommand(run, 0, 0).commandId,
      rotationDigest: blockCommand(run, 0, 0).rotationDigest,
    });
    const priorGrant = applySeasonBlockInfluenceGrants({
      influence: checkpoint0.influence,
      blockIndex: 1,
      humanFranchiseId: 'lakers',
      challengeSuccesses: [{ challengeId: 'winning-block', success: true, reward: 1 }],
    });
    const priorReward = priorGrant.entries.find((entry) => entry.type === 'challenge-reward');
    expect(priorReward).toBeDefined();
    if (priorReward === undefined) throw new Error('expected a prior challenge reward');
    const runAfter0 = {
      ...run,
      cursor: { schemaVersion: 1 as const, completedRounds: checkpoint0.completedRounds },
      standings: checkpoint0.standings,
      health: checkpoint0.health,
      influence: priorGrant.influence,
      transactions: [...checkpoint0.transactions, priorReward],
      checkpointState: stateFacts0.checkpointState,
      stateRevision: stateFacts0.stateRevision,
      stateDigest: stateFacts0.stateDigest,
    };
    const deal1 = challengeDealOf(runAfter0, 1);
    const withChallenges1: SeasonBlockSimulationInput = {
      ...pipelineInput(runAfter0, catalog, 1, checkpoint0.gameSummaries, checkpoint0.effects),
      challengeDeal: deal1,
      command: {
        ...blockCommand(runAfter0, 1, 1),
        objectiveId: null,
        challengeIds: [...deal1.challengeIds],
      },
    };
    const checkpoint1 = simulateSeasonBlock(withChallenges1);
    expect(auditSeasonBlock(checkpoint1, withChallenges1)).toEqual([]);
  }, 120000);
  it('rejects invalid challenges at the command boundary', () => {
    const { run, catalog } = buildTestRun();
    const deal = challengeDealOf(run, 0);
    const base = pipelineInput(run, catalog, 0);
    expect(seasonBlockRejection({ ...base, challengeDeal: null })).toMatchObject({
      code: 'invalid-challenge',
      expected: 'required',
      blockIndex: 0,
    });
    const otherDeal = challengeDealOf(run, 1);
    expect(
      seasonBlockRejection({
        ...base,
        challengeDeal: deal,
        command: { ...base.command, objectiveId: null, challengeIds: [...otherDeal.challengeIds] },
      }),
    ).toMatchObject({ code: 'invalid-challenge', expected: 'not-offered' });
    expect(
      seasonBlockRejection({
        ...base,
        challengeDeal: deal,
        command: { ...base.command, objectiveId: null, challengeIds: [...deal.challengeIds] },
      }),
    ).toBeNull();
    const block8 = pipelineInput(
      { ...run, cursor: { schemaVersion: 1 as const, completedRounds: 80 } },
      catalog,
      8,
    );
    expect(
      seasonBlockRejection({
        ...block8,
        challengeDeal: deal,
        command: { ...block8.command, objectiveId: null, challengeIds: [...deal.challengeIds] },
      }),
    ).toMatchObject({ code: 'invalid-challenge', expected: 'none' });
    expect(
      seasonBlockRejection({ ...block8, command: { ...block8.command, objectiveId: null } }),
    ).toBeNull();
  });
  it('interrupts mid-block and resumes to the identical uninterrupted digest', () => {
    const { run, catalog } = buildTestRun();
    const block8Run = { ...run, cursor: { schemaVersion: 1 as const, completedRounds: 80 } };
    const legalInput = pipelineInput(block8Run, catalog, 8);
    const games = seasonBlockGamesOf(legalInput.schedule, 8);
    const humanIndex = games.findIndex(
      (game) => game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers',
    );
    expect(humanIndex).toBeGreaterThan(0);
    const fromRound = 81;
    const loop = (
      input: SeasonBlockSimulationInput,
      startIndex: number,
      startEffects: SeasonBlockSimulationInput['effects'],
      startHealth: SeasonHealthState,
      stopIndex?: number,
      initialPreviousRound?: number,
    ) => {
      let previousRound = initialPreviousRound ?? fromRound - 1;
      let effects = startEffects;
      let health = startHealth;
      const summaries: SeasonGameSummary[] = [];
      let interruption: {
        nextGameId: string;
      } | null = null;
      for (let i = startIndex; i < games.length; i += 1) {
        if (stopIndex !== undefined && i >= stopIndex) break;
        const game = games[i];
        if (game === undefined) continue;
        const outcome = simulateSeasonBlockGame(input, game, effects, health, {
          skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
        });
        if ('interruption' in outcome) {
          interruption = { nextGameId: outcome.interruption.nextGameId };
          break;
        }
        effects = outcome.effects;
        health = outcome.health;
        previousRound = game.round;
        summaries.push(outcome.summary);
      }
      return { summaries, effects, health, interruption };
    };
    const interruptedInput: SeasonBlockSimulationInput = {
      ...legalInput,
      health: blockedHealthOf(block8Run),
    };
    const interrupted = loop(
      interruptedInput,
      0,
      interruptedInput.effects,
      interruptedInput.health,
    );
    expect(interrupted.interruption?.nextGameId).toBe(games[humanIndex]?.gameId);
    const pending = assembleSeasonPendingBlock({
      run: block8Run,
      commandId: interruptedInput.command.commandId,
      blockIndex: 8,
      expectedRevision: 8,
      expectedStateRevision: interruptedInput.command.expectedStateRevision,
      expectedStateDigest: interruptedInput.command.expectedStateDigest,
      objectiveId: null,
      nextGameId: interrupted.interruption?.nextGameId ?? '',
      summaries: interrupted.summaries,
      retainedDetails: [],
      effects: interrupted.effects,
      health: interrupted.health,
      rotationDigest: interruptedInput.command.rotationDigest,
    });
    expect(pending.summaries).toHaveLength(humanIndex);
    const legalBefore = loop(legalInput, 0, legalInput.effects, legalInput.health, humanIndex);
    const legalFull = loop(legalInput, 0, legalInput.effects, legalInput.health);
    expect(JSON.stringify(pending.effects)).toBe(JSON.stringify(legalBefore.effects));
    const lastSimulatedRound =
      pending.summaries.length > 0
        ? pending.summaries[pending.summaries.length - 1]?.round
        : fromRound - 1;
    const resumed = loop(
      legalInput,
      humanIndex,
      legalBefore.effects,
      legalBefore.health,
      undefined,
      lastSimulatedRound,
    );
    const union = [...pending.summaries, ...resumed.summaries];
    const unionIds = union.map((summary) => summary.gameId);
    expect(new Set(unionIds).size).toBe(unionIds.length);
    expect(unionIds.sort()).toEqual(legalFull.summaries.map((summary) => summary.gameId).sort());
    const candidate = assembleSeasonBlockCandidate(
      legalInput,
      union,
      [],
      resumed.effects,
      resumed.health,
    );
    const uninterrupted = assembleSeasonBlockCandidate(
      legalInput,
      legalFull.summaries,
      [],
      legalFull.effects,
      legalFull.health,
    );
    expect(candidate.digest).toBe(uninterrupted.digest);
    expect(auditSeasonBlock(candidate, legalInput)).toEqual([]);
    const committed = deriveSeasonPostBlockState({
      run: block8Run,
      candidate,
      commandId: interruptedInput.command.commandId,
      rotationDigest: interruptedInput.command.rotationDigest,
    });
    expect(committed.checkpointState.blockIndex).toBe(8);
    expect(committed.checkpointState.completedRounds).toBe(82);
    expect(committed.stateRevision).toBe(block8Run.stateRevision + 1);
    expect(committed.stateDigest).toMatch(/^[0-9a-f]{32}$/);
  }, 60000);
  it('derives the post-block state chain from an accepted candidate', () => {
    const { run } = buildTestRun();
    const stateFacts = deriveSeasonPostBlockState({
      run,
      candidate: checkpoint,
      commandId: input.command.commandId,
      rotationDigest: input.command.rotationDigest,
    });
    expect(stateFacts.checkpointState.runId).toBe(run.runId);
    expect(stateFacts.checkpointState.blockIndex).toBe(0);
    expect(stateFacts.checkpointState.revision).toBe(1);
    expect(stateFacts.checkpointState.checkpointDigest).toBe(checkpoint.digest);
    expect(stateFacts.stateRevision).toBe(1);
    expect(stateFacts.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    const accepted = handleSubmitSeasonBlockCommand({
      ...input,
      acceptedCommandIds: [],
    });
    expect(accepted.status).toBe('accepted');
  }, 60000);
});
