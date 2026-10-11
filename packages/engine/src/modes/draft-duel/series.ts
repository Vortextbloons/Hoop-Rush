import type {
  DraftDuelCard,
  DraftDuelParticipantId,
  DraftDuelRoster,
  DraftDuelSeriesGame,
  DraftDuelSeriesMvp,
  DraftDuelSeriesSnapshot,
  DraftDuelStandout,
  GameResult,
  PlayerBoxScore,
  PlayerId,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { gameScore } from '../../challenge/mvp.ts';
import { catalogEntryForVersion, catalogSimulationForVersion } from './catalog.ts';
import type { DraftDuelCatalog } from './catalog.ts';
import { draftDuelHomeWinner } from './seeds.ts';

export interface DraftDuelPlayedGame {
  gameNumber: number;
  homeParticipantId: DraftDuelParticipantId;
  awayParticipantId: DraftDuelParticipantId;
  result: GameResult;
}

export interface DraftDuelSeriesRosters {
  p1: DraftDuelRoster;
  p2: DraftDuelRoster;
}

const HOME_PATTERN: readonly boolean[] = [true, true, false, false, true, false, true];

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export function createDraftDuelSeries(rootSeed: Seed): DraftDuelSeriesSnapshot {
  return {
    homeWinner: draftDuelHomeWinner(rootSeed),
    games: [],
    p1Wins: 0,
    p2Wins: 0,
    currentGameNumber: 1,
    champion: null,
  };
}

export function draftDuelHomeForGame(
  homeWinner: DraftDuelParticipantId,
  gameNumber: number,
): DraftDuelParticipantId {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 7) {
    throw new Error(`draft duel gameNumber must be an integer in 1..7 (got ${String(gameNumber)})`);
  }
  const homeIsWinner = HOME_PATTERN[gameNumber - 1] ?? false;
  return homeIsWinner ? homeWinner : otherParticipant(homeWinner);
}

export function applyDraftDuelGameResult(
  series: DraftDuelSeriesSnapshot,
  gameNumber: number,
  winner: DraftDuelParticipantId,
): DraftDuelSeriesSnapshot {
  const current = series.currentGameNumber;
  if (current === null || series.champion !== null) {
    throw new Error('draft duel series is already complete');
  }
  if (gameNumber !== current) {
    throw new Error(
      `draft duel game ${String(gameNumber)} is not the current game ${String(current)}`,
    );
  }
  const homeParticipantId = draftDuelHomeForGame(series.homeWinner, gameNumber);
  const awayParticipantId = otherParticipant(homeParticipantId);
  const game: DraftDuelSeriesGame = {
    gameNumber,
    homeParticipantId,
    awayParticipantId,
    winner,
  };
  const p1Wins = series.p1Wins + (winner === 'p1' ? 1 : 0);
  const p2Wins = series.p2Wins + (winner === 'p2' ? 1 : 0);
  const champion = p1Wins === 4 ? 'p1' : p2Wins === 4 ? 'p2' : null;
  return {
    ...series,
    games: [...series.games, game],
    p1Wins,
    p2Wins,
    champion,
    currentGameNumber: champion === null ? gameNumber + 1 : null,
  };
}

export function draftDuelSimulationTeam(
  catalog: DraftDuelCatalog,
  roster: DraftDuelRoster,
  participantId: DraftDuelParticipantId,
): SimulationTeam {
  if (roster.participantId !== participantId) {
    throw new Error(`draft duel roster belongs to ${roster.participantId}, not ${participantId}`);
  }
  if (roster.slots.length !== 5) {
    throw new Error(
      `draft duel ${participantId} roster must have 5 slots (got ${String(roster.slots.length)})`,
    );
  }
  const bySlot = new Map<number, DraftDuelCard>();
  for (const slot of roster.slots) {
    if (bySlot.has(slot.slotIndex)) {
      throw new Error(
        `draft duel ${participantId} roster has duplicate slot ${String(slot.slotIndex)}`,
      );
    }
    bySlot.set(slot.slotIndex, slot.card);
  }
  const players: SimulationTeam['players'] = [];
  for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
    const card = bySlot.get(slotIndex);
    if (!card) {
      throw new Error(`draft duel ${participantId} roster is missing slot ${String(slotIndex)}`);
    }
    players.push(catalogSimulationForVersion(catalog, card.playerVersionId));
  }
  return {
    teamId: `draft-duel-${participantId}`,
    displayName: `Draft Duel ${participantId.toUpperCase()}`,
    players,
  };
}

