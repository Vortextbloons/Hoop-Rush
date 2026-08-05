import { describe, expect, it } from 'vitest';
import { buildFixtureBracket, seedFromString } from '@hoop-rush/test-fixtures';
import { generateSchedule, scheduleInvariants, SCHEDULE_GENERATION_VERSION } from './schedule.ts';

const ALL_FRANCHISES = [
  'hawks',
  'celtics',
  'nets',
  'hornets',
  'bulls',
  'cavaliers',
  'mavericks',
  'nuggets',
  'pistons',
  'warriors',
  'rockets',
  'pacers',
  'clippers',
  'lakers',
  'grizzlies',
  'heat',
  'bucks',
  'timberwolves',
  'pelicans',
  'knicks',
  'thunder',
  'magic',
  'sixers',
  'suns',
  'blazers',
  'kings',
  'spurs',
  'raptors',
  'jazz',
  'wizards',
];

function opponentIds(prefix = 'bracket-'): string[] {
  return ALL_FRANCHISES.map((franchise) =>
    franchise === 'lakers' ? 'lakers-1990s-opening' : `${prefix}${franchise}`,
  );
}

describe('generateSchedule (spec/01 fixed schedule)', () => {
  it('produces 82 games with game one as the opening opponent', () => {
    const ids = opponentIds();
    const schedule = generateSchedule(
      ids,
      'lakers-1990s-opening',
      seedFromString('fixture-schedule'),
    );
    expect(schedule).toHaveLength(82);
    expect(schedule[0]?.opponentId).toBe('lakers-1990s-opening');
    expect(scheduleInvariants(schedule)).toEqual([]);
  });

  it('assigns 22 opponents three games and eight opponents two games', () => {
    const schedule = generateSchedule(
      opponentIds(),
      'lakers-1990s-opening',
      seedFromString('fixture-schedule'),
    );
    const counts = new Map<string, number>();
    for (const entry of schedule) {
      counts.set(entry.opponentId, (counts.get(entry.opponentId) ?? 0) + 1);
    }
    expect([...counts.values()].filter((c) => c === 3)).toHaveLength(22);
    expect([...counts.values()].filter((c) => c === 2)).toHaveLength(8);
  });

  it('avoids immediate repeats in every generated schedule', () => {
    for (const seed of ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32)]) {
      const schedule = generateSchedule(opponentIds(), 'lakers-1990s-opening', seed);
      for (let i = 1; i < schedule.length; i += 1) {
        expect(schedule[i]?.opponentId).not.toBe(schedule[i - 1]?.opponentId);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const a = generateSchedule(
      opponentIds(),
      'lakers-1990s-opening',
      seedFromString('fixture-schedule'),
    );
    const b = generateSchedule(
      opponentIds(),
      'lakers-1990s-opening',
      seedFromString('fixture-schedule'),
    );
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateSchedule(
      opponentIds(),
      'lakers-1990s-opening',
      seedFromString('fixture-schedule'),
    );
    const b = generateSchedule(
      opponentIds(),
      'lakers-1990s-opening',
      seedFromString('other-schedule'),
    );
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('rejects wrong-sized opponent sets', () => {
    expect(() =>
      generateSchedule(opponentIds().slice(0, 29), 'lakers-1990s-opening', seedFromString('x')),
    ).toThrow(/exactly 30/);
    expect(() =>
      generateSchedule([...opponentIds(), 'extra'], 'lakers-1990s-opening', seedFromString('x')),
    ).toThrow(/exactly 30/);
  });

  it('rejects an opening opponent outside the bracket', () => {
    expect(() => generateSchedule(opponentIds(), 'nope', seedFromString('x'))).toThrow(
      /not in the bracket/,
    );
  });

  it('the fixture bracket schedule satisfies the invariants', () => {
    const bracket = buildFixtureBracket();
    expect(scheduleInvariants(bracket.schedule)).toEqual([]);
    expect(bracket.schedule[0]?.opponentId).toBe('lakers-1990s-opening');
  });

  it('pins the schedule generation version', () => {
    expect(SCHEDULE_GENERATION_VERSION).toBe('schedule-v1');
  });
});
