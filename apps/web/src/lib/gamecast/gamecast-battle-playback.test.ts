import { describe, expect, it } from 'bun:test';
import type { HavocBattleEvent } from '@hoop-rush/data-contracts';
import { buildHavocGameResult } from '@hoop-rush/test-fixtures';
import { gamecastBattleAbilityLines } from './gamecast-battle-playback';

describe('Havoc broadcast ability events', () => {
  const result = buildHavocGameResult();
  const owner = result.away.participants[0];
  if (!owner) throw new Error('Missing fixture participant');
  const base = { sequence: 1, gameNumber: 1, period: 2, clockSeconds: 123 };

  it('shows only revealed ability events and retains their recorded outcomes', () => {
    const armed: HavocBattleEvent = {
      ...base,
      kind: 'heat-check',
      outcome: 'armed',
      ownerInstanceId: owner.instanceId,
      side: 'away',
      scoringSequence: null,
    };
    const expired: HavocBattleEvent = { ...armed, sequence: 2, outcome: 'expired' };
    expect(gamecastBattleAbilityLines(result, [])).toEqual([]);
    const revealed = gamecastBattleAbilityLines(result, [armed]);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatchObject({
      side: 'away',
      period: 2,
      clockSeconds: 123,
      ability: 'Heat Check',
    });
    expect(revealed[0]?.summary).toContain('armed');
    expect(gamecastBattleAbilityLines(result, [armed, expired])[1]?.summary).toContain('expired');
  });

  it('resolves owner teams for events without an explicit side', () => {
    const event: HavocBattleEvent = {
      ...base,
      kind: 'great-equalizer',
      outcome: 'applied',
      ownerInstanceId: owner.instanceId,
      cappedInstanceIds: [],
    };
    expect(gamecastBattleAbilityLines(result, [event])[0]?.side).toBe('away');
  });

  it('excludes ordinary plays and the redundant refund cancellation event', () => {
    const events: HavocBattleEvent[] = [
      { ...base, kind: 'period-start' },
      {
        ...base,
        sequence: 2,
        kind: 'turnover-cancelled',
        possessionId: 1,
        playerInstanceId: owner.instanceId,
        side: 'away',
        originalSequence: 0,
      },
      {
        ...base,
        sequence: 3,
        kind: 'possession-refund',
        ownerInstanceId: owner.instanceId,
        side: 'away',
        turnoverSequence: 0,
      },
    ];
    const lines = gamecastBattleAbilityLines(result, events);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.summary).toContain(owner.displayName);
    expect(lines[0]?.ability).toBe('Possession Refund');
  });
});
