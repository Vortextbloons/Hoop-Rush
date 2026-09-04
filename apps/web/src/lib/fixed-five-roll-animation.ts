import type { FixedFiveCommand, FixedFiveRoomMode } from '@hoop-rush/data-contracts';

export type RollAnimationAxis = 'both' | 'franchise' | 'era';

export interface RollAnimation {
  nonce: number;
  axis: RollAnimationAxis;
}

function isRollAffecting(
  mode: FixedFiveRoomMode,
  kind: FixedFiveCommand['payload']['kind'],
): boolean {
  if (mode === 'duel') {
    return (
      kind === 'start' ||
      kind === 'reroll' ||
      kind === 'duel-claim' ||
      kind === 'classic-pick' ||
      kind === 'timeout-autopick'
    );
  }
  if (mode === 'sandbox-shared-82') return false;
  return (
    kind === 'start' || kind === 'reroll' || kind === 'classic-pick' || kind === 'timeout-autopick'
  );
}

export function rollAnimationFor(
  commands: FixedFiveCommand[],
  mode: FixedFiveRoomMode,
): RollAnimation {
  let nonce = 0;
  let axis: RollAnimationAxis = 'both';
  for (const command of commands) {
    if (!isRollAffecting(mode, command.payload.kind)) continue;
    if (command.ordinal < nonce) continue;
    nonce = command.ordinal;
    axis = command.payload.kind === 'reroll' ? command.payload.axis : 'both';
  }
  return { nonce, axis };
}
