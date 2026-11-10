import { describe, expect, it } from 'bun:test';
import type {
  HavocBattleEvent,
  HavocBattleResult,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import { buildHavocGameResult } from '@hoop-rush/test-fixtures';
import { soloToBattleResult } from '@hoop-rush/engine';
import {
  gamecastBattleFeedCursor,
  gamecastBattleFeedLines,
  gamecastBattlePlaybackFold,
  gamecastBattleVisibleState,
  type GamecastBattlePlaybackItem,
} from './gamecast-battle-playback';
import { gamecastBattleLiveBoxFold, gamecastBattleLiveBoxes } from './gamecast-battle-view';

const solo = buildHavocGameResult();
const result: HavocBattleResult = soloToBattleResult(solo, solo.humanSide, solo.inputDigest);
const home = result.home.participants[0];
const away = result.away.participants[0];
if (!home || !away) throw new Error('missing fixture participants');

function event(sequence: number, overrides: Partial<HavocBattleEvent> = {}): HavocBattleEvent {
  return {
    sequence,
    gameNumber: 1,
    period: 1 + Math.floor(sequence / 20),
    clockSeconds: 700 - (sequence % 20),
    kind: 'possession-start',
    possessionId: sequence,
    offenseSide: sequence % 2 === 0 ? 'home' : 'away',
    ...overrides,
  } as HavocBattleEvent;
}

const tape = {
  schemaVersion: 1,
  gameNumber: 1,
  variant: 'havoc',
  seed: 'abcdef1234567890',
  events: [
    event(1),
    event(2, {
      kind: 'shot-attempt',
      side: 'home',
      shooterInstanceId: home.instanceId,
      made: true,
      nominalPoints: 2,
    }),
    event(3, {
      kind: 'rebound',
      side: 'away',
      playerInstanceId: away.instanceId,
      offensive: false,
    }),
    event(4),
    event(5, {
      kind: 'shot-attempt',
      side: 'away',
      shooterInstanceId: away.instanceId,
      made: false,
      nominalPoints: 3,
    }),
  ],
  scoring: [
    {
      sequence: 6,
      gameNumber: 1,
      period: 1,
      clockSeconds: 690,
      side: 'home',
      actorInstanceId: home.instanceId,
      beneficiaryInstanceId: null,
      kind: 'field-goal',
      nominalPoints: 2,
      points: 2,
      addends: [],
      multipliers: [],
      owners: [],
      originalEventSequence: 2,
    },
    {
      sequence: 7,
      gameNumber: 1,
      period: 1,
      clockSeconds: 660,
      side: 'away',
      actorInstanceId: away.instanceId,
      beneficiaryInstanceId: null,
      kind: 'bonus',
      nominalPoints: 1,
      points: 1,
      addends: [],
      multipliers: [],
      owners: [],
      originalEventSequence: null,
    },
  ],
} as unknown as HavocBattleTape;

function itemsOf(): GamecastBattlePlaybackItem[] {
  return [
    ...tape.events.map((value, index) => ({
      key: `event-${String(value.sequence)}`,
      kind: 'event' as const,
      period: value.period,
      clockSeconds: value.clockSeconds,
      index,
      event: value,
      scoring: null,
    })),
    ...tape.scoring.map((value, index) => ({
      key: `scoring-${String(value.sequence)}`,
      kind: 'scoring' as const,
      period: value.period,
      clockSeconds: value.clockSeconds,
      index,
      event: null,
      scoring: value,
    })),
  ].sort(
    (left, right) =>
      left.period - right.period ||
      right.clockSeconds - left.clockSeconds ||
      (left.kind === right.kind ? left.index - right.index : left.kind === 'event' ? -1 : 1),
  );
}

describe('incremental gamecast playback folds', () => {
  it('matches the full fold when advancing one step at a time', () => {
    const items = itemsOf();
    const fold = gamecastBattlePlaybackFold(items);
    for (let count = 0; count <= items.length; count += 1) {
      const incremental = fold.visibleAt(count);
      const expected = gamecastBattleVisibleState(items, count);
      expect(incremental.homeScore).toBe(expected.homeScore);
      expect(incremental.awayScore).toBe(expected.awayScore);
      expect(incremental.period).toBe(expected.period);
      expect(incremental.clockSeconds).toBe(expected.clockSeconds);
      expect(incremental.events).toEqual(expected.events);
      expect(incremental.scoring).toEqual(expected.scoring);
    }
  });

  it('rebuilds after a backward seek and keeps matching the full fold', () => {
    const items = itemsOf();
    const fold = gamecastBattlePlaybackFold(items);
    fold.visibleAt(items.length);
    for (const count of [3, 0, 2, items.length, 1, 4]) {
      const incremental = fold.visibleAt(count);
      const expected = gamecastBattleVisibleState(items, count);
      expect(incremental).toEqual(expected);
    }
  });

  it('folds live boxes incrementally in step with the visible tape', () => {
    const items = itemsOf();
    const fold = gamecastBattlePlaybackFold(items);
    const boxes = gamecastBattleLiveBoxFold(result);
    for (let count = 0; count <= items.length; count += 1) {
      const visible = fold.visibleAt(count);
      expect(boxes.boxesAt(visible)).toEqual(gamecastBattleLiveBoxes(result, visible));
    }
    // Backward seek resets both the tape fold and the box fold together.
    const rewound = fold.visibleAt(2);
    expect(boxes.boxesAt(rewound)).toEqual(gamecastBattleLiveBoxes(result, rewound));
  });

  it('appends feed lines without duplicating earlier scoring entries', () => {
    const items = itemsOf();
    const feed = gamecastBattleFeedCursor({ result, tape }, items);
    expect(feed.linesAt(0)).toEqual([]);
    const partial = feed.linesAt(3);
    expect(feed.linesAt(3)).toBe(partial);
    const full = feed.linesAt(items.length);
    expect(full.map((line) => line.key)).toEqual(['scoring-6', 'scoring-7']);
    expect(full).toEqual(gamecastBattleFeedLines({ result, tape }, items, items.length));
    expect(feed.linesAt(1)).toEqual([]);
  });
});
