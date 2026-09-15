import { describe, expect, it } from 'vitest';
import {
  rollAnimationFor,
  stableRollSpinId,
  type RollAnimationAxis,
} from './fixed-five-roll-animation';
import type { FixedFiveCommand } from '@hoop-rush/data-contracts';

function command(
  ordinal: number,
  kind: FixedFiveCommand['payload']['kind'],
  actor: 'p1' | 'p2' = 'p1',
): FixedFiveCommand {
  const payload = kind === 'reroll' ? { kind, axis: 'franchise' } : { kind };
  return {
    schemaVersion: 1,
    roomId: 'room-1',
    ordinal,
    commandId: `cmd-${String(ordinal)}`,
    actorParticipantId: actor,
    revision: ordinal + 1,
    payload,
  } as unknown as FixedFiveCommand;
}

describe('stableRollSpinId', () => {
  it('is identical for the same roll regardless of command arrival batching', () => {
    const a = stableRollSpinId({
      mode: 'duel',
      ordinal: 4,
      franchiseId: 'lal',
      eraId: 'e2010s',
      axis: 'both',
    });
    const b = stableRollSpinId({
      mode: 'duel',
      ordinal: 4,
      franchiseId: 'lal',
      eraId: 'e2010s',
      axis: 'both',
    });
    expect(a).toBe(b);
  });
  it('changes when the roll, round, or axis changes', () => {
    const base = {
      mode: 'duel',
      ordinal: 4,
      franchiseId: 'lal',
      eraId: 'e2010s',
      axis: 'both' as RollAnimationAxis,
    };
    expect(stableRollSpinId({ ...base, ordinal: 5 })).not.toBe(stableRollSpinId(base));
    expect(stableRollSpinId({ ...base, franchiseId: 'bos' })).not.toBe(stableRollSpinId(base));
    expect(stableRollSpinId({ ...base, axis: 'franchise' })).not.toBe(stableRollSpinId(base));
  });
});

describe('rollAnimationFor axis', () => {
  it('reports the reroll axis from the latest command', () => {
    const commands = [command(0, 'start'), command(1, 'reroll')];
    expect(rollAnimationFor(commands, 'duel').axis).toBe('franchise');
  });
  it('resets to both after a claim', () => {
    const commands = [command(0, 'start'), command(1, 'reroll'), command(2, 'duel-claim')];
    expect(rollAnimationFor(commands, 'duel').axis).toBe('both');
  });
  it('ignores the rival log for classic-shared viewers', () => {
    const commands = [command(0, 'start'), command(1, 'reroll', 'p2')];
    expect(rollAnimationFor(commands, 'classic-shared-82', 'p1').axis).toBe('both');
    expect(rollAnimationFor(commands, 'classic-shared-82', 'p2').axis).toBe('franchise');
  });
});
