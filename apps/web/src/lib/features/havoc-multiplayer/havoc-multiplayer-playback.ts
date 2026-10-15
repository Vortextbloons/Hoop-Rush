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

export function havocMultiplayerAbilityLines(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
  events: readonly HavocBattleEvent[],
) {
  const names = new Map<string, string>();
  const sides = new Map<string, HavocHomeAway>();
  for (const side of ['home', 'away'] as const) {
    for (const participant of result[side].participants) {
      names.set(participant.instanceId, participant.displayName);
      sides.set(participant.instanceId, side);
    }
  }
  return events.flatMap((event) => {
    const mutationId = havocEventMutationIdOf(event);
    if (mutationId === null || event.kind === 'turnover-cancelled') return [];
    const owner = 'ownerInstanceId' in event ? event.ownerInstanceId : null;
    const side = 'side' in event ? event.side : owner ? sides.get(owner) : undefined;
    const summary = havocEventTextOf(event, {
      playerName: (id) => names.get(id) ?? 'Unknown player',
      homeName: result.home.displayName,
      awayName: result.away.displayName,
      humanSide: 'home',
    });
    const ownerName = owner ? names.get(owner) : undefined;
    return [
      {
        key: `ability-${String(event.sequence)}`,
        period: event.period,
        clockSeconds: event.clockSeconds,
        side: side ?? null,
        ability: mutationNameOf(mutationId),
        summary: ownerName && !summary.includes(ownerName) ? `${ownerName}: ${summary}` : summary,
      },
    ];
  });
}

export interface HavocMultiplayerPlaybackItem {
  key: string;
  kind: 'event' | 'scoring';
  period: number;
  clockSeconds: number;
  index: number;
  event: HavocBattleEvent | null;
  scoring: HavocBattleScoringEntry | null;
}

export interface HavocMultiplayerVisibleState {
  homeScore: number;
  awayScore: number;
  period: number;
  clockSeconds: number;
  events: HavocBattleEvent[];
  scoring: HavocBattleScoringEntry[];
}

export interface HavocMultiplayerFeedLine {
  key: string;
  period: number;
  clockSeconds: number;
  side: HavocHomeAway;
  summary: string;
  points: number;
}

export interface HavocMultiplayerBroadcastOutput {
  result: HavocBattleResult;
  tape: HavocBattleTape;
}

const DEFAULT_PERIOD_SECONDS = 720;

export function havocMultiplayerPlaybackItems(
  tape: HavocBattleTape,
): HavocMultiplayerPlaybackItem[] {
  const items: HavocMultiplayerPlaybackItem[] = [];
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

export function havocMultiplayerPlaybackWeights(
  items: readonly HavocMultiplayerPlaybackItem[],
): number[] {
  const weights: number[] = items.map((item) => (item.kind === 'scoring' ? 1 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    return weights.map((_, index) => (index === weights.length - 1 ? 1 : 0));
  }
  const cumulative: number[] = [];
  let running = 0;
  for (const weight of weights) {
    running += weight;
    cumulative.push(running / total);
  }
  return cumulative;
}

export function havocMultiplayerVisibleItemCount(
  items: readonly HavocMultiplayerPlaybackItem[],
  progress: number,
): number {
  if (items.length === 0) return 0;
  if (Number.isNaN(progress)) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped >= 1) return items.length;
  const cumulative = havocMultiplayerPlaybackWeights(items);
  let count = 0;
  while (count < items.length && (cumulative[count] ?? Number.POSITIVE_INFINITY) <= clamped) {
    count += 1;
  }
  return count;
}

export function havocMultiplayerVisibleState(
  items: readonly HavocMultiplayerPlaybackItem[],
  visibleCount: number,
): HavocMultiplayerVisibleState {
  const count = Number.isNaN(visibleCount)
    ? 0
    : Math.max(0, Math.min(items.length, Math.trunc(visibleCount)));
  let homeScore = 0;
  let awayScore = 0;
  let period = 1;
  let clockSeconds = DEFAULT_PERIOD_SECONDS;
  const events: HavocBattleEvent[] = [];
  const scoring: HavocBattleScoringEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    period = item.period;
    clockSeconds = item.clockSeconds;
    if (item.event !== null) events.push(item.event);
    if (item.scoring !== null) {
      scoring.push(item.scoring);
      if (item.scoring.kind !== 'bonus') {
        if (item.scoring.side === 'home') homeScore += item.scoring.points;
        else awayScore += item.scoring.points;
      }
    }
  }
  return { homeScore, awayScore, period, clockSeconds, events, scoring };
}

function participantNames(output: HavocMultiplayerBroadcastOutput): Map<string, string> {
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

function feedSummary(entry: HavocBattleScoringEntry, names: Map<string, string>): string {
  const name = names.get(entry.actorInstanceId) ?? 'Unknown';
  if (entry.kind === 'bonus') {
    return `${entry.side === 'home' ? 'Home' : 'Away'} bonus ${signedPoints(entry.points)}`;
  }
  if (entry.kind === 'adjustment') {
    return `${name} adjustment ${signedPoints(entry.points)}`;
  }
  return `${name} ${signedPoints(entry.points)}`;
}

export function havocMultiplayerFeedLines(
  output: HavocMultiplayerBroadcastOutput,
  items: readonly HavocMultiplayerPlaybackItem[],
  visibleCount: number,
): HavocMultiplayerFeedLine[] {
  const count = Number.isNaN(visibleCount)
    ? 0
    : Math.max(0, Math.min(items.length, Math.trunc(visibleCount)));
  const names = participantNames(output);
  const lines: HavocMultiplayerFeedLine[] = [];
  for (let index = 0; index < count; index += 1) {
    const item = items[index];
    if (item === undefined || item.scoring === null) continue;
    lines.push({
      key: item.key,
      period: item.scoring.period,
      clockSeconds: item.scoring.clockSeconds,
      side: item.scoring.side,
      summary: feedSummary(item.scoring, names),
      points: item.scoring.points,
    });
  }
  return lines;
}
