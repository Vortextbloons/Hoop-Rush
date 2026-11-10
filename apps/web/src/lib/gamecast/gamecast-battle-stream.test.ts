import { describe, expect, it } from 'bun:test';
import type {
  HavocBattleEvent,
  HavocBattleResult,
  HavocBattleScoringEntry,
  HavocBattleTape,
} from '@hoop-rush/data-contracts';
import { buildHavocGameResult } from '@hoop-rush/test-fixtures';
import {
  gamecastBattleAbilityLines,
  gamecastBattleFeedLines,
  gamecastBattleVisibleState,
} from './gamecast-battle-playback';
import { GamecastBattlePlaybackStream } from './gamecast-battle-stream';
import { gamecastBattleLiveBoxes } from './gamecast-battle-view';

describe('append-only battle playback', () => {
  const fixture = buildHavocGameResult();
  const result = fixture as unknown as HavocBattleResult;
  const home = result.home.participants[0];
  const away = result.away.participants[0];
  if (home === undefined || away === undefined) throw new Error('missing fixture participants');
  const abilityEvent = (sequence: number, owner: string): HavocBattleEvent =>
    ({
      sequence,
      gameNumber: 1,
      kind: 'heat-check',
      period: 2,
      clockSeconds: 400 - sequence,
      outcome: 'armed',
      ownerInstanceId: owner,
      side: owner === home.instanceId ? 'home' : 'away',
      scoringSequence: null,
    }) as unknown as HavocBattleEvent;
  const events: HavocBattleEvent[] = [
    {
      sequence: 1,
      gameNumber: 1,
      kind: 'period-start',
      period: 1,
      clockSeconds: 720,
    } as unknown as HavocBattleEvent,
    abilityEvent(2, home.instanceId),
    {
      sequence: 3,
      gameNumber: 1,
      kind: 'shot-attempt',
      period: 1,
      clockSeconds: 650,
      side: 'home',
      shooterInstanceId: home.instanceId,
      made: true,
    } as unknown as HavocBattleEvent,
    abilityEvent(4, away.instanceId),
    {
      sequence: 5,
      gameNumber: 1,
      kind: 'turnover',
      period: 1,
      clockSeconds: 620,
      side: 'away',
      playerInstanceId: away.instanceId,
    } as unknown as HavocBattleEvent,
  ];
  const scoring: HavocBattleScoringEntry[] = [
    {
      sequence: 1,
      period: 1,
      clockSeconds: 650,
      side: 'home',
      actorInstanceId: home.instanceId,
      kind: 'shot',
      points: 3,
      nominalPoints: 3,
    } as unknown as HavocBattleScoringEntry,
    {
      sequence: 2,
      period: 1,
      clockSeconds: 640,
      side: 'away',
      actorInstanceId: away.instanceId,
      kind: 'bonus',
      points: 1,
      nominalPoints: 1,
    } as unknown as HavocBattleScoringEntry,
    {
      sequence: 3,
      period: 1,
      clockSeconds: 630,
      side: 'away',
      actorInstanceId: away.instanceId,
      kind: 'adjustment',
      points: -2,
      nominalPoints: 0,
    } as unknown as HavocBattleScoringEntry,
  ];
  const tape = { events, scoring } as unknown as HavocBattleTape;
  const output = { result, tape };

  it('matches the pure projector at every cursor including bonuses and signed scoring', () => {
    const stream = new GamecastBattlePlaybackStream(output);
    for (let count = 0; count <= stream.items.length; count += 1) {
      const frame = stream.frame(count);
      const visible = gamecastBattleVisibleState(stream.items, count);
      expect(frame.visible.homeScore).toBe(visible.homeScore);
      expect(frame.visible.awayScore).toBe(visible.awayScore);
      expect(frame.visible.period).toBe(visible.period);
      expect(frame.visible.clockSeconds).toBe(visible.clockSeconds);
      expect(frame.visible.events).toEqual(visible.events);
      expect(frame.visible.scoring).toEqual(visible.scoring);
      expect(frame.feed).toEqual(gamecastBattleFeedLines(output, stream.items, count));
      expect(frame.boxes).toEqual(gamecastBattleLiveBoxes(result, visible));
      expect(frame.abilities).toEqual(gamecastBattleAbilityLines(result, visible.events));
      expect(frame.abilityCount).toBe(frame.abilities.length);
    }
  });

  it('publishes new arrays without mutating an earlier frame', () => {
    const stream = new GamecastBattlePlaybackStream(output);
    const initial = stream.frame(0);
    const next = stream.frame(stream.items.length);
    expect(next.feed).not.toBe(initial.feed);
    expect(next.abilities).not.toBe(initial.abilities);
    expect(initial.visible.events).toHaveLength(0);
    expect(initial.visible.scoring).toHaveLength(0);
    expect(initial.feed).toHaveLength(0);
    expect(initial.abilities).toHaveLength(0);
  });

  it('rebuilds after a backwards seek and keeps the ability feed bounded', () => {
    const many = Array.from({ length: 80 }, (_, index) => abilityEvent(index + 1, home.instanceId));
    const longStream = new GamecastBattlePlaybackStream({
      result,
      tape: { events: many, scoring: [] } as unknown as HavocBattleTape,
    });
    const end = longStream.frame(longStream.items.length);
    expect(end.abilityCount).toBe(80);
    expect(end.abilities).toHaveLength(64);
    const back = longStream.frame(0);
    expect(back.visible.homeScore).toBe(0);
    expect(back.visible.awayScore).toBe(0);
    expect(back.abilities).toHaveLength(0);
    expect(back.abilityCount).toBe(0);
    const forward = longStream.frame(longStream.items.length);
    expect(forward.visible).toEqual(end.visible);
    expect(forward.boxes).toEqual(end.boxes);
    expect(forward.abilityCount).toBe(80);
    expect(forward.abilities).toHaveLength(64);
  });
});
