import { describe, expect, it } from 'vitest';
import {
  seasonPendingBlockCandidateSchema,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
} from '@hoop-rush/data-contracts';
import { buildTestRun, emptyHealthState, pipelineInput, scheduleOf } from './block-test-support.ts';
import {
  advancePendingAfterForfeit,
  assembleSeasonPendingBlock,
  seasonForfeitSummaryForGame,
  seasonFranchiseLegalFiveFacts,
  seasonGameHealthSeam,
} from './health.ts';
import { seasonPlayerAvailable } from './injuries.ts';
import {
  assembleSeasonBlockCandidate,
  auditSeasonBlock,
  seasonBlockGamesOf,
  simulateSeasonBlockGame,
  type SeasonBlockSimulationInput,
} from './block.ts';
import { seasonCheckpointDigest } from './checkpoint.ts';

function injuryRecord(overrides: Partial<SeasonInjuryRecord>): SeasonInjuryRecord {
  return {
    injuryId: 'inj-' + 'f'.repeat(32),
    playerVersionId: 'pv-x',
    franchiseId: 'lakers',
    gameId: 's000001',
    type: 'soft-tissue',
    severity: 'moderate',
    occurredBeforeHalftime: false,
    sameGameReturn: false,
    sameGameReturned: null,
    missedGamesTotal: 3,
    missedGamesRemaining: 3,
    actualReturnRound: null,
    seasonEnding: false,
    rehabModifier: 0,
    recurrenceWindowRoundsRemaining: 0,
    seedPath: ['injuries', 's000001', 'pv-x', 'occurrence'],
    ...overrides,
  };
}

function healthWith(injuries: SeasonInjuryRecord[]): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: 'season-health-v1',
    injuries,
  };
}

function fromRoundOf(input: SeasonBlockSimulationInput): number {
  const games = seasonBlockGamesOf(input.schedule, input.command.blockIndex);
  const first = games[0];
  if (first === undefined) return 1;
  return Math.floor((first.round - 1) / 10) * 10 + 1;
}

function runGameLoop(
  input: SeasonBlockSimulationInput,
  startIndex: number,
  startEffects: SeasonBlockSimulationInput['effects'],
  startHealth: SeasonHealthState,
  stopIndex?: number,
  initialPreviousRound?: number,
): {
  summaries: SeasonGameSummary[];
  effects: SeasonBlockSimulationInput['effects'];
  health: SeasonHealthState;
  interruption: { nextGameId: string } | null;
} {
  const games = seasonBlockGamesOf(input.schedule, input.command.blockIndex);
  let previousRound = initialPreviousRound ?? fromRoundOf(input) - 1;
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
}

describe('season player availability (M2.5 §4)', () => {
  it('derives availability from active injuries only', () => {
    const active = healthWith([
      injuryRecord({ playerVersionId: 'pv-1', missedGamesRemaining: 2 }),
      injuryRecord({ playerVersionId: 'pv-2', missedGamesRemaining: 1, sameGameReturned: false }),
      injuryRecord({ playerVersionId: 'pv-3', missedGamesRemaining: 0 }),
      injuryRecord({ playerVersionId: 'pv-4', missedGamesRemaining: 2, sameGameReturned: true }),
      injuryRecord({
        playerVersionId: 'pv-5',
        missedGamesRemaining: 2,
        sameGameReturn: true,
        missedGamesTotal: 0,
      }),
    ]);
    expect(seasonPlayerAvailable(active, 'pv-1')).toBe(false);
    expect(seasonPlayerAvailable(active, 'pv-2')).toBe(false);
    expect(seasonPlayerAvailable(active, 'pv-3')).toBe(true);
    expect(seasonPlayerAvailable(active, 'pv-4')).toBe(true);

    expect(seasonPlayerAvailable(active, 'pv-5')).toBe(false);
    expect(seasonPlayerAvailable(active, 'pv-other')).toBe(true);
  });
});

