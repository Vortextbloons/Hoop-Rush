import { describe, expect, it } from 'vitest';
import type {
  HavocBattleResult,
  HavocMultiplayerDraftState,
  HavocMultiplayerParticipantId,
  HavocMultiplayerSeriesGame,
  HavocMultiplayerSeriesSnapshot,
  HavocParticipantLine,
  HavocStatLine,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  canonicalJson,
  havocBattleResultSchema,
  havocMultiplayerSeriesSnapshotSchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildHavocParticipantLine, buildHavocVersionSet } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../../sim/kernel.ts';
import { auditHavocBattleGame } from '../core/battle-audit.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from '../core/battle-digests.ts';
import { simulateHavocBattleGame } from '../core/battle-game.ts';
import {
  HAVOC_TEST_RUN_SEED,
  buildHavocCatalogFixture,
  buildHavocEnvironmentFixture,
  buildHavocEraProfileFixture,
} from '../havoc-test-support.ts';
import type { HavocMultiplayerDraftCommandPayload } from './draft.ts';
import {
  applyHavocMultiplayerDraftCommand,
  buildHavocMultiplayerGameInput,
  buildHavocMultiplayerTeam,
  createHavocMultiplayerDraft,
  defaultHavocMultiplayerDraftSettings,
} from './draft.ts';
import {
  createHavocMultiplayerSeries,
  havocMultiplayerSeriesMvp,
  recordHavocMultiplayerGame,
} from './series.ts';

const CHAMPION_PATTERNS: Readonly<Record<string, readonly ('champion' | 'opponent')[]>> = {
  '4-0': ['champion', 'champion', 'champion', 'champion'],
  '4-1': ['champion', 'champion', 'champion', 'opponent', 'champion'],
  '4-2': ['champion', 'champion', 'opponent', 'champion', 'opponent', 'champion'],
  '4-3': ['champion', 'opponent', 'champion', 'opponent', 'champion', 'opponent', 'champion'],
};

function testSeed(value: string): Seed {
  return seedSchema.parse(seedFromString(value));
}

function firstCardPayload(state: HavocMultiplayerDraftState): HavocMultiplayerDraftCommandPayload {
  const offer = state.offer;
  if (offer === null) throw new Error('draft has no offer');
  const card = offer.cards[0];
  if (card === undefined) throw new Error('offer has no cards');
  if (card.source.seasonKey === null) throw new Error('offer card has no season');
  return {
    kind: 'pick',
    turnOrdinal: state.turnOrdinal,
    offerId: offer.offerId,
    cardId: card.cardId,
    claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey },
  };
}

function playFullDraft(
  rootSeed: Seed,
  catalog: ReturnType<typeof buildHavocCatalogFixture>['adapted'],
  environment: ReturnType<typeof buildHavocEnvironmentFixture>,
): HavocMultiplayerDraftState {
  const settings = defaultHavocMultiplayerDraftSettings();
  let state = createHavocMultiplayerDraft(rootSeed, catalog, environment, settings);
  while (state.status === 'drafting') {
    const outcome = applyHavocMultiplayerDraftCommand(
      state,
      firstCardPayload(state),
      catalog,
      environment,
      settings,
    );
    expect(outcome.receipt.accepted).toBe(true);
    state = outcome.state;
  }
  return state;
}

function recordSeries(
  series: HavocMultiplayerSeriesSnapshot,
  champion: HavocMultiplayerParticipantId,
  pattern: readonly ('champion' | 'opponent')[],
): HavocMultiplayerSeriesSnapshot {
  let current = series;
  pattern.forEach((outcome, index) => {
    const gameNumber = index + 1;
    const game = current.games[gameNumber - 1];
    if (game === undefined) throw new Error(`series has no game ${String(gameNumber)}`);
    const winner =
      outcome === 'champion'
        ? champion
        : game.homeParticipantId === champion
          ? game.awayParticipantId
          : game.homeParticipantId;
    current = recordHavocMultiplayerGame(current, gameNumber, winner);
  });
  return current;
}

function instanceIdAt(index: number): string {
  return `hvi-${(index + 1).toString(16).padStart(32, '0')}`;
}

