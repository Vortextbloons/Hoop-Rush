import type {
  PlayersIndexEntry,
  PlayerSeasonStats,
  RosterDetailsEntry,
} from '@hoop-rush/data-contracts';

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

/** One flat row of the roster browser: a group header or a player. */
export type RosterListItem =
  | { type: 'group'; franchiseId: string; eraId: string; count: number }
  | { type: 'player'; player: RosterDetailRow };

export interface RosterColumn {
  key: string;
  label: string;
  sort?: RosterSortId;
  numeric?: boolean;
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
  /** Canonical position union member ('G' | 'F' | 'C'). */
  position: 'G' | 'F' | 'C' | null;
  query: string;
}

const POSITION_ORDER: Readonly<Record<string, number>> = { G: 0, F: 1, C: 2 };

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

/** The year a season key starts in ("1990-91" -> 1990). */
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

/** Applies the sort mode to a copy of the rows. 'none' preserves dataset order. */
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
        (r) => POSITION_ORDER[r.positionsCanonical[0] ?? ''] ?? 99,
        direction,
        compareNumber,
      );
  }
}

/** Applies franchise, decade, position, and name-query filters. */
export function filterRoster(rows: RosterDetailRow[], filters: RosterFilters): RosterDetailRow[] {
  let list = rows;
  if (filters.franchiseId) list = list.filter((r) => r.franchiseId === filters.franchiseId);
  if (filters.eraId) list = list.filter((r) => r.eraId === filters.eraId);
  const position = filters.position;
  if (position) list = list.filter((r) => r.positionsCanonical.includes(position));
  const query = filters.query.trim().toLowerCase();
  if (query) {
    list = list.filter((r) => lowercaseName(r).includes(query));
  }
  return list;
}

/** One team/decade bucket in dataset order (used by the 'none' organization). */
export interface RosterGroup {
  franchiseId: string;
  eraId: string;
  players: RosterDetailRow[];
}

/** Groups rows by franchise then era, preserving dataset order. */
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

/** Formats a 0-1 ratio as a percentage string with one decimal. */
export function formatPct(value: number): string {
  if (value === 0) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

/** Formats a per-game value with one decimal. */
export function formatPerGame(value: number): string {
  return value.toFixed(1);
}

/** Formats a rating or advanced stat with one decimal. */
export function formatDecimal(value: number): string {
  return value.toFixed(1);
}
