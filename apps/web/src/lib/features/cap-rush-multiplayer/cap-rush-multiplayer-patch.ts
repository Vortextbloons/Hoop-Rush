import {
  capRushMultiplayerStateSchema,
  type CapRushMultiplayerArrayPatch,
  type CapRushMultiplayerSeasonPatch,
  type CapRushMultiplayerState,
  type CapRushMultiplayerStatePatch,
} from '@hoop-rush/data-contracts';

type SeasonState = NonNullable<CapRushMultiplayerState['season']>;
type SeasonFields = NonNullable<CapRushMultiplayerSeasonPatch['fields']>;
type StateFields = NonNullable<CapRushMultiplayerStatePatch['fields']>;

/**
 * Top-level fields that are replaced verbatim when they change. `season` is diffed separately so
 * an ACK or one new slot does not resend the full game history.
 */
const REPLACED_STATE_FIELDS = [
  'schemaVersion',
  'phase',
  'rootSeed',
  'franchises',
  'ready',
  'lockConfirmations',
  'recruitment',
  'locked',
  'postseason',
  'completion',
  'report',
] as const;

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
  if (base.frontierSlot !== next.frontierSlot) fields.frontierSlot = next.frontierSlot;
  if (base.h2hSlots !== next.h2hSlots) fields.h2hSlots = next.h2hSlots;
  if (base.block !== next.block) fields.block = next.block;
  if (base.slotAcks !== next.slotAcks) fields.slotAcks = next.slotAcks;
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
  for (const key of REPLACED_STATE_FIELDS) {
    if (base[key] !== next[key]) (fields as Record<string, unknown>)[key] = next[key];
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

function applyArray<T>(base: readonly T[], patch: CapRushMultiplayerArrayPatch<T>): T[] {
  return patch.mode === 'append' ? [...base, ...patch.values] : [...patch.values];
}

/**
 * Applies a patch without the full schema parse. The worker uses this only to reproduce its own
 * result before binding the patch to the result digest; clients must use the validated variant.
 */
export function applyCapRushMultiplayerStatePatchUnchecked(
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
    if (patch.season.games !== undefined) next.games = applyArray(season.games, patch.season.games);
    if (patch.season.playbackAcks !== undefined)
      next.playbackAcks = applyArray(season.playbackAcks, patch.season.playbackAcks);
    candidate = { ...candidate, season: next };
  }
  return candidate;
}

/**
 * Applies a worker patch and validates the reconstructed state with the full domain schema.
 * Callers must still compare the state digest before accepting the result.
 */
export function applyCapRushMultiplayerStatePatch(
  base: CapRushMultiplayerState,
  patch: CapRushMultiplayerStatePatch,
): CapRushMultiplayerState {
  return capRushMultiplayerStateSchema.parse(
    applyCapRushMultiplayerStatePatchUnchecked(base, patch),
  );
}
