import { describe, expect, it } from 'vitest';
import type { FixedFiveCommand } from '@hoop-rush/data-contracts';
import { rollAnimationFor } from './fixed-five-roll-animation';

function command(ordinal: number, payload: unknown): FixedFiveCommand {
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    commandId: `cmd-${String(ordinal)}`,
    ordinal,
    actorParticipantId: 'p1',
    payload,
  } as unknown as FixedFiveCommand;
}

describe('rollAnimationFor', () => {
  it('defaults to the initial full spin with no roll-affecting commands', () => {
    expect(rollAnimationFor([], 'duel')).toEqual({ nonce: 0, axis: 'both' });
    expect(rollAnimationFor([], 'classic-shared-82')).toEqual({ nonce: 0, axis: 'both' });
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
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 2, axis: 'franchise' });
  });

  it('tracks an era reroll with the era axis in classic-shared', () => {
    const commands = [
      command(0, { kind: 'start' }),
      command(1, { kind: 'classic-pick', playerId: 'a', slotIndex: 0 }),
      command(2, { kind: 'reroll', axis: 'era' }),
    ];
    expect(rollAnimationFor(commands, 'classic-shared-82')).toEqual({ nonce: 2, axis: 'era' });
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
    expect(rollAnimationFor(commands, 'duel')).toEqual({ nonce: 2, axis: 'both' });
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
    expect(rollAnimationFor(commands, 'classic-shared-82')).toEqual({ nonce: 2, axis: 'both' });
  });

  it('is order-independent and sandbox has no rolls', () => {
    const reroll = command(2, { kind: 'reroll', axis: 'franchise' });
    const start = command(0, { kind: 'start' });
    expect(rollAnimationFor([reroll, start], 'duel')).toEqual({ nonce: 2, axis: 'franchise' });
    expect(rollAnimationFor([reroll, start], 'sandbox-shared-82')).toEqual({
      nonce: 0,
      axis: 'both',
    });
  });
});
