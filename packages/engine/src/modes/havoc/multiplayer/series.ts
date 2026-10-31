import type {
  HavocBattleResult,
  HavocMultiplayerParticipantId,
  HavocMultiplayerSeriesGame,
  HavocMultiplayerSeriesSnapshot,
  HavocStatLine,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  POSITIONS,
  canonicalJson,
  havocDigestSchema,
  havocMultiplayerSeriesSnapshotSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { havocProductionIndex } from '../comparison.ts';
import { addHavocStatLine, zeroHavocStatLine } from '../aggregate.ts';
import { havocMultiplayerByteDraw } from './seed-parity.ts';

const HOME_COURT_GAME_NUMBERS: readonly number[] = [1, 2, 5, 7];

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function isDecided(game: HavocMultiplayerSeriesGame): boolean {
  return game.status === 'proposed' || game.status === 'verified' || game.status === 'mismatch';
}

export function createHavocMultiplayerSeries(rootSeed: Seed): HavocMultiplayerSeriesSnapshot {
  const firstHome = havocMultiplayerByteDraw(rootSeed, 2);
  const games: HavocMultiplayerSeriesGame[] = [];
  for (let gameNumber = 1; gameNumber <= HAVOC_MULTIPLAYER_SERIES_GAMES; gameNumber += 1) {
    const homeParticipantId = HOME_COURT_GAME_NUMBERS.includes(gameNumber)
      ? firstHome
      : otherParticipant(firstHome);
    games.push({
      gameNumber,
      homeParticipantId,
      awayParticipantId: otherParticipant(homeParticipantId),
      status: 'scheduled',
      winner: null,
      inputDigest: null,
      resultDigest: null,
      tapeDigest: null,
    });
  }
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins: { p1: 0, p2: 0 },
    games,
    champion: null,
  });
}

export interface HavocMultiplayerRecordedDigests {
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly tapeDigest: string;
}

function recordedDigest(
  kind: 'input' | 'result' | 'tape',
  game: HavocMultiplayerSeriesGame,
  winner: HavocMultiplayerParticipantId,
): string {
  return havocDigestSchema.parse(
    seasonDigestHex(
      canonicalJson({
        digest: `havoc-multiplayer-series-${kind}-v1`,
        gameNumber: game.gameNumber,
        homeParticipantId: game.homeParticipantId,
        awayParticipantId: game.awayParticipantId,
        winner,
      }),
    ),
  );
}

export function recordHavocMultiplayerGame(
  series: HavocMultiplayerSeriesSnapshot,
  gameNumber: number,
  winner: HavocMultiplayerParticipantId,
  digests?: HavocMultiplayerRecordedDigests,
): HavocMultiplayerSeriesSnapshot {
  if (series.champion !== null) {
    throw new Error(
      `havoc multiplayer series is already decided for ${series.champion}; game ${String(gameNumber)} cannot be recorded`,
    );
  }
  const index = gameNumber - 1;
  const game = series.games[index];
  if (game === undefined) {
    throw new Error(`havoc multiplayer series has no game ${String(gameNumber)}`);
  }
  for (let earlier = 0; earlier < index; earlier += 1) {
    const entry = series.games[earlier];
    if (entry === undefined || entry.status !== 'verified') {
      throw new Error(
        `havoc multiplayer game ${String(gameNumber)} is not the next undecided game`,
      );
    }
  }
  if (isDecided(game)) {
    throw new Error(`havoc multiplayer game ${String(gameNumber)} is already decided`);
  }
  if (winner !== game.homeParticipantId && winner !== game.awayParticipantId) {
    throw new Error(
      `havoc multiplayer game ${String(gameNumber)} winner must be one of its participants`,
    );
  }
  const recorded: HavocMultiplayerSeriesGame = {
    ...game,
    status: 'verified',
    winner,
    inputDigest: havocDigestSchema.parse(
      digests?.inputDigest ?? recordedDigest('input', game, winner),
    ),
    resultDigest: havocDigestSchema.parse(
      digests?.resultDigest ?? recordedDigest('result', game, winner),
    ),
    tapeDigest: havocDigestSchema.parse(
      digests?.tapeDigest ?? recordedDigest('tape', game, winner),
    ),
  };
  const wins =
    winner === 'p1'
      ? { p1: series.wins.p1 + 1, p2: series.wins.p2 }
      : { p1: series.wins.p1, p2: series.wins.p2 + 1 };
  const champion =
    wins.p1 === HAVOC_MULTIPLAYER_SERIES_WINS
      ? 'p1'
      : wins.p2 === HAVOC_MULTIPLAYER_SERIES_WINS
        ? 'p2'
        : null;
  const games = series.games.map((entry, entryIndex) => (entryIndex === index ? recorded : entry));
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins,
    games: champion === null ? games : games.slice(0, index + 1),
    champion,
  });
}

export interface HavocMultiplayerSeriesMvpResult {
  readonly participantId: HavocMultiplayerParticipantId;
  readonly slot: Position;
  readonly index: number;
}

export function havocMultiplayerSeriesMvp(
  series: HavocMultiplayerSeriesSnapshot,
  results: readonly HavocBattleResult[],
): HavocMultiplayerSeriesMvpResult {
  const champion = series.champion;
  if (champion === null) {
    throw new Error('havoc multiplayer series MVP requires a decided champion');
  }
  const byNumber = new Map<number, HavocBattleResult>();
  for (const result of results) byNumber.set(result.gameNumber, result);
  const totals = new Map<Position, HavocStatLine>(
    POSITIONS.map((slot) => [slot, zeroHavocStatLine()]),
  );
  let verifiedGames = 0;
  for (const game of series.games) {
    if (game.status !== 'verified') continue;
    const result = byNumber.get(game.gameNumber);
    if (result === undefined) {
      throw new Error(`havoc multiplayer series MVP is missing game ${String(game.gameNumber)}`);
    }
    const team = game.homeParticipantId === champion ? result.home : result.away;
    for (const line of team.participants) {
      const total = totals.get(line.slot);
      if (total !== undefined) addHavocStatLine(total, line);
    }
    verifiedGames += 1;
  }
  if (verifiedGames === 0) {
    throw new Error('havoc multiplayer series MVP requires at least one verified game');
  }
  let best: { slot: Position; index: number } | null = null;
  for (const slot of POSITIONS) {
    const total = totals.get(slot);
    if (total === undefined) continue;
    const index = havocProductionIndex(total);
    if (best === null || index > best.index) best = { slot, index };
  }
  if (best === null) {
    throw new Error('havoc multiplayer series MVP found no drafted slots');
  }
  return { participantId: champion, slot: best.slot, index: best.index };
}
