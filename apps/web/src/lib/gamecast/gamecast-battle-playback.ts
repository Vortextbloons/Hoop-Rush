import type {
  HavocBattleEvent,
  HavocBattleResult,
  HavocBattleScoringEntry,
  HavocBattleTape,
  HavocHomeAway,
} from '@hoop-rush/data-contracts';
import {
  havocEventMutationIdOf,
  havocEventTextOf,
  mutationNameOf,
} from '#lib/features/havoc/havoc-presentation.js';

export interface GamecastBattleAbilityLine {
  key: string;
  period: number;
  clockSeconds: number;
  side: HavocHomeAway | null;
  ability: string;
  summary: string;
}

export interface GamecastBattleAbilityNames {
  readonly names: ReadonlyMap<string, string>;
  readonly sides: ReadonlyMap<string, HavocHomeAway>;
  readonly homeName: string;
  readonly awayName: string;
}

export function gamecastBattleAbilityNames(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
): GamecastBattleAbilityNames {
  const names = new Map<string, string>();
  const sides = new Map<string, HavocHomeAway>();
  for (const side of ['home', 'away'] as const) {
    for (const participant of result[side].participants) {
      names.set(participant.instanceId, participant.displayName);
      sides.set(participant.instanceId, side);
    }
  }
  return { names, sides, homeName: result.home.displayName, awayName: result.away.displayName };
}

export function gamecastBattleAbilityLineOf(
  event: HavocBattleEvent,
  source: GamecastBattleAbilityNames,
): GamecastBattleAbilityLine | null {
  const mutationId = havocEventMutationIdOf(event);
  if (mutationId === null || event.kind === 'turnover-cancelled') return null;
  const owner = 'ownerInstanceId' in event ? event.ownerInstanceId : null;
  const side = 'side' in event ? event.side : owner ? source.sides.get(owner) : undefined;
  const summary = havocEventTextOf(event, {
    playerName: (id) => source.names.get(id) ?? 'Unknown player',
    homeName: source.homeName,
    awayName: source.awayName,
    humanSide: 'home',
  });
  const ownerName = owner ? source.names.get(owner) : undefined;
  return {
    key: `ability-${String(event.sequence)}`,
    period: event.period,
    clockSeconds: event.clockSeconds,
    side: side ?? null,
    ability: mutationNameOf(mutationId),
    summary: ownerName && !summary.includes(ownerName) ? `${ownerName}: ${summary}` : summary,
  };
}

export function gamecastBattleAbilityLines(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
  events: readonly HavocBattleEvent[],
): GamecastBattleAbilityLine[] {
  const source = gamecastBattleAbilityNames(result);
  return events.flatMap((event) => {
    const line = gamecastBattleAbilityLineOf(event, source);
    return line === null ? [] : [line];
  });
}

export interface GamecastBattlePlaybackItem {
  key: string;
  kind: 'event' | 'scoring';
  period: number;
  clockSeconds: number;
  index: number;
  event: HavocBattleEvent | null;
  scoring: HavocBattleScoringEntry | null;
}

export interface GamecastBattleVisibleState {
  homeScore: number;
  awayScore: number;
  period: number;
  clockSeconds: number;
  events: HavocBattleEvent[];
  scoring: HavocBattleScoringEntry[];
}

/**
 * A fold cursor over one tape's playback items.
 *
 * Playback advances forward almost every frame, so folding only the newly
 * revealed items keeps each frame proportional to the advance instead of the
 * whole visible prefix. A backward seek (or a new tape) resets and rebuilds.
 * The returned arrays grow in place; callers treat them as read-only and
 * compare them by identity only to detect a reset.
 */
export interface GamecastBattlePlaybackFold {
  visibleAt(visibleCount: number): GamecastBattleVisibleState;
}

export interface GamecastBattleFeedLine {
  key: string;
  period: number;
  clockSeconds: number;
  side: HavocHomeAway;
  summary: string;
  points: number;
}

export interface GamecastBattleOutput {
  result: HavocBattleResult;
  tape: HavocBattleTape;
}

const DEFAULT_PERIOD_SECONDS = 720;

