import type {
  HavocBattleEvent,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleScoringEntry,
  HavocBattleTape,
  HavocEvent,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
  HavocHomeAway,
  HavocScoringEntry,
} from '@hoop-rush/data-contracts';
import {
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
} from '@hoop-rush/data-contracts';

/**
 * Conversions between the solo (human/opponent) contracts and the neutral
 * battle (home/away) contracts. Solo inputs guarantee that the human side
 * carries the `human` label, so relabeling home/away is lossless; the battle
 * contracts only ever carry home/away.
 */

function oppositeSide(side: HavocHomeAway): HavocHomeAway {
  return side === 'home' ? 'away' : 'home';
}

function soloToBattleSideMapper(humanSide: HavocHomeAway): (side: string) => string {
  return (side) => (side === 'human' ? humanSide : oppositeSide(humanSide));
}

function battleToSoloSideMapper(humanSide: HavocHomeAway): (side: string) => string {
  return (side) => (side === humanSide ? 'human' : 'opponent');
}

function relabelEvent(
  event: HavocEvent | HavocBattleEvent,
  mapSide: (side: string) => string,
): Record<string, unknown> {
  const record: Record<string, unknown> = { ...event };
  if ('side' in event) record.side = mapSide(event.side);
  if ('offenseSide' in event) record.offenseSide = mapSide(event.offenseSide);
  return record;
}

function relabelScoringEntry(
  entry: HavocScoringEntry | HavocBattleScoringEntry,
  mapSide: (side: string) => string,
): Record<string, unknown> {
  return { ...entry, side: mapSide(entry.side) };
}

/** Solo input -> battle input: copies every field and relabels the team sides. */
export function soloToBattleInput(input: HavocGameInput): HavocBattleInput {
  return havocBattleInputSchema.parse({
    ...input,
    home: { ...input.home, side: 'home' },
    away: { ...input.away, side: 'away' },
  });
}

/** Battle result -> solo result: adds the human side and relabels rollup sides. */
export function battleToSoloResult(
  result: HavocBattleResult,
  humanSide: HavocHomeAway,
  inputDigest: string,
): HavocGameResult {
  const mapSide = battleToSoloSideMapper(humanSide);
  return havocGameResultSchema.parse({
    ...result,
    humanSide,
    inputDigest,
    rollups: result.rollups.map((rollup) => ({ ...rollup, side: mapSide(rollup.side) })),
  });
}

/** Solo result -> battle result: maps sides using the input's human side. */
export function soloToBattleResult(
  result: HavocGameResult,
  humanSide: HavocHomeAway,
  inputDigest: string,
): HavocBattleResult {
  const mapSide = soloToBattleSideMapper(humanSide);
  return havocBattleResultSchema.parse({
    ...result,
    inputDigest,
    rollups: result.rollups.map((rollup) => ({ ...rollup, side: mapSide(rollup.side) })),
  });
}

/**
 * Tapes are validated for safety when well-formed but pass through unchanged
 * when corrupt: the auditor must be able to report the corruption as a finding
 * instead of the adapter throwing on it.
 */
function relabeledTape(
  tape: HavocGameTape | HavocBattleTape,
  mapSide: (side: string) => string,
): {
  schemaVersion: number;
  gameNumber: number;
  variant: string;
  seed: string;
  events: Array<Record<string, unknown>>;
  scoring: Array<Record<string, unknown>>;
} {
  return {
    ...tape,
    events: tape.events.map((event) => relabelEvent(event, mapSide)),
    scoring: tape.scoring.map((entry) => relabelScoringEntry(entry, mapSide)),
  };
}

/** Battle tape -> solo tape: relabels every event, offense and scoring side. */
export function battleToSoloTape(tape: HavocBattleTape, humanSide: HavocHomeAway): HavocGameTape {
  const relabeled = relabeledTape(tape, battleToSoloSideMapper(humanSide));
  const parsed = havocGameTapeSchema.safeParse(relabeled);
  return parsed.success ? parsed.data : (relabeled as unknown as HavocGameTape);
}

/** Solo tape -> battle tape: maps sides using the input's human side. */
export function soloToBattleTape(tape: HavocGameTape, humanSide: HavocHomeAway): HavocBattleTape {
  const relabeled = relabeledTape(tape, soloToBattleSideMapper(humanSide));
  const parsed = havocBattleTapeSchema.safeParse(relabeled);
  return parsed.success ? parsed.data : (relabeled as unknown as HavocBattleTape);
}
