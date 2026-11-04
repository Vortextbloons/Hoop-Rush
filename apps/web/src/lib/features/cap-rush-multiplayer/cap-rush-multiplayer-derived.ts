import type {
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerSeatId,
} from '@hoop-rush/data-contracts';
import { capRushMultiplayerSeatRecord, capRushMultiplayerStandings } from '@hoop-rush/engine';

type SeatRecord = ReturnType<typeof capRushMultiplayerSeatRecord>;
type Standings = ReturnType<typeof capRushMultiplayerStandings>;

export interface CapRushMultiplayerSeasonWindow {
  readonly throughSlot: number;
  readonly games: readonly CapRushLeagueGame[];
  readonly records: Readonly<Record<CapRushMultiplayerSeatId, SeatRecord>>;
  readonly standings: Standings | null;
}

export interface CapRushMultiplayerPlayerAverage {
  readonly games: number;
  readonly points: number;
  readonly rebounds: number;
  readonly assists: number;
}

const EMPTY_GAMES: readonly CapRushLeagueGame[] = [];
const windowCache = new WeakMap<
  readonly CapRushLeagueGame[],
  { locked: CapRushMultiplayerLockedInputs; window: CapRushMultiplayerSeasonWindow }
>();
const maxSlotCache = new WeakMap<readonly CapRushLeagueGame[], number>();
const averageCache = new WeakMap<
  readonly CapRushLeagueGame[],
  ReadonlyMap<string, CapRushMultiplayerPlayerAverage>
>();

function highestSlot(games: readonly CapRushLeagueGame[]): number {
  const cached = maxSlotCache.get(games);
  if (cached !== undefined) return cached;
  let highest = 0;
  for (const game of games) if (game.slot > highest) highest = game.slot;
  maxSlotCache.set(games, highest);
  return highest;
}

/**
 * A season window is derived only when the displayed slot changes, not on every tween frame.
 * Records and standings are shared by the season, progress, and seat views for the same window.
 */
export function capRushMultiplayerSeasonWindow(
  locked: CapRushMultiplayerLockedInputs,
  games: readonly CapRushLeagueGame[],
  throughSlot: number,
): CapRushMultiplayerSeasonWindow {
  const highest = highestSlot(games);
  const key = Math.max(0, Math.min(Math.floor(throughSlot), highest));
  const cached = windowCache.get(games);
  if (cached?.locked === locked && cached.window.throughSlot === key) return cached.window;
  const visible = key >= highest ? games : games.filter((game) => game.slot <= key);
  const records = {
    p1: capRushMultiplayerSeatRecord(locked, visible, 'p1'),
    p2: capRushMultiplayerSeatRecord(locked, visible, 'p2'),
  } as const;
  let standings: Standings | null = null;
  try {
    standings = capRushMultiplayerStandings(locked, visible);
  } catch {
    standings = null;
  }
  const window = { throughSlot: key, games: visible, records, standings };
  windowCache.set(games, { locked, window });
  return window;
}

/**
 * Player averages are shared across every roster rendered for the same season array. This keeps
 * the roster component from folding both participant arrays for each of the four seat views.
 */
export function capRushMultiplayerPlayerAverages(
  games: readonly CapRushLeagueGame[] | null | undefined,
): ReadonlyMap<string, CapRushMultiplayerPlayerAverage> {
  const source = games ?? EMPTY_GAMES;
  const cached = averageCache.get(source);
  if (cached !== undefined) return cached;
  const totals = new Map<string, CapRushMultiplayerPlayerAverage>();
  for (const game of source) {
    for (const side of [game.box.home, game.box.away] as const) {
      for (const line of side.participants) {
        const entry = totals.get(line.playerId);
        if (entry === undefined) {
          totals.set(line.playerId, {
            games: 1,
            points: line.points,
            rebounds: line.rebounds,
            assists: line.assists,
          });
          continue;
        }
        totals.set(line.playerId, {
          games: entry.games + 1,
          points: entry.points + line.points,
          rebounds: entry.rebounds + line.rebounds,
          assists: entry.assists + line.assists,
        });
      }
    }
  }
  averageCache.set(source, totals);
  return totals;
}
