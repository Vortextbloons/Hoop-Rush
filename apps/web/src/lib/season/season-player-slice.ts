import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';

export type SeasonRunPlayerSlice = ReadonlyMap<string, SeasonRunPlayerSliceEntry>;

export function playerSliceOf(
  entries: readonly SeasonRunPlayerSliceEntry[] | null | undefined,
): SeasonRunPlayerSlice {
  if (entries === null || entries === undefined) return EMPTY_SLICE;
  const map = new Map<string, SeasonRunPlayerSliceEntry>();
  for (const entry of entries) map.set(entry.playerVersionId, entry);
  return map;
}

export function sliceEntryOf(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): SeasonRunPlayerSliceEntry | null {
  return slice === null || slice === undefined ? null : (slice.get(playerVersionId) ?? null);
}

export function playablePositionsOfSlice(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): readonly string[] {
  return sliceEntryOf(slice, playerVersionId)?.positionsPlayable ?? [];
}

export function summaryRatingsOfSlice(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): { overallRating: number; offenseRating: number; defenseRating: number } | null {
  return sliceEntryOf(slice, playerVersionId)?.summaryRatings ?? null;
}

export function overallRatingOfSlice(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): number | null {
  return sliceEntryOf(slice, playerVersionId)?.summaryRatings.overallRating ?? null;
}

export function staminaRatingOfSlice(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): number | null {
  return sliceEntryOf(slice, playerVersionId)?.staminaRating ?? null;
}

export function durabilityRatingOfSlice(
  slice: SeasonRunPlayerSlice | null | undefined,
  playerVersionId: string,
): number | null {
  return sliceEntryOf(slice, playerVersionId)?.durabilityRating ?? null;
}

const EMPTY_SLICE: SeasonRunPlayerSlice = new Map();
