import { describe, expect, it } from 'bun:test';
import type {
  HavocGameResult,
  HavocHighlight,
  HavocLockedInputs,
  HavocMutationRollup,
  HavocParticipant,
  HavocParticipantLine,
  HavocStatLine,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_MVP_INDEX_WEIGHTS,
  HAVOC_RULES_VERSION,
  canonicalJson,
  havocGameResultSchema,
  havocGameSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import {
  buildHavocLockedInputs,
  buildHavocParticipant,
  buildHavocTeamInput,
} from '@hoop-rush/test-fixtures';
import type { HavocStoredGame } from './api.ts';
import { compareHavocSeasons, havocProductionIndex, havocSeasonTotalsOf } from './comparison.ts';
import { havocGameResultDigest } from './digests.ts';
import { createEngineContext } from '../../sim/kernel.ts';
import { buildHavocGameInput } from './input.ts';
import { simulateHavocGame } from './game.ts';

const GAME_COUNT = 82;

function zeroLine(): HavocStatLine {
  return {
    secondsPlayed: 0,
    minutes: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    chargedFouls: 0,
    adjustments: 0,
  };
}

function lineFor(
  participant: HavocParticipant,
  overrides?: Partial<HavocStatLine>,
): HavocParticipantLine {
  return {
    instanceId: participant.instanceId,
    kind: participant.kind,
    slot: participant.slot,
    ownerInstanceId: participant.ownerInstanceId,
    sourcePlayerId: participant.source.playerId,
    sourcePlayerVersionId: participant.source.playerVersionId,
    displayName: participant.source.displayName,
    ...zeroLine(),
    ...overrides,
  };
}

export interface SyntheticSpec {
  humanScore: number;
  opponentScore: number;
  humanAdjustments?: number;
  lines?: Record<string, Partial<HavocStatLine>>;
  rollups?: HavocMutationRollup[];
  highlights?: HavocHighlight[];
}

function syntheticStoredGame(
  locked: HavocLockedInputs,
  gameNumber: number,
  variant: 'havoc' | 'normal',
  spec: SyntheticSpec,
): HavocStoredGame {
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined)
    throw new Error(`test: no schedule entry for game ${String(gameNumber)}`);
  const humanSide = entry.humanHome ? 'home' : 'away';
  const humanParticipants = [
    ...locked.human.starters,
    ...locked.human.replacements.filter(
      (participant) => spec.lines?.[participant.instanceId] !== undefined,
    ),
    ...locked.human.clones.filter(
      (participant) => spec.lines?.[participant.instanceId] !== undefined,
    ),
  ];
  const humanLines = humanParticipants.map((participant) =>
    lineFor(participant, spec.lines?.[participant.instanceId]),
  );
  const opponent = locked.opponents.find((candidate) => candidate.opponentId === entry.opponentId);
  if (opponent === undefined) throw new Error('test: unknown opponent');
  const opponentLines = opponent.team.starters.map((participant) => lineFor(participant));
  const humanTeam: HavocTeamResult = {
    side: humanSide,
    teamId: locked.human.teamId,
    displayName: locked.human.displayName,
    points: spec.humanScore,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    adjustments: spec.humanAdjustments ?? 0,
    teamBonusPoints: 0,
    periods: [spec.humanScore, 0, 0, 0],
    courtSeconds: 5 * 48 * 60,
    participants: humanLines,
  };
  const opponentTeam: HavocTeamResult = {
    side: humanSide === 'home' ? 'away' : 'home',
    teamId: opponent.team.teamId,
    displayName: opponent.team.displayName,
    points: spec.opponentScore,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    adjustments: 0,
    teamBonusPoints: 0,
    periods: [spec.opponentScore, 0, 0, 0],
    courtSeconds: 5 * 48 * 60,
    participants: opponentLines,
  };
  const home = humanSide === 'home' ? humanTeam : opponentTeam;
  const away = humanSide === 'home' ? opponentTeam : humanTeam;
  const result: HavocGameResult = havocGameResultSchema.parse({
    schemaVersion: 1,
    gameNumber,
    variant,
    seed: havocGameSeed(locked.runSeed, gameNumber),
    engineVersion: 'm3-engine-v24',
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    profileVersion: locked.profile.profileVersion,
    dataVersion: locked.versionSet.dataVersion,
    humanSide,
    home,
    away,
    winner:
      spec.humanScore > spec.opponentScore ? humanSide : humanSide === 'home' ? 'away' : 'home',
    overtimePeriods: 0,
    inputDigest: 'a'.repeat(32),
    rollups: spec.rollups ?? [],
    highlights: spec.highlights ?? [],
  });
  return { gameNumber, result, resultDigest: havocGameResultDigest(result) };
}