export function gamecastBattlePlaybackItems(tape: HavocBattleTape): GamecastBattlePlaybackItem[] {
  const items: GamecastBattlePlaybackItem[] = [];
  tape.events.forEach((event, index) => {
    items.push({
      key: `event-${String(event.sequence)}`,
      kind: 'event',
      period: event.period,
      clockSeconds: event.clockSeconds,
      index,
      event,
      scoring: null,
    });
  });
  tape.scoring.forEach((entry, index) => {
    items.push({
      key: `scoring-${String(entry.sequence)}`,
      kind: 'scoring',
      period: entry.period,
      clockSeconds: entry.clockSeconds,
      index,
      event: null,
      scoring: entry,
    });
  });
  items.sort(
    (left, right) =>
      left.period - right.period ||
      right.clockSeconds - left.clockSeconds ||
      (left.kind === right.kind ? left.index - right.index : left.kind === 'event' ? -1 : 1),
  );
  return items;
}

export function gamecastBattleVisibleItemCount(
  items: readonly GamecastBattlePlaybackItem[],
  progress: number,
): number {
  if (items.length === 0) return 0;
  if (Number.isNaN(progress)) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped >= 1) return items.length;
  const total = items.reduce((count, item) => count + (item.kind === 'scoring' ? 1 : 0), 0);
  if (total === 0) return items.length - 1;
  let running = 0;
  let count = 0;
  for (const item of items) {
    if (item.kind === 'scoring') running += 1;
    if (running / total > clamped) break;
    count += 1;
  }
  return count;
}

class IncrementalFold implements GamecastBattlePlaybackFold {
  private readonly items: readonly GamecastBattlePlaybackItem[];
  private homeScore = 0;
  private awayScore = 0;
  private period = 1;
  private clockSeconds = DEFAULT_PERIOD_SECONDS;
  private events: HavocBattleEvent[] = [];
  private scoring: HavocBattleScoringEntry[] = [];
  private folded = 0;
  private view: GamecastBattleVisibleState;

  constructor(items: readonly GamecastBattlePlaybackItem[]) {
    this.items = items;
    this.view = {
      homeScore: 0,
      awayScore: 0,
      period: 1,
      clockSeconds: DEFAULT_PERIOD_SECONDS,
      events: this.events,
      scoring: this.scoring,
    };
  }

  /** Discard the fold and replay the prefix from the start. */
  private rebuild(count: number): GamecastBattleVisibleState {
    this.homeScore = 0;
    this.awayScore = 0;
    this.period = 1;
    this.clockSeconds = DEFAULT_PERIOD_SECONDS;
    this.events = [];
    this.scoring = [];
    this.folded = 0;
    this.advanceTo(count);
    return this.publish();
  }

  visibleAt(visibleCount: number): GamecastBattleVisibleState {
    const count = Number.isNaN(visibleCount)
      ? 0
      : Math.max(0, Math.min(this.items.length, Math.trunc(visibleCount)));
    if (count < this.folded) return this.rebuild(count);
    if (count > this.folded) {
      this.advanceTo(count);
      return this.publish();
    }
    return this.view;
  }

  private advanceTo(count: number): void {
    for (let index = this.folded; index < count; index += 1) {
      const item = this.items[index];
      if (item === undefined) continue;
      this.period = item.period;
      this.clockSeconds = item.clockSeconds;
      if (item.event !== null) this.events.push(item.event);
      if (item.scoring !== null) {
        this.scoring.push(item.scoring);
        if (item.scoring.kind !== 'bonus') {
          if (item.scoring.side === 'home') this.homeScore += item.scoring.points;
          else this.awayScore += item.scoring.points;
        }
      }
    }
    this.folded = count;
  }

  private publish(): GamecastBattleVisibleState {
    this.view = {
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      period: this.period,
      clockSeconds: this.clockSeconds,
      // Snapshot the arrays so a later fold never mutates a shared view.
      events: this.events,
      scoring: this.scoring,
    };
    return this.view;
  }
}

