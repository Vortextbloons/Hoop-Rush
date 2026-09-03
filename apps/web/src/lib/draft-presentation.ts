import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
export type DraftPresentation = 'sandbox' | 'ratings' | 'ball-knowledge';
export type RatingBadgeLabel = 'O';
export interface RatingBadge {
  label: RatingBadgeLabel;
  value: number;
}
function compareOverallDesc(a: PlayersIndexEntry, b: PlayersIndexEntry): number {
  return b.overall - a.overall || a.displayName.localeCompare(b.displayName);
}
function compareNameAsc(a: PlayersIndexEntry, b: PlayersIndexEntry): number {
  return (
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) ||
    a.lastName.localeCompare(b.lastName) ||
    a.firstName.localeCompare(b.firstName) ||
    a.playerId.localeCompare(b.playerId)
  );
}
export function sortDraftRows(
  rows: PlayersIndexEntry[],
  presentation: DraftPresentation,
): PlayersIndexEntry[] {
  const compare = presentation === 'ball-knowledge' ? compareNameAsc : compareOverallDesc;
  return [...rows].sort(compare);
}
export function ratingBadges(
  player: PlayersIndexEntry,
  presentation: DraftPresentation,
): RatingBadge[] {
  if (presentation === 'ball-knowledge') return [];
  return [{ label: 'O', value: player.overall }];
}
export function poolSortLabel(presentation: DraftPresentation): string {
  return presentation === 'ball-knowledge' ? 'sorted by NAME' : 'sorted by OVER';
}
export function variantLabel(variant: 'ratings' | 'ball-knowledge'): string {
  return variant === 'ratings' ? 'Ratings' : 'Ball Knowledge';
}
export function presentationForVariant(variant: 'ratings' | 'ball-knowledge'): DraftPresentation {
  return variant === 'ratings' ? 'ratings' : 'ball-knowledge';
}
