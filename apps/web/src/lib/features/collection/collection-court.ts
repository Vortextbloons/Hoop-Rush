import type { CollectionGameEvent } from '@hoop-rush/data-contracts';

export function courtPlay(event: CollectionGameEvent | null): {
  label: string;
  cardId: string | null;
  side: 'home' | 'away' | null;
  shot: boolean;
  made: boolean;
} {
  const neutral = { cardId: null, side: null, shot: false, made: false };
  if (!event) return { ...neutral, label: 'Ready for tip-off' };
  if (event.kind === 'final') return { ...neutral, label: 'Final buzzer' };
  if (event.kind === 'period-end') return { ...neutral, label: 'End of period' };
  if (event.kind === 'substitution') {
    return { ...neutral, label: 'Checking in', cardId: event.playerInCardId, side: event.side };
  }
  const scorer = event.statDeltas.find((delta) => delta.points > 0);
  const blocker = event.statDeltas.find((delta) => delta.blocks > 0);
  const steal = event.statDeltas.find((delta) => delta.steals > 0);
  const turnover = event.statDeltas.find((delta) => delta.turnovers > 0);
  const shooter = event.statDeltas.find((delta) => delta.fieldGoalsAttempted > 0);
  const actor = scorer ?? blocker ?? steal ?? turnover ?? shooter;
  const label = scorer
    ? scorer.threePointMade > 0
      ? 'Three-pointer'
      : scorer.fieldGoalsMade > 0
        ? 'Basket'
        : 'Free throws'
    : blocker
      ? 'Blocked shot'
      : steal
        ? 'Steal'
        : turnover
          ? 'Turnover'
          : shooter
            ? 'Missed shot'
            : 'Possession';
  return {
    label,
    cardId: actor?.cardId ?? null,
    side: actor?.side ?? event.offenseSide,
    shot: shooter !== undefined || scorer !== undefined,
    made: scorer !== undefined,
  };
}