describe('season franchise legal-five facts (M2.5 §9)', () => {
  it('reports legal with no injuries and lists every unavailable player otherwise', () => {
    const { run } = buildTestRun();
    const facts = seasonFranchiseLegalFiveFacts(run, 'lakers', emptyHealthState());
    expect(facts.legal).toBe(true);
    expect(facts.unavailablePlayerVersionIds).toEqual([]);

    const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
    if (roster === undefined) throw new Error('lakers roster');
    const allOut = roster.players.map((player, index) =>
      injuryRecord({
        injuryId: `inj-${String(index).padStart(32, '0')}`,
        playerVersionId: player.playerVersionId,
        gameId: 's000001',
        seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
      }),
    );
    const illegal = seasonFranchiseLegalFiveFacts(run, 'lakers', healthWith(allOut));
    expect(illegal.legal).toBe(false);
    expect(illegal.unavailablePlayerVersionIds.sort()).toEqual(
      roster.players.map((player) => player.playerVersionId).sort(),
    );
  });

  it('uses the rotation planner machinery with position facts', () => {
    const { run, catalog } = buildTestRun();
    const positions = new Map(
      catalog.candidates.map((candidate) => [
        candidate.playerVersionId,
        candidate.positions.playable,
      ]),
    );
    const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
    if (roster === undefined) throw new Error('lakers roster');
    const starters =
      run.rotations.find((rotation) => rotation.franchiseId === 'lakers')?.starters ?? [];
    const starterOut = roster.players
      .filter((player) => starters.includes(player.playerVersionId))
      .map((player, index) =>
        injuryRecord({
          injuryId: `inj-${String(index).padStart(32, '0')}`,
          playerVersionId: player.playerVersionId,
          gameId: 's000001',
          seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
        }),
      );
    const withPositions = seasonFranchiseLegalFiveFacts(
      run,
      'lakers',
      healthWith(starterOut),
      positions,
    );

    expect(withPositions.unavailablePlayerVersionIds).toHaveLength(5);

    const withoutPositions = seasonFranchiseLegalFiveFacts(run, 'lakers', healthWith(starterOut));
    expect(withoutPositions.legal).toBe(true);
  });
});

describe('season game health seam (M2.5 §9)', () => {
  it('produces the pregame availability for all 20 players and deterministic rolls', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const games = seasonBlockGamesOf(input.schedule, 0);
    const game = games[0];
    if (game === undefined) throw new Error('block 0 games');
    const rotationByFranchise = new Map(
      run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
    );
    const targetMinutesByPlayer = new Map<string, number>();
    for (const franchiseId of [game.homeFranchiseId, game.awayFranchiseId]) {
      const rotation = rotationByFranchise.get(franchiseId);
      if (rotation === undefined) throw new Error('rotation');
      for (const entry of rotation.targetMinutes) {
        targetMinutesByPlayer.set(entry.playerVersionId, entry.minutes);
      }
    }
    const base = {
      rootSeed: run.rootSeed,
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      targetMinutesByPlayer,
      durabilityByPlayer: new Map<string, number>(),
    };
    const first = seasonGameHealthSeam(run, emptyHealthState(), base);
    const second = seasonGameHealthSeam(run, emptyHealthState(), base);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const homeRoster = run.rosters.find((entry) => entry.franchiseId === game.homeFranchiseId);
    const awayRoster = run.rosters.find((entry) => entry.franchiseId === game.awayFranchiseId);
    if (homeRoster === undefined || awayRoster === undefined) throw new Error('rosters');
    expect(first.pregame.size).toBe(20);
    for (const player of [...homeRoster.players, ...awayRoster.players]) {
      expect(first.pregame.get(player.playerVersionId)).toBe(true);
    }
    for (const removal of first.removals) {
      expect(removal.reason).toBe('injury');
      expect(removal.clock.period).toBeGreaterThanOrEqual(1);
      expect(removal.clock.period).toBeLessThanOrEqual(4);
    }
    for (const ret of first.returns) {
      expect(ret.reason).toBe('injury-return');
    }
    for (const record of first.newInjuries) {
      expect(record.gameId).toBe(game.gameId);
    }
  });
});

