import {
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_MULTIPLAYER_PLAYBACK_ACK_LIMIT,
  type CapRushMultiplayerArrayPatch,
  type CapRushMultiplayerSeasonPatch,
  type CapRushMultiplayerState,
  type CapRushMultiplayerStatePatch,
} from '@hoop-rush/data-contracts';

type SeasonState = NonNullable<CapRushMultiplayerState['season']>;
type SeasonFields = NonNullable<CapRushMultiplayerSeasonPatch['fields']>;
type StateFields = NonNullable<CapRushMultiplayerStatePatch['fields']>;

function arrayPatch<T>(
  base: readonly T[],
  next: readonly T[],
): CapRushMultiplayerArrayPatch<T> | undefined {
  if (base === next) return undefined;
  let common = 0;
  while (common < base.length && common < next.length && base[common] === next[common]) common += 1;
  if (common === base.length) {
    if (next.length === base.length) return undefined;
    return { mode: 'append', values: next.slice(base.length) };
  }
  return { mode: 'replace', values: [...next] };
}

function seasonPatch(
  base: SeasonState,
  next: SeasonState,
): CapRushMultiplayerSeasonPatch | undefined {
  const fields: SeasonFields = {};
  for (const key of Object.keys(next) as (keyof SeasonState)[]) {
    if (key !== 'games' && key !== 'playbackAcks' && base[key] !== next[key])
      Object.assign(fields, { [key]: next[key] });
  }
  const games = arrayPatch(base.games, next.games);
  const playbackAcks = arrayPatch(base.playbackAcks, next.playbackAcks);
  if (Object.keys(fields).length === 0 && games === undefined && playbackAcks === undefined)
    return undefined;
  return {
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
    ...(games === undefined ? {} : { games }),
    ...(playbackAcks === undefined ? {} : { playbackAcks }),
  };
}

/**
 * Builds a compact delta from `base` to `next`. Unchanged top-level fields (including the large
 * locked inputs and recruitment market) are omitted entirely.
 */
export function createCapRushMultiplayerStatePatch(
  base: CapRushMultiplayerState,
  next: CapRushMultiplayerState,
): CapRushMultiplayerStatePatch {
  const fields: StateFields = {};
  for (const key of Object.keys(next) as (keyof CapRushMultiplayerState)[]) {
    if (key !== 'season' && base[key] !== next[key]) Object.assign(fields, { [key]: next[key] });
  }
  const patch: CapRushMultiplayerStatePatch = {};
  if (base.season !== next.season) {
    if (base.season !== null && next.season !== null) {
      const delta = seasonPatch(base.season, next.season);
      if (delta !== undefined) patch.season = delta;
    } else {
      fields.season = next.season;
    }
  }
  if (Object.keys(fields).length > 0) patch.fields = fields;
  return patch;
}

function applyArray<T>(base: T[], patch: CapRushMultiplayerArrayPatch<T>, maxLength: number): T[] {
  const length = patch.values.length + (patch.mode === 'append' ? base.length : 0);
  if (length > maxLength) throw new Error('cap rush projection exceeds the season array limit');
  return patch.mode === 'append' ? [...base, ...patch.values] : [...patch.values];
}

export function applyCapRushMultiplayerStatePatch(
  base: CapRushMultiplayerState,
  patch: CapRushMultiplayerStatePatch,
): CapRushMultiplayerState {
  let candidate: CapRushMultiplayerState =
    patch.fields === undefined ? base : { ...base, ...patch.fields };
  if (patch.season !== undefined) {
    const season = candidate.season;
    if (season === null) throw new Error('a season patch needs a base season');
    const next: SeasonState = {
      ...season,
      ...(patch.season.fields ?? {}),
    };
    if (patch.season.games !== undefined)
      next.games = applyArray(season.games, patch.season.games, CAP_RUSH_CONFERENCE_GAMES);
    if (patch.season.playbackAcks !== undefined)
      next.playbackAcks = applyArray(
        season.playbackAcks,
        patch.season.playbackAcks,
        CAP_RUSH_MULTIPLAYER_PLAYBACK_ACK_LIMIT,
      );
    candidate = { ...candidate, season: next };
  }
  return candidate;
}
