import type {
  PlayersIndexEntry,
  PlayerSeasonStats,
  RosterDetailsEntry,
} from '@hoop-rush/data-contracts';
import { oneDecimal, percentOneDecimal } from './format';

/**
 * Pure presentation helpers for the Roster browser: filtering, sorting, and
 * grouping of the global players index. No DOM, no Svelte — unit-testable.
 */

/**
 * Roster-browser row: a draft-index entry joined with its roster-details
 * (season stats and physical profile). The Roster screen builds these by
 * joining the two assets; draft screens use `PlayersIndexEntry` only.
 */
export type RosterDetailRow = PlayersIndexEntry & RosterDetailsEntry;

export type RosterListItem<T = RosterDetailRow> =
  | { type: 'group'; franchiseId: string; eraId: string; count: number }
  | { type: 'player'; player: T };

export interface RosterColumn {
  key: string;
  label: string;
  sort?: RosterSortId;
  numeric?: boolean;
  /** Hide column below this breakpoint (table only). */
  hideBelow?: 'md' | 'lg';
}

export type RosterSortId =
  | 'none'
  | 'name'
  | 'overall'
  | 'offense'
  | 'defense'
  | 'points'
  | 'per'
  | 'season'
  | 'team'
  | 'decade'
  | 'position';

export type RosterSortDirection = 'asc' | 'desc';

/** Default direction per sort mode; numeric ratings/stat modes favor best-first. */
export function defaultDirection(sortId: RosterSortId): RosterSortDirection {
  switch (sortId) {
    case 'overall':
    case 'offense':
    case 'defense':
    case 'points':
    case 'per':
    case 'season':
      return 'desc';
    default:
      return 'asc';
  }
}

export interface RosterFilters {
  franchiseId: string | null;
  eraId: string | null;
  /** Detailed position union member ('PG' | 'SG' | 'SF' | 'PF' | 'C'). */
  position: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  query: string;
}

const POSITION_ORDER: Readonly<Record<string, number>> = {
  PG: 0,
  SG: 1,
  SF: 2,
  PF: 3,
  C: 4,
};

const lowercaseNameCache = new WeakMap<PlayersIndexEntry, string>();

/** Case-folded display name, memoized per row object (the index is immutable). */
export function lowercaseName(row: PlayersIndexEntry): string {
  let folded = lowercaseNameCache.get(row);
  if (folded === undefined) {
    folded = row.displayName.toLowerCase();
    lowercaseNameCache.set(row, folded);
  }
  return folded;
}

function seasonStartYear(seasonKey: string): number {
  return Number.parseInt(seasonKey, 10);
}

function compareName(a: PlayersIndexEntry, b: PlayersIndexEntry): number {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || 0;
}

function compareBy<T>(
  rows: RosterDetailRow[],
  value: (row: RosterDetailRow) => T,
  direction: RosterSortDirection,
  compare: (a: T, b: T) => number,
): RosterDetailRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = sign * compare(value(a), value(b));
    return primary !== 0 ? primary : compareName(a, b);
  });
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b);
}

export function sortRoster(
  rows: RosterDetailRow[],
  sortId: RosterSortId,
  direction: RosterSortDirection,
): RosterDetailRow[] {
  switch (sortId) {
    case 'none':
      return [...rows];
    case 'name':
      return [...rows].sort(compareName);
    case 'overall':
      return compareBy(rows, (r) => r.overall, direction, compareNumber);
    case 'offense':
      return compareBy(rows, (r) => r.offense, direction, compareNumber);
    case 'defense':
      return compareBy(rows, (r) => r.defense, direction, compareNumber);
    case 'points':
      return compareBy(rows, (r) => perGame(r.stats, 'points'), direction, compareNumber);
    case 'per':
      return compareBy(rows, (r) => r.stats.per ?? -Infinity, direction, compareNumber);
    case 'season':
      return compareBy(rows, (r) => seasonStartYear(r.seasonKey), direction, compareNumber);
    case 'team':
      return compareBy(rows, (r) => r.franchiseId, direction, compareText);
    case 'decade':
      return compareBy(rows, (r) => r.eraId, direction, compareText);
    case 'position':
      return compareBy(
        rows,
        (r) => POSITION_ORDER[r.positionsPlayable[0] ?? ''] ?? 99,
        direction,
        compareNumber,
      );
  }
}

