import type { HavocParticipantKind } from '@hoop-rush/data-contracts';

export function gamecastBattleParticipantKindLabel(kind: HavocParticipantKind): string {
  if (kind === 'starter') return 'Starter';
  if (kind === 'replacement') return 'Replacement';
  return 'Clone';
}