describe('season forfeit and pending assembly (M2.5 §10)', () => {
  it('builds the official 2-0 human-interruption forfeit summary', () => {
    const { run } = buildTestRun();
    const schedule = scheduleOf(run);
    const lakersGame = schedule.games.find(
      (game) => game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers',
    );
    if (lakersGame === undefined) throw new Error('lakers game');
    const summary = seasonForfeitSummaryForGame(run, lakersGame.gameId, 'lakers');
    expect(summary.status).toBe('forfeit');
    expect(summary.homeScore + summary.awayScore).toBe(2);
    expect(summary.forfeitLoserFranchiseId).toBe('lakers');
    expect(summary.homePlayers).toEqual([]);
    expect(summary.awayPlayers).toEqual([]);
    expect(summary.injuryEvents).toEqual([]);
    const winnerScore =
      summary.homeFranchiseId === 'lakers' ? summary.awayScore : summary.homeScore;
    expect(winnerScore).toBe(2);
  });

  it('advances the pending candidate in block order and rejects a completed block', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const games = seasonBlockGamesOf(input.schedule, 0);
    const pending = assembleSeasonPendingBlock({
      run,
      commandId: 'cmd-forfeit',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
      objectiveId: null,
      nextGameId: games[0]?.gameId ?? 's000001',
      summaries: [],
      retainedDetails: [],
      effects: input.effects,
      health: emptyHealthState(),
      rotationDigest: '0'.repeat(32),
    });
    const first = games[0];
    const second = games[1];
    if (first === undefined || second === undefined) throw new Error('block games');
    const advanced = advancePendingAfterForfeit(pending, first.gameId);
    expect(advanced.nextGameId).toBe(second.gameId);
    expect(advanced.summaries).toEqual([]);

    const last = games[games.length - 1];
    if (last === undefined) throw new Error('last game');
    expect(() => advancePendingAfterForfeit(pending, last.gameId)).toThrow(/last game/);
  });

  it('assembles a schema-valid pending candidate', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const games = seasonBlockGamesOf(input.schedule, 0);
    const pending = assembleSeasonPendingBlock({
      run,
      commandId: 'cmd-pending',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
      objectiveId: null,
      nextGameId: games[3]?.gameId ?? 's000004',
      summaries: [],
      retainedDetails: [],
      effects: input.effects,
      health: emptyHealthState(),
      rotationDigest: '0'.repeat(32),
    });
    expect(seasonPendingBlockCandidateSchema.safeParse(pending).success).toBe(true);
    expect(pending.blockIndex).toBe(0);
    expect(pending.commandId).toBe('cmd-pending');
    expect(pending.nextGameId).toBe(games[3]?.gameId);
    expect(pending.summaries).toEqual([]);
    expect(pending.teamAggregates).toHaveLength(0);
    expect(pending.playerAggregates).toHaveLength(0);
  });
});