function buildStoredSet(
  locked: HavocLockedInputs,
  variant: 'havoc' | 'normal',
  specFor: (gameNumber: number) => SyntheticSpec,
): HavocStoredGame[] {
  return Array.from({ length: GAME_COUNT }, (_value, index) =>
    syntheticStoredGame(locked, index + 1, variant, specFor(index + 1)),
  );
}

function defaultSpec(): SyntheticSpec {
  return { humanScore: 100, opponentScore: 90 };
}

function mutationRollup(
  mutationId: HavocMutationRollup['mutationId'],
  ownerInstanceId: string,
  overrides: Partial<HavocMutationRollup> = {},
): HavocMutationRollup {
  return {
    ownerInstanceId,
    mutationId,
    side: 'human',
    triggers: 0,
    pointsDelta: 0,
    freeThrowsGranted: 0,
    turnoversCancelled: 0,
    extraPossessionsEarned: 0,
    extraPossessionsUsed: 0,
    extraPossessionsExpired: 0,
    swapPoints: 0,
    swapSeconds: 0,
    capSeconds: 0,
    activeSeconds: 0,
    ratingChanges: 0,
    ...overrides,
  };
}

function cloneLocked(): HavocLockedInputs {
  const base = buildHavocTeamInput('human');
  const starters = base.starters.map((starter, index) =>
    index === 0
      ? { ...starter, mutationPackage: [{ mutationId: 'clone-army' as const }] }
      : starter,
  );
  const owner = starters[0];
  if (owner === undefined) throw new Error('test: missing starter');
  const clone = buildHavocParticipant({
    instanceId: 'hvi-00000000000000000000000000000099',
    kind: 'clone',
    slot: 'PG',
    ownerInstanceId: owner.instanceId,
    source: owner.source,
    mutationPackage: [],
    effective: owner.effective,
  });
  return buildHavocLockedInputs({
    human: buildHavocTeamInput('human', { starters, clones: [clone] }),
  });
}

describe('compareHavocSeasons validation', () => {
  it('rejects wrong game counts and missing or duplicate game numbers', () => {
    const locked = buildHavocLockedInputs();
    const havoc = buildStoredSet(locked, 'havoc', defaultSpec);
    const normal = buildStoredSet(locked, 'normal', defaultSpec);
    expect(() =>
      compareHavocSeasons({
        runId: locked.runId,
        locked,
        havocGames: havoc.slice(0, 81),
        normalGames: normal,
      }),
    ).toThrow(/expected 82 havoc games/);
    const duplicated = [...havoc];
    duplicated[1] = duplicated[0] as HavocStoredGame;
    expect(() =>
      compareHavocSeasons({
        runId: locked.runId,
        locked,
        havocGames: duplicated,
        normalGames: normal,
      }),
    ).toThrow(/duplicate havoc game 1/);
  });

  it('rejects mismatched variants and seeds', () => {
    const locked = buildHavocLockedInputs();
    const havoc = buildStoredSet(locked, 'havoc', defaultSpec);
    const normal = buildStoredSet(locked, 'normal', defaultSpec);
    const wrongVariant = [...havoc];
    wrongVariant[0] = syntheticStoredGame(locked, 1, 'normal', defaultSpec());
    expect(() =>
      compareHavocSeasons({
        runId: locked.runId,
        locked,
        havocGames: wrongVariant,
        normalGames: normal,
      }),
    ).toThrow(/variant normal/);
    const wrongSeed = [...havoc];
    const first = havoc[0];
    if (first === undefined) throw new Error('test: missing game');
    wrongSeed[0] = {
      ...first,
      result: { ...first.result, seed: havocGameSeed(locked.runSeed, 2) },
    };
    expect(() =>
      compareHavocSeasons({
        runId: locked.runId,
        locked,
        havocGames: wrongSeed,
        normalGames: normal,
      }),
    ).toThrow(/shared game seed/);
    const wrongSide = [...havoc];
    wrongSide[0] = { ...first, result: { ...first.result, humanSide: 'away' } };
    expect(() =>
      compareHavocSeasons({
        runId: locked.runId,
        locked,
        havocGames: wrongSide,
        normalGames: normal,
      }),
    ).toThrow(/human side/);
  });
});

