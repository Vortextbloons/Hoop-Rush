import { describe, expect, it } from 'vitest';
import type { FixedFiveCommand } from '@hoop-rush/data-contracts';
import { rollAnimationFor } from './fixed-five-roll-animation';
function command(ordinal: number, payload: unknown, actor: 'p1' | 'p2' = 'p1'): FixedFiveCommand {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    commandId: `cmd-${String(ordinal)}`,
    ordinal,
    actorParticipantId: actor,
    payload,
  } as unknown as FixedFiveCommand;
}
describe('rollAnimationFor', () => {
  it('defaults to the initial full spin with no roll-affecting commands', () => {
    expect(rollAnimationFor([], 'duel')).toEqual({ nonce: 0, axis: 'both' });
    expect(rollAnimationFor([], 'classic-shared-82')).toEqual({ nonce: 0, axis: 'both' });
  });
  it('starts the nonce at one for the opening roll so the first spin plays', () => {
    const commands = [command(0, { kind: 'start' })];
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 1, axis: 'both' });
    expect(rollAnimationFor(commands, 'classic-shared-82', 'p2')).toEqual({
      nonce: 1,
      axis: 'both',
    });
  });
  it('ignores non-roll commands like ready and rematch signals', () => {
    const commands = [
      command(0, { kind: 'ready', ready: true }),
      command(1, { kind: 'rematch-request' }),
    ];
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 0, axis: 'both' });
  });
  it('tracks a franchise reroll to its ordinal with the franchise axis', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, {
        kind: 'duel-claim',
        playerId: 'a',
        slotIndex: 0,
        franchiseId: 'lakers',
        eraId: '1990s',
      }),
      command(2, { kind: 'reroll', axis: 'franchise' }),
    ];
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 3, axis: 'franchise' });
  });
  it('tracks an era reroll with the era axis in classic-shared', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, { kind: 'classic-pick', playerId: 'a', slotIndex: 0 }),
      command(2, { kind: 'reroll', axis: 'era' }),
    ];
    expect(rollAnimationFor(commands, 'classic-shared-82')).toEqual({ nonce: 3, axis: 'era' });
  });
  it('resets to both axes on the next claim or pick', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, { kind: 'reroll', axis: 'franchise' }),
      command(2, {
        kind: 'duel-claim',
        playerId: 'a',
        slotIndex: 0,
        franchiseId: 'lakers',
        eraId: '1990s',
      }),
    ];
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 3, axis: 'both' });
  });
  it('counts timeout autopicks as full new rolls', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, { kind: 'reroll', axis: 'era' }),
      command(2, {
        kind: 'timeout-autopick',
        playerId: 'a',
        slotIndex: 0,
        pickOrdinal: 1,
        seedPath: 's',
      }),
    ];
    expect(rollAnimationFor(commands, 'classic-shared-82')).toEqual({ nonce: 3, axis: 'both' });
  });
  it('is order-independent and sandbox has no rolls', () => {
    const reroll = command(2, { kind: 'reroll', axis: 'franchise' });
    const start = command(0, { kind: 'start' });
    expect(rollAnimationFor([reroll, start], 'duel')).toEqual({ nonce: 3, axis: 'franchise' });
    expect(rollAnimationFor([reroll, start], 'sandbox-shared-82')).toEqual({
      nonce: 0,
      axis: 'both',
    });
  });
  it('ignores the other participant in classic-shared so rival picks never restart your spin', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, { kind: 'classic-pick', playerId: 'a', slotIndex: 0 }, 'p1'),
      command(2, { kind: 'classic-pick', playerId: 'b', slotIndex: 0 }, 'p2'),
      command(3, { kind: 'reroll', axis: 'franchise' }, 'p2'),
    ];
    expect(rollAnimationFor(commands, 'classic-shared-82', 'p1')).toEqual({
      nonce: 2,
      axis: 'both',
    });
    expect(rollAnimationFor(commands, 'classic-shared-82', 'p2')).toEqual({
      nonce: 4,
      axis: 'franchise',
    });
  });
  it('counts both participants in duel because the roll is shared', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(
        1,
        {
          kind: 'duel-claim',
          playerId: 'a',
          slotIndex: 0,
          franchiseId: 'lakers',
          eraId: '1990s',
        },
        'p1',
      ),
      command(
        2,
        {
          kind: 'duel-claim',
          playerId: 'b',
          slotIndex: 1,
          franchiseId: 'celtics',
          eraId: '1980s',
        },
        'p2',
      ),
    ];
    expect(rollAnimationFor(commands, 'duel', 'p1')).toEqual({ nonce: 3, axis: 'both' });
    expect(rollAnimationFor(commands, 'duel', 'p2')).toEqual({ nonce: 3, axis: 'both' });
  });
});