function zeroLine(overrides: Partial<HavocStatLine>): Partial<HavocStatLine> {
  return {
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    ...overrides,
  };
}

function championLines(
  perSlot: Partial<Record<Position, Partial<HavocStatLine>>>,
): HavocParticipantLine[] {
  return POSITIONS.map((slot, index) =>
    buildHavocParticipantLine({
      instanceId: instanceIdAt(index),
      kind: 'starter',
      slot,
      ownerInstanceId: null,
      ...zeroLine(perSlot[slot] ?? {}),
    }),
  );
}

function combinedSgLines(): HavocParticipantLine[] {
  const base = championLines({});
  const pg = base[0];
  const sf = base[2];
  const pf = base[3];
  const c = base[4];
  if (pg === undefined || sf === undefined || pf === undefined || c === undefined) {
    throw new Error('missing base slot lines');
  }
  const starter = buildHavocParticipantLine({
    instanceId: instanceIdAt(1),
    kind: 'starter',
    slot: 'SG',
    ownerInstanceId: null,
    ...zeroLine({ points: 10 }),
  });
  const replacement = buildHavocParticipantLine({
    instanceId: instanceIdAt(10),
    kind: 'replacement',
    slot: 'SG',
    ownerInstanceId: instanceIdAt(1),
    ...zeroLine({ points: 30 }),
  });
  const clone = buildHavocParticipantLine({
    instanceId: instanceIdAt(20),
    kind: 'clone',
    slot: 'SG',
    ownerInstanceId: instanceIdAt(1),
    ...zeroLine({ points: 20 }),
  });
  return [pg, starter, sf, pf, c, replacement, clone];
}

function opponentLines(): HavocParticipantLine[] {
  return POSITIONS.map((slot, index) =>
    buildHavocParticipantLine({
      instanceId: instanceIdAt(index + 30),
      kind: 'starter',
      slot,
      ownerInstanceId: null,
      ...zeroLine({ points: 5 }),
    }),
  );
}

function syntheticBattleResult(input: {
  readonly gameNumber: number;
  readonly homeLines: readonly HavocParticipantLine[];
  readonly awayLines: readonly HavocParticipantLine[];
}): HavocBattleResult {
  const team = (side: 'home' | 'away', lines: readonly HavocParticipantLine[], points: number) => ({
    side,
    teamId: `${side}-synthetic`,
    displayName: `${side} synthetic`,
    points,
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
    periods: [points, 0, 0, 0],
    courtSeconds: 2880,
    participants: [...lines],
  });
  return havocBattleResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: input.gameNumber,
    variant: 'havoc',
    seed: seedSchema.parse(seedFromString(`havoc-mp-mvp-${String(input.gameNumber)}`)),
    engineVersion: 'test-engine',
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    profileVersion: 'test-profile',
    dataVersion: 'test-data',
    home: team('home', input.homeLines, 100),
    away: team('away', input.awayLines, 90),
    winner: 'home',
    overtimePeriods: 0,
    inputDigest: '0'.repeat(32),
    rollups: [],
    highlights: [],
  });
}

function resultsForSeries(
  series: HavocMultiplayerSeriesSnapshot,
  champion: HavocMultiplayerParticipantId,
  lines: readonly HavocParticipantLine[],
): HavocBattleResult[] {
  return series.games.map((game: HavocMultiplayerSeriesGame) => {
    const championHome = game.homeParticipantId === champion;
    return syntheticBattleResult({
      gameNumber: game.gameNumber,
      homeLines: championHome ? lines : opponentLines(),
      awayLines: championHome ? opponentLines() : lines,
    });
  });
}