describe('compareHavocSeasons matched games', () => {
  it('pairs seeds and opponents and reports flips in both directions', () => {
    const locked = buildHavocLockedInputs();
    const havoc = buildStoredSet(locked, 'havoc', (gameNumber) => {
      if (gameNumber === 2) return { humanScore: 80, opponentScore: 90 };
      return { humanScore: 100, opponentScore: 90 };
    });
    const normal = buildStoredSet(locked, 'normal', (gameNumber) => {
      if (gameNumber === 1) return { humanScore: 80, opponentScore: 90 };
      return { humanScore: 100, opponentScore: 90 };
    });
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    expect(comparison.games).toHaveLength(82);
    for (let index = 0; index < 82; index += 1) {
      const havocGame = havoc[index];
      const normalGame = normal[index];
      if (havocGame === undefined || normalGame === undefined)
        throw new Error('test: missing game');
      expect(havocGame.result.seed).toBe(normalGame.result.seed);
      expect(comparison.games[index]?.gameNumber).toBe(index + 1);
      expect(comparison.games[index]?.opponentId).toBe(locked.schedule[index]?.opponentId);
    }
    expect(comparison.games[0]?.flips).toEqual({
      havocWinNormalLoss: true,
      normalWinHavocLoss: false,
    });
    expect(comparison.games[1]?.flips).toEqual({
      havocWinNormalLoss: false,
      normalWinHavocLoss: true,
    });
    expect(comparison.games[0]?.deltas).toEqual({
      pointsFor: 20,
      pointsAgainst: 0,
      margin: 20,
    });
    expect(comparison.games[1]?.deltas).toEqual({
      pointsFor: -20,
      pointsAgainst: 0,
      margin: -20,
    });
    expect(comparison.havoc.wins).toBe(81);
    expect(comparison.normal.wins).toBe(81);
    expect(comparison.winsGained).toBe(0);
    expect(comparison.havoc.differential).toBe(81 * 10 - 10);
    expect(comparison.normal.differential).toBe(81 * 10 - 10);
    expect(comparison.differentialDelta).toBe(0);
  });

  it('ranks largest positive and negative differences with signed deltas', () => {
    const locked = buildHavocLockedInputs();
    const deltas = new Map<number, number>([
      [1, 20],
      [2, 5],
      [3, -20],
      [4, -5],
    ]);
    const havoc = buildStoredSet(locked, 'havoc', (gameNumber) => ({
      humanScore: 100 + (deltas.get(gameNumber) ?? 0),
      opponentScore: 90,
    }));
    const normal = buildStoredSet(locked, 'normal', defaultSpec);
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    expect(
      comparison.largestPositiveDifferences.map((difference) => difference.pointsDelta),
    ).toEqual([20, 5]);
    expect(
      comparison.largestNegativeDifferences.map((difference) => difference.pointsDelta),
    ).toEqual([-20, -5]);
    expect(comparison.largestPositiveDifferences[0]?.gameNumber).toBe(1);
    expect(comparison.largestNegativeDifferences[0]?.gameNumber).toBe(3);
    expect(comparison.largestPositiveDifferences[0]?.outcome).toBe('win');
    expect(comparison.largestNegativeDifferences[0]?.outcome).toBe('loss');
  });
});

