import { beforeAll, describe, expect, it } from 'vitest';
import {
  SEASON_OBJECTIVE_CATALOG,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
} from '@hoop-rush/data-contracts';
import { buildTestRun, pipelineInput } from './block-test-support.ts';
import {
  SeasonBlockCancelledError,
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
import { seasonObjectiveChoicesForBlock } from './objectives.ts';

/**
 * M2.5 block pipeline with injuries: summaries carry the compact injury
 * events, the candidate health reconciles with them, the objective is
 * evaluated from saved facts and the grants/transactions fold, invalid
 * objectives reject at the command boundary, and every digest is
 * reproducible across cancel/retry and interruption/resume.
 */

function blockedHealthOf(run: SeasonBlockSimulationInput['run']): SeasonHealthState {
  const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
  if (roster === undefined) throw new Error('lakers roster');
  const injuries: SeasonInjuryRecord[] = roster.players.map((player, index) => ({
    injuryId: `inj-${String(index).padStart(32, '0')}`,
    playerVersionId: player.playerVersionId,
    franchiseId: 'lakers',
    gameId: 's000001',
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
  return { schemaVersion: 1, healthVersion: 'season-health-v1', injuries };
}

describe('M2.5 block pipeline with injuries', () => {
  // Block 0 costs ~10s; the whole-block shape tests share one simulation.
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
  }, 60_000);

  it('rolls injuries into the block, carries compact events, and reconciles health', () => {
    // A 150-game block with ~20 exposed players per game rolls plenty of
    // injuries at the frozen 80 bp base.
    expect(totalInjuryEvents).toBeGreaterThan(0);
    // Every summary event has one matching candidate health record with the
    // same player, game, type, and severity.
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
    // One event per record: the recap counts reconcile exactly.
    expect(eventKeys.size).toBe(recordKeys.size);
    expect(checkpoint.health.injuries.length).toBe(totalInjuryEvents);
    expect(checkpoint.recap.injuryEvidence.injuries).toBe(totalInjuryEvents);
    const bySeverity = checkpoint.recap.injuryEvidence.bySeverity;
    const sumSeverity =
      bySeverity.minor + bySeverity.moderate + bySeverity.major + bySeverity['season-ending'];
    expect(sumSeverity).toBe(totalInjuryEvents);
    expect(auditSeasonBlock(checkpoint, input)).toEqual([]);
    // Availability semantics: every injury still active at block end made
    // the player unavailable.
    for (const record of checkpoint.health.injuries) {
      if (record.missedGamesRemaining > 0 && record.sameGameReturned !== true) {
        expect(record.actualReturnRound).toBeNull();
      }
    }
  });

  it('reproduces the candidate digest across cancel and retry', () => {
    const cancelled = (() => {
      const { run, catalog } = buildTestRun();
      const input2 = pipelineInput(run, catalog, 0, [], input.effects);
      expect(() => simulateSeasonBlock(input2, { cancelAfterGames: 75 })).toThrow(
        SeasonBlockCancelledError,
      );
      const checkpoint2 = simulateSeasonBlock(input2);
      expect(auditSeasonBlock(checkpoint2, input2)).toEqual([]);
      return checkpoint2.digest;
    })();
    expect(cancelled).toBe(checkpoint.digest);
  }, 60_000);

  it('folds the locked objective, influence grants, and transactions into the candidate', () => {
    const { run, catalog } = buildTestRun();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0];
    if (offered === undefined) throw new Error('block 0 objective choices');
    const objectives: SeasonBlockSimulationInput['objectives'] = {
      schemaVersion: 1,
      objectiveVersion: 'season-objective-v1',
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {
        0: { objectiveId: offered, selectedByCommandId: 'cmd-select-0', success: null },
      },
    };
    const withObjective: SeasonBlockSimulationInput = {
      ...pipelineInput(run, catalog, 0),
      objectiveId: offered,
      objectives,
      command: { ...pipelineInput(run, catalog, 0).command, objectiveId: offered },
    };
    const candidate = simulateSeasonBlock(withObjective);
    expect(candidate.objective.objectiveId).toBe(offered);
    expect(typeof candidate.objective.success).toBe('boolean');
    expect(candidate.objective.evaluation.blockIndex).toBe(0);
    expect(candidate.objective.evaluation.objectiveId).toBe(offered);
    // Every franchise gained the +1 block grant over the initial +2.
    const franchiseIds = run.league.teams.map((team) => team.franchiseId);
    for (const franchiseId of franchiseIds) {
      const balance = candidate.influence.balances[franchiseId] ?? 0;
      expect(balance).toBeGreaterThanOrEqual(3);
      expect(balance).toBeLessThanOrEqual(4);
    }
    // The human's ledger delta this block is 1 (grant) plus 1 on success.
    const humanDelta = candidate.influence.ledger
      .filter((entry) => entry.franchiseId === 'lakers' && entry.blockIndex === 0)
      .reduce((sum, entry) => sum + entry.appliedDelta, 0);
    expect(humanDelta).toBe(candidate.objective.success ? 2 : 1);
    expect(candidate.recap.tradeEvidence.influenceDelta).toBe(humanDelta);
    expect(candidate.recap.influenceBalance.humanBalance).toBe(
      candidate.influence.balances['lakers'] ?? 0,
    );
    // Transactions: the league-wide block grant (plus the reward on success).
    expect(candidate.transactions.some((entry) => entry.type === 'block-grant')).toBe(true);
    expect(candidate.transactions.filter((entry) => entry.type === 'objective-reward').length).toBe(
      candidate.objective.success ? 1 : 0,
    );
    // The recap's objective evidence mirrors the evaluated objective.
    if (candidate.objective.objectiveId !== null) {
      expect(candidate.recap.objectiveEvidence?.objectiveId).toBe(candidate.objective.objectiveId);
      expect(candidate.recap.objectiveEvidence?.success).toBe(candidate.objective.success);
    }
    expect(auditSeasonBlock(candidate, withObjective)).toEqual([]);
  }, 60_000);

  it('rejects invalid objectives at the command boundary', () => {
    const { run, catalog } = buildTestRun();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0];
    if (offered === undefined) throw new Error('objective choices');
    const objectives: SeasonBlockSimulationInput['objectives'] = {
      schemaVersion: 1,
      objectiveVersion: 'season-objective-v1',
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {
        0: { objectiveId: offered, selectedByCommandId: 'cmd-select-0', success: null },
      },
    };
    const base = { ...pipelineInput(run, catalog, 0), objectives };

    // Block 0 with a null objective: required.
    expect(seasonBlockRejection(base)).toMatchObject({
      code: 'invalid-objective',
      expected: 'required',
      blockIndex: 0,
    });

    // Block 0 with an objective that was never offered/selected: not-offered.
    const otherId = offered === 'win-six' ? 'defense-108' : 'win-six';
    expect(
      seasonBlockRejection({
        ...base,
        command: { ...base.command, objectiveId: otherId },
      }),
    ).toMatchObject({ code: 'invalid-objective', expected: 'not-offered', objectiveId: otherId });

    // Block 0 with the offered+selected objective: no rejection from the
    // objective binding (the boundary checks still apply).
    expect(
      seasonBlockRejection({ ...base, command: { ...base.command, objectiveId: offered } }),
    ).toBeNull();

    // Block 8 must carry null (the objective state is supplied so the
    // binding check runs).
    const block8 = pipelineInput(
      { ...run, cursor: { schemaVersion: 1 as const, completedRounds: 80 } },
      catalog,
      8,
    );
    expect(
      seasonBlockRejection({
        ...block8,
        objectives,
        command: { ...block8.command, objectiveId: offered },
      }),
    ).toMatchObject({ code: 'invalid-objective', expected: 'none', objectiveId: offered });
    expect(
      seasonBlockRejection({
        ...block8,
        objectives,
        command: { ...block8.command, objectiveId: null },
      }),
    ).toBeNull();
  });

  it('interrupts mid-block and resumes to the identical uninterrupted digest', () => {
    // Block 8 (30 games, rounds 81-82) is the fast path; the human plays
    // exactly two games. A blocked human health interrupts at the first one.
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
    ) => {
      let previousRound = fromRound - 1;
      let effects = startEffects;
      let health = startHealth;
      const summaries: SeasonGameSummary[] = [];
      let interruption: { nextGameId: string } | null = null;
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

    // Resume from the interruption point with the state at that game:
    // partial + resumed union == the uninterrupted block, same digest. The
    // pending's effects equal the legal variant's effects at the
    // interruption point (identical AI games before the first human game);
    // the health differs only in the injected blocking records.
    const legalBefore = loop(legalInput, 0, legalInput.effects, legalInput.health, humanIndex);
    const legalFull = loop(legalInput, 0, legalInput.effects, legalInput.health);
    expect(JSON.stringify(pending.effects)).toBe(JSON.stringify(legalBefore.effects));
    const resumed = loop(legalInput, humanIndex, legalBefore.effects, legalBefore.health);
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

    // The commit-side state chain derives deterministically from the
    // candidate and the submitted run.
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
  }, 60_000);

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
    expect(stateFacts.checkpointState.checkpointDigest).toBe(checkpoint.digest);
    expect(stateFacts.stateRevision).toBe(1);
    expect(stateFacts.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    // The command-path acceptance also carries the objective binding.
    const accepted = handleSubmitSeasonBlockCommand({
      ...input,
      acceptedCommandIds: [],
    });
    expect(accepted.status).toBe('accepted');
  }, 60_000);
});