interface MvpAccumulator {
  playerId: PlayerId;
  points: number;
  rebounds: number;
  assists: number;
  gameScoreSum: number;
}

function compareMvpAccumulators(a: MvpAccumulator, b: MvpAccumulator): number {
  if (b.gameScoreSum !== a.gameScoreSum) return b.gameScoreSum - a.gameScoreSum;
  if (b.points !== a.points) return b.points - a.points;
  if (b.assists !== a.assists) return b.assists - a.assists;
  if (b.rebounds !== a.rebounds) return b.rebounds - a.rebounds;
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

export function draftDuelSeriesMvp(
  catalog: DraftDuelCatalog,
  rosters: DraftDuelSeriesRosters,
  games: readonly DraftDuelPlayedGame[],
  champion: DraftDuelParticipantId,
): DraftDuelSeriesMvp | null {
  if (games.length === 0) return null;
  const roster = rosters[champion];
  const cardByPlayerId = new Map<PlayerId, DraftDuelCard>();
  for (const slot of roster.slots) cardByPlayerId.set(slot.card.playerId, slot.card);
  const accumulators = new Map<PlayerId, MvpAccumulator>();
  for (const game of games) {
    const isHome = game.homeParticipantId === champion;
    const isAway = game.awayParticipantId === champion;
    if (!isHome && !isAway) continue;
    const side = isHome ? game.result.home : game.result.away;
    for (const box of side.players) {
      if (!cardByPlayerId.has(box.playerId)) continue;
      const current =
        accumulators.get(box.playerId) ??
        ({
          playerId: box.playerId,
          points: 0,
          rebounds: 0,
          assists: 0,
          gameScoreSum: 0,
        } satisfies MvpAccumulator);
      current.points += box.points;
      current.rebounds += box.rebounds.total;
      current.assists += box.assists;
      current.gameScoreSum += gameScore(box);
      accumulators.set(box.playerId, current);
    }
  }
  const ranked = [...accumulators.values()].sort(compareMvpAccumulators);
  const best = ranked[0];
  if (!best) return null;
  const card = cardByPlayerId.get(best.playerId);
  if (!card) return null;
  const entry = catalogEntryForVersion(catalog, card.playerVersionId);
  return {
    participantId: champion,
    playerId: card.playerId,
    playerVersionId: card.playerVersionId,
    displayName: entry.card.displayName,
    games: games.length,
    points: best.points,
    rebounds: best.rebounds,
    assists: best.assists,
    gameScoreSum: best.gameScoreSum,
  };
}

function compareStandoutBoxes(a: PlayerBoxScore, b: PlayerBoxScore): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.assists !== a.assists) return b.assists - a.assists;
  if (b.rebounds.total !== a.rebounds.total) return b.rebounds.total - a.rebounds.total;
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

export function draftDuelStandouts(
  catalog: DraftDuelCatalog,
  rosters: DraftDuelSeriesRosters,
  games: readonly DraftDuelPlayedGame[],
): DraftDuelStandout[] {
  const standouts: DraftDuelStandout[] = [];
  for (const game of games) {
    const sideName = game.result.winner;
    const winnerParticipant = sideName === 'home' ? game.homeParticipantId : game.awayParticipantId;
    const side = sideName === 'home' ? game.result.home : game.result.away;
    const roster = rosters[winnerParticipant];
    const cardByPlayerId = new Map<PlayerId, DraftDuelCard>();
    for (const slot of roster.slots) cardByPlayerId.set(slot.card.playerId, slot.card);
    let best: PlayerBoxScore | null = null;
    for (const box of side.players) {
      if (best === null || compareStandoutBoxes(box, best) < 0) best = box;
    }
    if (best === null) continue;
    const card = cardByPlayerId.get(best.playerId);
    let displayName = card?.displayName;
    if (displayName === undefined) {
      const entry = (catalog.byPlayerId.get(best.playerId) ?? [])[0];
      displayName = entry?.card.displayName ?? best.playerId;
    }
    standouts.push({
      participantId: winnerParticipant,
      playerId: best.playerId,
      displayName,
      gameNumber: game.gameNumber,
      points: best.points,
      rebounds: best.rebounds.total,
      assists: best.assists,
    });
  }
  return standouts;
}