describe('compareHavocSeasons slots and MVP', () => {
  it('combines starter, replacement, and clone lines per draft slot', () => {
    const locked = cloneLocked();
    const starter = locked.human.starters[0];
    const replacement = locked.human.replacements[0];
    const clone = locked.human.clones[0];
    if (starter === undefined || replacement === undefined || clone === undefined) {
      throw new Error('test: incomplete locked team');
    }
    const havoc = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 110,
      opponentScore: 90,
      lines: {
        [starter.instanceId]: {
          secondsPlayed: 100,
          minutes: 2,
          points: 10,
          rebounds: { total: 3, offensive: 1, defensive: 2 },
          assists: 2,
          steals: 1,
          turnovers: 1,
          fouls: 1,
          chargedFouls: 1,
          adjustments: 4,
          fieldGoals: { made: 4, attempted: 8 },
        },
        [replacement.instanceId]: { secondsPlayed: 30, minutes: 1, points: 3 },
        [clone.instanceId]: { secondsPlayed: 50, minutes: 1, points: 5 },
      },
    }));
    const normal = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: {
        [starter.instanceId]: { secondsPlayed: 100, minutes: 2, points: 4 },
      },
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    const pg = comparison.slots[0];
    expect(pg?.slot).toBe('PG');
    expect(pg?.havoc.lines).toHaveLength(3);
    expect(pg?.havoc.lines.map((line) => line.kind).sort()).toEqual([
      'clone',
      'replacement',
      'starter',
    ]);
    expect(pg?.havoc.combined.points).toBe(82 * 18);
    expect(pg?.havoc.combined.secondsPlayed).toBe(82 * 180);
    expect(pg?.normal.lines).toHaveLength(1);
    expect(pg?.normal.combined.points).toBe(82 * 4);
    expect(pg?.deltas.points).toBe(82 * 14);
    const havocIndex = havocProductionIndex(pg?.havoc.combined ?? zeroLine());
    const normalIndex = havocProductionIndex(pg?.normal.combined ?? zeroLine());
    expect(pg?.productionIndex).toEqual({
      havoc: havocIndex,
      normal: normalIndex,
      gain: havocIndex - normalIndex,
    });
    expect(pg?.productionIndex.gain).toBe(82 * (266 - 40));
    for (const slot of comparison.slots) {
      expect(Number.isFinite(slot.deltas.points)).toBe(true);
      expect(slot.deltas.fieldGoalsMade).toBe(
        slot.havoc.combined.fieldGoals.made - slot.normal.combined.fieldGoals.made,
      );
    }
  });

  it('awards MVP ties by higher havoc index, then draft slot order', () => {
    const locked = buildHavocLockedInputs();
    const ids = locked.human.starters.map((starter) => starter.instanceId);
    const havocPoints = [20, 25, 0, 0, 0];
    const normalPoints = [15, 20, 0, 0, 0];
    const havoc = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: havocPoints[index] ?? 0 }]),
      ),
    }));
    const normal = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: normalPoints[index] ?? 0 }]),
      ),
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    const gains = comparison.slots.map((slot) => slot.productionIndex.gain);
    expect(gains[0]).toBe(82 * 50);
    expect(gains[1]).toBe(82 * 50);
    expect(comparison.mvp.slot).toBe('SG');
    expect(comparison.mvp.havocIndex).toBe(82 * 250);

    const tiedHavoc = [20, 20, 0, 0, 0];
    const tiedNormal = [15, 15, 0, 0, 0];
    const havocTied = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: tiedHavoc[index] ?? 0 }]),
      ),
    }));
    const normalTied = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: tiedNormal[index] ?? 0 }]),
      ),
    }));
    const tiedComparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havocTied,
      normalGames: normalTied,
    });
    expect(tiedComparison.mvp.slot).toBe('PG');
    expect(tiedComparison.mvp.gain).toBe(82 * 50);
  });

  it('selects the least negative gain when every slot regresses', () => {
    const locked = buildHavocLockedInputs();
    const ids = locked.human.starters.map((starter) => starter.instanceId);
    const havocPoints = [9, 0, 1, 2, 3];
    const normalPoints = [10, 10, 10, 10, 10];
    const havoc = buildStoredSet(locked, 'havoc', () => ({
      humanScore: 90,
      opponentScore: 100,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: havocPoints[index] ?? 0 }]),
      ),
    }));
    const normal = buildStoredSet(locked, 'normal', () => ({
      humanScore: 100,
      opponentScore: 90,
      lines: Object.fromEntries(
        ids.map((instanceId, index) => [instanceId, { points: normalPoints[index] ?? 0 }]),
      ),
    }));
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    expect(comparison.slots.every((slot) => slot.productionIndex.gain < 0)).toBe(true);
    expect(comparison.mvp.slot).toBe('PG');
    expect(comparison.mvp.gain).toBe(82 * -10);
    expect(comparison.winsGained).toBe(-82);
  });
});