/**
 * Create a resettable fold cursor for one tape.
 *
 * Prefer this over repeated {@link gamecastBattleVisibleState} calls when
 * playback advances monotonically: each advance processes only newly revealed
 * items. Backward seeks rebuild from zero, which keeps the result identical to
 * the full fold.
 */
export function gamecastBattlePlaybackFold(
  items: readonly GamecastBattlePlaybackItem[],
): GamecastBattlePlaybackFold {
  return new IncrementalFold(items);
}

export function gamecastBattleVisibleState(
  items: readonly GamecastBattlePlaybackItem[],
  visibleCount: number,
): GamecastBattleVisibleState {
  return new IncrementalFold(items).visibleAt(visibleCount);
}

export function gamecastBattleParticipantNames(
  output: Pick<GamecastBattleOutput, 'result'>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const team of [output.result.home, output.result.away]) {
    for (const participant of team.participants) {
      names.set(participant.instanceId, participant.displayName);
    }
  }
  return names;
}

function signedPoints(points: number): string {
  return points >= 0 ? `+${String(points)}` : String(points);
}

function feedSummary(entry: HavocBattleScoringEntry, names: ReadonlyMap<string, string>): string {
  const name = names.get(entry.actorInstanceId) ?? 'Unknown';
  if (entry.kind === 'bonus') {
    return `${entry.side === 'home' ? 'Home' : 'Away'} bonus ${signedPoints(entry.points)}`;
  }
  if (entry.kind === 'adjustment') {
    return `${name} adjustment ${signedPoints(entry.points)}`;
  }
  return `${name} ${signedPoints(entry.points)}`;
}

export function gamecastBattleFeedLineOf(
  item: GamecastBattlePlaybackItem,
  names: ReadonlyMap<string, string>,
): GamecastBattleFeedLine | null {
  if (item.scoring === null) return null;
  return {
    key: item.key,
    period: item.scoring.period,
    clockSeconds: item.scoring.clockSeconds,
    side: item.scoring.side,
    summary: feedSummary(item.scoring, names),
    points: item.scoring.points,
  };
}

export function gamecastBattleFeedLines(
  output: GamecastBattleOutput,
  items: readonly GamecastBattlePlaybackItem[],
  visibleCount: number,
): GamecastBattleFeedLine[] {
  return new FeedAppender(output, items).linesAt(visibleCount);
}

/**
 * A monotonic cursor over one broadcast's scoring feed. Playback reveals items
 * in order, so each advance appends only the new scoring entries instead of
 * rescanning the visible prefix.
 */
export interface GamecastBattleFeedCursor {
  linesAt(visibleCount: number): GamecastBattleFeedLine[];
}

class FeedAppender implements GamecastBattleFeedCursor {
  private readonly items: readonly GamecastBattlePlaybackItem[];
  private readonly names: ReadonlyMap<string, string>;
  private lines: GamecastBattleFeedLine[] = [];
  private revealed = 0;

  constructor(output: GamecastBattleOutput, items: readonly GamecastBattlePlaybackItem[]) {
    this.items = items;
    this.names = gamecastBattleParticipantNames(output);
  }

  linesAt(visibleCount: number): GamecastBattleFeedLine[] {
    const count = Number.isNaN(visibleCount)
      ? 0
      : Math.max(0, Math.min(this.items.length, Math.trunc(visibleCount)));
    if (count < this.revealed) {
      this.lines = [];
      this.revealed = 0;
    }
    if (count === this.revealed) return this.lines;
    for (let index = this.revealed; index < count; index += 1) {
      const item = this.items[index];
      if (item === undefined) continue;
      const line = gamecastBattleFeedLineOf(item, this.names);
      if (line !== null) this.lines.push(line);
    }
    this.revealed = count;
    // Publish a snapshot so reactive consumers see a new value each advance.
    return (this.lines = [...this.lines]);
  }
}

/** Create a resettable feed cursor for one broadcast. */
export function gamecastBattleFeedCursor(
  output: GamecastBattleOutput,
  items: readonly GamecastBattlePlaybackItem[],
): GamecastBattleFeedCursor {
  return new FeedAppender(output, items);
}