export function filterRoster(rows: RosterDetailRow[], filters: RosterFilters): RosterDetailRow[] {
  const franchiseId = filters.franchiseId;
  const eraId = filters.eraId;
  const position = filters.position;
  const query = filters.query.trim().toLowerCase();
  if (!franchiseId && !eraId && !position && !query) return rows;
  return rows.filter(
    (row) =>
      (!franchiseId || row.franchiseId === franchiseId) &&
      (!eraId || row.eraId === eraId) &&
      (!position || row.positionsPlayable.includes(position)) &&
      (!query || lowercaseName(row).includes(query)),
  );
}

export interface RosterGroup {
  franchiseId: string;
  eraId: string;
  players: RosterDetailRow[];
}

export function groupRoster(rows: RosterDetailRow[]): RosterGroup[] {
  const groups: RosterGroup[] = [];
  const byKey = new Map<string, RosterGroup>();
  for (const row of rows) {
    const key = `${row.franchiseId}/${row.eraId}`;
    let group = byKey.get(key);
    if (!group) {
      group = { franchiseId: row.franchiseId, eraId: row.eraId, players: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.players.push(row);
  }
  return groups;
}

/**
 * Paginates a flat item list (players plus optional group headers) so that
 * exactly `count` player rows are included; group headers leading into the
 * page are kept.
 */
export function paginateItems<T extends { type: string }>(items: T[], count: number): T[] {
  let players = 0;
  const page: T[] = [];
  for (const item of items) {
    if (item.type === 'player') players += 1;
    page.push(item);
    if (players >= count) break;
  }
  return page;
}

/**
 * Paginates grouped roster rows in a single pass, emitting a group header the
 * first time each franchise/era key appears and stopping once `count` player
 * rows are included. Output-identical to
 * `paginateItems(groupRoster(rows).flatMap(...), count)` for contiguously
 * grouped input (the players index order).
 */
export function paginateGroupedRows<T extends PlayersIndexEntry>(
  rows: T[],
  count: number,
): RosterListItem<T>[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.franchiseId}/${row.eraId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Set<string>();
  const page: RosterListItem<T>[] = [];
  let players = 0;
  for (const row of rows) {
    const key = `${row.franchiseId}/${row.eraId}`;
    if (!seen.has(key)) {
      seen.add(key);
      page.push({
        type: 'group',
        franchiseId: row.franchiseId,
        eraId: row.eraId,
        count: counts.get(key) ?? 0,
      });
      if (players >= count) break;
    }
    page.push({ type: 'player', player: row });
    players += 1;
    if (players >= count) break;
  }
  return page;
}

/** Per-game value of a counting stat, guarding against zero games. */
export function perGame(stats: PlayerSeasonStats, key: keyof PlayerSeasonStats): number {
  if (stats.gamesPlayed <= 0) return 0;
  const value = stats[key];
  if (typeof value !== 'number') return 0;
  return value / stats.gamesPlayed;
}

/** Made/attempted percentage 0-1, guarding against zero attempts. */
export function shotPct(made: number | null, attempted: number | null): number {
  if (made === null || attempted === null || attempted <= 0) return 0;
  return made / attempted;
}

export function formatPct(value: number): string {
  if (value === 0) return '0%';
  return percentOneDecimal(value);
}

export function formatPerGame(value: number): string {
  return oneDecimal(value);
}

export function formatDecimal(value: number): string {
  return oneDecimal(value);
}
