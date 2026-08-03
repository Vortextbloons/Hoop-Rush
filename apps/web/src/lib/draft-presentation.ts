import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';

/**
 * Shared draft presentation policy (spec/01 Classic mode): pool sorting,
 * rating badges, and pool labels for the sandbox draft and the Classic
 * Ratings / Ball Knowledge variants. Pure functions only — no Svelte, no
 * DOM — unit-testable in node.
 */

export type DraftPresentation = 'sandbox' | 'ratings' | 'ball-knowledge';

export type RatingBadgeLabel = 'O' | 'OFF' | 'DEF';

export interface RatingBadge {
  label: RatingBadgeLabel;
  value: number;
}

/** Overall-first ordering with name tie-break; the sandbox pool order. */
function compareOverallDesc(a: PlayersIndexEntry, b: PlayersIndexEntry): number {
  return b.overall - a.overall || a.displayName.localeCompare(b.displayName);
}

/**
 * Ball Knowledge pool order: alphabetical by normalized display name, then
 * deterministic identity tie-breakers so equal names never fall back to
 * unstable array order.
 */
function compareNameAsc(a: PlayersIndexEntry, b: PlayersIndexEntry): number {
  return (
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName) ||
    a.playerId.localeCompare(b.playerId)
  );
}

/** Sorts a copy of the rows for the given presentation. Never mutates input. */
export function sortDraftRows(
  rows: PlayersIndexEntry[],
  presentation: DraftPresentation,
): PlayersIndexEntry[] {
  const compare = presentation === 'ball-knowledge' ? compareNameAsc : compareOverallDesc;
  return [...rows].sort(compare);
}

/**
 * Rating badges shown beside a player. Ball Knowledge hides Overall only;
 * every other badge is identical across presentations.
 */
export function ratingBadges(
  player: PlayersIndexEntry,
  presentation: DraftPresentation,
): RatingBadge[] {
  if (presentation === 'ball-knowledge') {
    return [
      { label: 'OFF', value: player.offense },
      { label: 'DEF', value: player.defense },
    ];
  }
  return [
    { label: 'O', value: player.overall },
    { label: 'OFF', value: player.offense },
    { label: 'DEF', value: player.defense },
  ];
}

/** Pool subtitle describing the sort, e.g. "181 players · sorted by OVER". */
export function poolSortLabel(presentation: DraftPresentation): string {
  return presentation === 'ball-knowledge' ? 'sorted by NAME' : 'sorted by OVER';
}

/** Display name of a Classic information variant. */
export function variantLabel(variant: 'ratings' | 'ball-knowledge'): string {
  return variant === 'ratings' ? 'Ratings' : 'Ball Knowledge';
}

/** Maps a Classic variant id to its draft presentation. */
export function presentationForVariant(variant: 'ratings' | 'ball-knowledge'): DraftPresentation {
  return variant === 'ratings' ? 'ratings' : 'ball-knowledge';
}