describe('interruption and resume accounting (M2.5 §10)', () => {
  it('interrupts at the first human game and resumes without duplicating summaries', () => {
    const { run, catalog } = buildTestRun();
    const schedule = scheduleOf(run);
    const games = seasonBlockGamesOf(schedule, 0);

    const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
    if (roster === undefined) throw new Error('lakers roster');
    const blocked = roster.players.map((player, index) =>
      injuryRecord({
        injuryId: `inj-${String(index).padStart(32, '0')}`,
        playerVersionId: player.playerVersionId,
        gameId: 's000001',
        missedGamesRemaining: 10,
        missedGamesTotal: 10,
        seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
      }),
    );
    const interruptedInput: SeasonBlockSimulationInput = {
      ...pipelineInput(run, catalog, 0),
      health: healthWith(blocked),
    };
    const interruptionIndex = games.findIndex(
      (game) => game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers',
    );
    const firstRun = runGameLoop(
      interruptedInput,
      0,
      interruptedInput.effects,
      interruptedInput.health,
    );
    expect(firstRun.interruption).not.toBeNull();
    expect(firstRun.interruption?.nextGameId).toBe(games[interruptionIndex]?.gameId);
    expect(firstRun.summaries).toHaveLength(interruptionIndex);

    const pending = assembleSeasonPendingBlock({
      run,
      commandId: interruptedInput.command.commandId,
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: interruptedInput.command.expectedStateRevision,
      expectedStateDigest: interruptedInput.command.expectedStateDigest,
      objectiveId: null,
      nextGameId: firstRun.interruption?.nextGameId ?? '',
      summaries: firstRun.summaries,
      retainedDetails: [],
      effects: firstRun.effects,
      health: firstRun.health,
      rotationDigest: interruptedInput.command.rotationDigest,
    });
    expect(seasonPendingBlockCandidateSchema.safeParse(pending).success).toBe(true);
    expect(pending.nextGameId).toBe(games[interruptionIndex]?.gameId);
    expect(pending.summaries.map((summary) => summary.gameId)).toEqual(
      games.slice(0, interruptionIndex).map((game) => game.gameId),
    );

    expect(
      pending.summaries.some((summary) => summary.gameId === games[interruptionIndex]?.gameId),
    ).toBe(false);

    const legalInput = pipelineInput(run, catalog, 0);
    const legalBefore = runGameLoop(
      legalInput,
      0,
      legalInput.effects,
      legalInput.health,
      interruptionIndex,
    );
    const legalFull = runGameLoop(legalInput, 0, legalInput.effects, legalInput.health);

    expect(JSON.stringify(pending.effects)).toBe(JSON.stringify(legalBefore.effects));

    const lastSimulatedRound =
      pending.summaries.length > 0
        ? pending.summaries[pending.summaries.length - 1]?.round
        : fromRoundOf(legalInput) - 1;
    const resumed = runGameLoop(
      legalInput,
      interruptionIndex,
      legalBefore.effects,
      legalBefore.health,
      undefined,
      lastSimulatedRound,
    );
    const union = [...pending.summaries, ...resumed.summaries];
    const unionIds = union.map((summary) => summary.gameId);
    expect(new Set(unionIds).size).toBe(unionIds.length);
    expect(unionIds.sort()).toEqual(legalFull.summaries.map((summary) => summary.gameId).sort());
    expect(resumed.summaries).toHaveLength(games.length - interruptionIndex);

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
    expect(seasonCheckpointDigest(candidate)).toBe(seasonCheckpointDigest(uninterrupted));
    expect(candidate.digest).toBe(uninterrupted.digest);
    expect(auditSeasonBlock(candidate, legalInput)).toEqual([]);
  }, 120_000);

  it('forfeits every blocked human game deterministically and reproduces the digest', () => {
    const { run, catalog } = buildTestRun();
    const games = seasonBlockGamesOf(scheduleOf(run), 0);
    const roster = run.rosters.find((entry) => entry.franchiseId === 'lakers');
    if (roster === undefined) throw new Error('lakers roster');
    const blocked = roster.players.map((player, index) =>
      injuryRecord({
        injuryId: `inj-${String(index).padStart(32, '0')}`,
        playerVersionId: player.playerVersionId,
        gameId: 's000001',
        missedGamesRemaining: 10,
        missedGamesTotal: 10,
        seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
      }),
    );
    const input: SeasonBlockSimulationInput = {
      ...pipelineInput(run, catalog, 0),
      health: healthWith(blocked),
    };
    const forfeitChain = (): string => {
      let previousRound = fromRoundOf(input) - 1;
      let effects = input.effects;
      let health = input.health;
      const summaries: SeasonGameSummary[] = [];
      for (let index = 0; index < games.length; index += 1) {
        const game = games[index];
        if (game === undefined) continue;
        const humanPlays = game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers';
        if (humanPlays) {
          summaries.push(seasonForfeitSummaryForGame(run, game.gameId, 'lakers'));
          const pending = assembleSeasonPendingBlock({
            run,
            commandId: input.command.commandId,
            blockIndex: 0,
            expectedRevision: 0,
            expectedStateRevision: input.command.expectedStateRevision,
            expectedStateDigest: input.command.expectedStateDigest,
            objectiveId: null,
            nextGameId: game.gameId,
            summaries,
            retainedDetails: [],
            effects,
            health,
            rotationDigest: input.command.rotationDigest,
          });
          const advanced = advancePendingAfterForfeit(pending, game.gameId);
          const next = games[index + 1];
          if (next !== undefined) {
            expect(advanced.nextGameId).toBe(next.gameId);
          }
          continue;
        }
        const outcome = simulateSeasonBlockGame(input, game, effects, health, {
          skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
        });
        if ('interruption' in outcome) throw new Error('unexpected interruption in an AI game');
        effects = outcome.effects;
        health = outcome.health;
        previousRound = game.round;
        summaries.push(outcome.summary);
      }
      const candidate = assembleSeasonBlockCandidate(input, summaries, [], effects, health);
      expect(auditSeasonBlock(candidate, input)).toEqual([]);
      expect(summaries).toHaveLength(games.length);
      const humanGameCount = games.filter(
        (game) => game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers',
      ).length;

      expect(
        summaries.filter((summary) => summary.forfeitLoserFranchiseId === 'lakers'),
      ).toHaveLength(humanGameCount);
      const ids = summaries.map((summary) => summary.gameId);
      expect(new Set(ids).size).toBe(ids.length);
      return candidate.digest;
    };
    expect(forfeitChain()).toBe(forfeitChain());
  }, 120_000);
});