describe('compareHavocSeasons mutations and determinism', () => {
  it('aggregates rollups by mutation id with distinct owners', () => {
    const locked = buildHavocLockedInputs();
    const pg = locked.human.starters[0]?.instanceId ?? '';
    const sg = locked.human.starters[1]?.instanceId ?? '';
    const havoc = buildStoredSet(locked, 'havoc', (gameNumber) => ({
      humanScore: 100,
      opponentScore: 90,
      rollups:
        gameNumber <= 2
          ? [
              mutationRollup('four-point-dunk', pg, { triggers: 2, pointsDelta: 4 }),
              mutationRollup('basketball-roulette', pg, { triggers: 1, pointsDelta: 3 }),
              mutationRollup('basketball-roulette', sg, { triggers: 1, pointsDelta: -1 }),
            ]
          : [mutationRollup('four-point-dunk', pg, { triggers: 1, pointsDelta: 2 })],
    }));
    const normal = buildStoredSet(locked, 'normal', defaultSpec);
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    const dunk = comparison.mutations.find((mutation) => mutation.mutationId === 'four-point-dunk');
    expect(dunk?.ownerCount).toBe(1);
    expect(dunk?.triggers).toBe(84);
    expect(dunk?.pointsDelta).toBe(168);
    const roulette = comparison.mutations.find(
      (mutation) => mutation.mutationId === 'basketball-roulette',
    );
    expect(roulette?.ownerCount).toBe(2);
    expect(roulette?.triggers).toBe(4);
    expect(roulette?.pointsDelta).toBe(4);
    expect(comparison.mutations).toHaveLength(2);
  });

  it('is deterministic for canonical JSON and digests', () => {
    const locked = buildHavocLockedInputs();
    const havoc = buildStoredSet(locked, 'havoc', defaultSpec);
    const normal = buildStoredSet(locked, 'normal', defaultSpec);
    const first = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    const second = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames: havoc,
      normalGames: normal,
    });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(seasonDigestHex(canonicalJson(first))).toBe(seasonDigestHex(canonicalJson(second)));
  });

  it('compares a fully simulated paired season', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    const havocGames: HavocStoredGame[] = [];
    const normalGames: HavocStoredGame[] = [];
    for (let gameNumber = 1; gameNumber <= GAME_COUNT; gameNumber += 1) {
      for (const variant of ['havoc', 'normal'] as const) {
        const input = buildHavocGameInput({ locked, gameNumber, variant });
        const simulation = simulateHavocGame(input, context);
        const stored: HavocStoredGame = {
          gameNumber,
          result: simulation.result,
          resultDigest: havocGameResultDigest(simulation.result),
        };
        if (variant === 'havoc') havocGames.push(stored);
        else normalGames.push(stored);
      }
    }
    const comparison = compareHavocSeasons({
      runId: locked.runId,
      locked,
      havocGames,
      normalGames,
    });
    expect(comparison.games).toHaveLength(82);
    expect(comparison.slots).toHaveLength(5);
    expect(comparison.havoc).toEqual(havocSeasonTotalsOf(havocGames));
    expect(comparison.normal).toEqual(havocSeasonTotalsOf(normalGames));
    expect(comparison.havoc.wins + comparison.havoc.losses).toBe(82);
    expect(comparison.normal.wins + comparison.normal.losses).toBe(82);
    expect(comparison.winsGained).toBe(comparison.havoc.wins - comparison.normal.wins);
    expect(Number.isInteger(comparison.mvp.gain)).toBe(true);
    expect(comparison.mvpIndexWeights).toEqual({ ...HAVOC_MVP_INDEX_WEIGHTS });
    expect(comparison.games.every((game) => game.havoc.resultDigest.length === 32)).toBe(true);
  }, 45000);
});
