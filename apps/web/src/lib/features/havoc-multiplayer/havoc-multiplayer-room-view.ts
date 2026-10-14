import type {
  HavocMultiplayerDraftPick,
  HavocMultiplayerParticipantId,
  HavocMultiplayerPhase,
  HavocMultiplayerSeriesGame,
  HavocMultiplayerSeriesSnapshot,
  Position,
} from '@hoop-rush/data-contracts';
import type { HavocLineupSlotView } from '@hoop-rush/application/havoc';
import type { HavocMultiplayerSeriesMvp } from '@hoop-rush/persistence';
import type {
  GamecastSeries,
  GamecastSeriesGame,
} from '#lib/features/multiplayer/gamecast/gamecast-types.js';

/**
 * Pure view helpers for the Havoc multiplayer room: phase labels/steps, the series tracker
 * adapter, per-game rows, verification lookup, and MVP pick resolution.
 */

export const HAVOC_MULTIPLAYER_STAGE_LABELS = ['Lobby', 'Draft', 'Series', 'Champion'] as const;
export type HavocMultiplayerStageLabel = (typeof HAVOC_MULTIPLAYER_STAGE_LABELS)[number];

export function havocMultiplayerPhaseLabel(phase: HavocMultiplayerPhase): string {
  switch (phase) {
    case 'lobby':
      return 'Lobby';
    case 'drafting':
      return 'Draft';
    case 'lineup-showdown':
      return 'Lineups';
    case 'preparing-game':
      return 'Ready check';
    case 'broadcasting':
      return 'Broadcast';
    case 'game-results':
      return 'Game results';
    case 'championship':
      return 'Champion';
    case 'expired':
      return 'Room expired';
    case 'integrity-failed':
      return 'Result mismatch';
    default:
      return 'Room';
  }
}

export function havocMultiplayerStageIndex(phase: HavocMultiplayerPhase): number {
  if (phase === 'lobby') return 0;
  if (phase === 'drafting' || phase === 'lineup-showdown') return 1;
  if (phase === 'championship') return 3;
  return 2;
}

export type HavocMultiplayerVerificationTone = 'pending' | 'verified' | 'mismatch';

export function havocMultiplayerVerificationOf(
  entries: readonly { gameNumber: number; status: 'verified' | 'mismatch' }[],
  gameNumber: number | null,
): HavocMultiplayerVerificationTone {
  if (gameNumber === null) return 'pending';
  return entries.find((entry) => entry.gameNumber === gameNumber)?.status ?? 'pending';
}

export function havocMultiplayerSecondsLeft(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.max(0, Math.ceil(ms / 1000));
}

export function havocMultiplayerCurrentGameNumber(
  series: HavocMultiplayerSeriesSnapshot | null,
): number | null {
  return series?.games.find((game) => game.status !== 'verified')?.gameNumber ?? null;
}

/** Lineup card view for the multiplayer draft picks (which carry `turnOrdinal`, not `pickOrdinal`). */
export function havocMultiplayerLineupSlots(
  picks: readonly HavocMultiplayerDraftPick[],
): HavocLineupSlotView[] {
  return picks.map((pick) => ({
    slot: pick.slot,
    displayName: pick.card.source.displayName,
    nickname: pick.card.nickname,
    playerVersionId: pick.card.source.playerVersionId,
    playerId: pick.card.source.playerId,
    franchiseId: pick.card.source.franchiseId,
    seasonKey: pick.card.source.seasonKey,
    tier: pick.card.tier,
    overall: pick.card.source.originalOverall,
    mutations: pick.card.mutations,
  }));
}

export function havocMultiplayerLocalSide(
  series: HavocMultiplayerSeriesSnapshot | null,
  gameNumber: number,
  localParticipantId: HavocMultiplayerParticipantId,
): 'home' | 'away' {
  const game = series?.games.find((entry) => entry.gameNumber === gameNumber);
  if (!game) return 'home';
  return game.homeParticipantId === localParticipantId ? 'home' : 'away';
}

/**
 * Adapter for `GamecastSeriesTracker` with `homeFormat="best-of-2-2-1-1-1"`. The tracker only
 * needs decided games; undecided havoc games carry a null winner.
 */
export function havocMultiplayerGamecastSeries(
  series: HavocMultiplayerSeriesSnapshot | null,
): GamecastSeries | null {
  if (!series) return null;
  const games: GamecastSeriesGame[] = [];
  for (const game of series.games) {
    if (game.winner === null) continue;
    games.push({
      gameNumber: game.gameNumber,
      homeParticipantId: game.homeParticipantId,
      awayParticipantId: game.awayParticipantId,
      winner: game.winner,
    });
  }
  return {
    games,
    p1Wins: series.wins.p1,
    p2Wins: series.wins.p2,
    currentGameNumber: havocMultiplayerCurrentGameNumber(series),
    champion: series.champion,
    homeWinner: series.games[0]?.homeParticipantId ?? null,
  };
}

export interface HavocMultiplayerSeriesRow {
  gameNumber: number;
  homeParticipantId: HavocMultiplayerParticipantId;
  awayParticipantId: HavocMultiplayerParticipantId;
  winner: HavocMultiplayerParticipantId | null;
  status: HavocMultiplayerSeriesGame['status'];
  homeScore: number | null;
  awayScore: number | null;
  localIsHome: boolean;
  localWon: boolean | null;
}

export function havocMultiplayerSeriesRows(
  series: HavocMultiplayerSeriesSnapshot | null,
  outputs: Readonly<Record<number, HavocMultiplayerSeriesOutput>>,
  localParticipantId: HavocMultiplayerParticipantId,
): HavocMultiplayerSeriesRow[] {
  if (!series) return [];
  return series.games.map((game) => {
    const output = outputs[game.gameNumber];
    return {
      gameNumber: game.gameNumber,
      homeParticipantId: game.homeParticipantId,
      awayParticipantId: game.awayParticipantId,
      winner: game.winner,
      status: game.status,
      homeScore: output?.result.home.points ?? null,
      awayScore: output?.result.away.points ?? null,
      localIsHome: game.homeParticipantId === localParticipantId,
      localWon: game.winner === null ? null : game.winner === localParticipantId,
    };
  });
}

/** Structural subset of a stored game output needed for series rows. */
export interface HavocMultiplayerSeriesOutput {
  result: {
    home: { points: number };
    away: { points: number };
  };
}

/** Structural subset of a draft pick needed to resolve an MVP. */
export interface HavocMultiplayerMvpPickSource {
  participantId: HavocMultiplayerParticipantId;
  slot: Position;
}

export function havocMultiplayerMvpPick<T extends HavocMultiplayerMvpPickSource>(
  picks: readonly T[],
  mvp: HavocMultiplayerSeriesMvp | null,
): T | null {
  if (!mvp) return null;
  return (
    picks.find((pick) => pick.participantId === mvp.participantId && pick.slot === mvp.slot) ?? null
  );
}