describe('havoc multiplayer series', () => {
  it('draws the 2-2-1-1-1 home court pattern for both sides', () => {
    for (const firstHome of ['p1', 'p2'] as const) {
      let seed: Seed | null = null;
      for (let index = 0; index < 200 && seed === null; index += 1) {
        const candidate = testSeed(`havoc-mp-home-${String(index)}`);
        const series = createHavocMultiplayerSeries(candidate);
        if (series.games[0]?.homeParticipantId === firstHome) seed = candidate;
      }
      expect(seed).not.toBeNull();
      if (seed === null) continue;
      const series = createHavocMultiplayerSeries(seed);
      expect(series.games).toHaveLength(7);
      expect(series.wins).toEqual({ p1: 0, p2: 0 });
      expect(series.champion).toBeNull();
      expect(havocMultiplayerSeriesSnapshotSchema.safeParse(series).success).toBe(true);
      series.games.forEach((game, index) => {
        const gameNumber = index + 1;
        const expectedHome = [1, 2, 5, 7].includes(gameNumber)
          ? firstHome
          : firstHome === 'p1'
            ? 'p2'
            : 'p1';
        expect(game.gameNumber).toBe(gameNumber);
        expect(game.homeParticipantId).toBe(expectedHome);
        expect(game.awayParticipantId).not.toBe(expectedHome);
        expect(game.status).toBe('scheduled');
        expect(game.winner).toBeNull();
        expect(game.inputDigest).toBeNull();
        expect(game.resultDigest).toBeNull();
        expect(game.tapeDigest).toBeNull();
      });
    }
  });

  it('records every series ending from 4-0 through 4-3', () => {
    for (const champion of ['p1', 'p2'] as const) {
      for (const [ending, pattern] of Object.entries(CHAMPION_PATTERNS)) {
        let series = createHavocMultiplayerSeries(
          testSeed(`havoc-mp-ending-${ending}-${champion}`),
        );
        series = recordSeries(series, champion, pattern);
        expect(series.champion).toBe(champion);
        expect(series.wins[champion]).toBe(4);
        expect(series.games).toHaveLength(pattern.length);
        const clincher = series.games[pattern.length - 1];
        expect(clincher?.status).toBe('verified');
        expect(clincher?.winner).toBe(champion);
        expect(clincher?.inputDigest).toMatch(/^[0-9a-f]{32}$/);
        expect(havocMultiplayerSeriesSnapshotSchema.safeParse(series).success).toBe(true);
        expect(() => recordHavocMultiplayerGame(series, pattern.length + 1, champion)).toThrow(
          /already decided/,
        );
      }
    }
  });

  it('rejects out-of-order records and keeps synthesized digests deterministic', () => {
    const series = createHavocMultiplayerSeries(testSeed('havoc-mp-order'));
    const firstGame = series.games[0];
    if (firstGame === undefined) throw new Error('series has no games');
    expect(() => recordHavocMultiplayerGame(series, 2, 'p1')).toThrow(/next undecided/);

    const recorded = recordHavocMultiplayerGame(series, 1, firstGame.homeParticipantId);
    const recordedAgain = recordHavocMultiplayerGame(series, 1, firstGame.homeParticipantId);
    expect(canonicalJson(recorded)).toBe(canonicalJson(recordedAgain));
    expect(recorded.games[0]?.status).toBe('verified');
    expect(recorded.games[0]?.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(() => recordHavocMultiplayerGame(recorded, 1, 'p1')).toThrow(/already decided/);

    const supplied = recordHavocMultiplayerGame(series, 1, firstGame.homeParticipantId, {
      inputDigest: 'a'.repeat(32),
      resultDigest: 'b'.repeat(32),
      tapeDigest: 'c'.repeat(32),
    });
    expect(supplied.games[0]?.inputDigest).toBe('a'.repeat(32));
    expect(supplied.games[0]?.resultDigest).toBe('b'.repeat(32));
    expect(supplied.games[0]?.tapeDigest).toBe('c'.repeat(32));
  });

  it('scores the champion MVP from combined slot contributions with slot-order ties', () => {
    const champion: HavocMultiplayerParticipantId = 'p1';
    const series = recordSeries(
      createHavocMultiplayerSeries(testSeed('havoc-mp-mvp-combined')),
      champion,
      CHAMPION_PATTERNS['4-3'] ?? [],
    );
    expect(series.games).toHaveLength(7);
    const mvp = havocMultiplayerSeriesMvp(
      series,
      resultsForSeries(series, champion, combinedSgLines()),
    );
    expect(mvp.participantId).toBe(champion);
    expect(mvp.slot).toBe('SG');
    expect(mvp.index).toBe(7 * 600);

    const tied = recordSeries(
      createHavocMultiplayerSeries(testSeed('havoc-mp-mvp-ties')),
      champion,
      CHAMPION_PATTERNS['4-0'] ?? [],
    );
    const tiedMvp = havocMultiplayerSeriesMvp(
      tied,
      resultsForSeries(
        tied,
        champion,
        championLines({
          PG: { points: 10 },
          SG: { points: 10 },
          SF: { points: 10 },
          PF: { points: 10 },
          C: { points: 10 },
        }),
      ),
    );
    expect(tiedMvp.slot).toBe('PG');
    expect(tiedMvp.index).toBe(4 * 100);
  });

  it('runs the full draft, series, and MVP integration deterministically', () => {
    const fixture = buildHavocCatalogFixture();
    const environment = buildHavocEnvironmentFixture(fixture.adapted);
    const rootSeed = HAVOC_TEST_RUN_SEED;
    const draft = playFullDraft(rootSeed, fixture.adapted, environment);
    expect(draft.status).toBe('complete');
    expect(draft.picks).toHaveLength(10);

    const profile = buildHavocEraProfileFixture();
    const versionSet = buildHavocVersionSet();
    const p1 = buildHavocMultiplayerTeam({
      participantId: 'p1',
      side: 'home',
      teamId: 'havoc-mp-p1',
      displayName: 'Player One',
      picks: draft.picks,
      rootSeed,
    });
    const p2 = buildHavocMultiplayerTeam({
      participantId: 'p2',
      side: 'away',
      teamId: 'havoc-mp-p2',
      displayName: 'Player Two',
      picks: draft.picks,
      rootSeed,
    });

    let series = createHavocMultiplayerSeries(rootSeed);
    const results: HavocBattleResult[] = [];
    const context = createEngineContext();
    while (series.champion === null) {
      const gameNumber = series.games.filter((game) => game.status === 'verified').length + 1;
      const game = series.games[gameNumber - 1];
      if (game === undefined) throw new Error(`series has no game ${String(gameNumber)}`);
      const homeTeam = game.homeParticipantId === 'p1' ? p1 : p2;
      const awayTeam = game.awayParticipantId === 'p1' ? p1 : p2;
      const input = buildHavocMultiplayerGameInput({
        rootSeed,
        gameNumber,
        homeTeam,
        awayTeam,
        profile,
        versionSet,
      });
      const first = simulateHavocBattleGame(input, context);
      if (gameNumber === 1) {
        const second = simulateHavocBattleGame(input, context);
        expect(havocBattleGameResultDigest(second.result)).toBe(
          havocBattleGameResultDigest(first.result),
        );
        expect(havocBattleGameTapeDigest(second.tape)).toBe(havocBattleGameTapeDigest(first.tape));
        const rebuilt = buildHavocMultiplayerGameInput({
          rootSeed,
          gameNumber,
          homeTeam,
          awayTeam,
          profile,
          versionSet,
        });
        expect(havocBattleGameInputDigest(rebuilt)).toBe(havocBattleGameInputDigest(input));
      }
      const audit = auditHavocBattleGame(input, first.result, first.tape);
      expect(audit.ok, audit.findings.map((finding) => finding.code).join(',')).toBe(true);
      const winner =
        first.result.winner === 'home' ? game.homeParticipantId : game.awayParticipantId;
      series = recordHavocMultiplayerGame(series, gameNumber, winner, {
        inputDigest: havocBattleGameInputDigest(input),
        resultDigest: havocBattleGameResultDigest(first.result),
        tapeDigest: havocBattleGameTapeDigest(first.tape),
      });
      results.push(first.result);
    }
    const champion = series.champion;
    expect(champion).not.toBeNull();
    expect(series.wins[champion]).toBe(4);
    expect(series.games.length).toBeGreaterThanOrEqual(4);
    expect(series.games.length).toBeLessThanOrEqual(7);
    expect(series.games[series.games.length - 1]?.winner).toBe(champion);
    expect(havocMultiplayerSeriesSnapshotSchema.safeParse(series).success).toBe(true);

    const mvp = havocMultiplayerSeriesMvp(series, results);
    expect(mvp.participantId).toBe(champion);
    expect(POSITIONS).toContain(mvp.slot);
    expect(Number.isFinite(mvp.index)).toBe(true);
  });
});
