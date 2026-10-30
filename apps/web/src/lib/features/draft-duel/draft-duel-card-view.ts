import {
  OVERALL_BANDS,
  type DraftDuelCard,
  type DraftDuelPresentation,
  type DraftDuelUnavailableReason,
} from '@hoop-rush/data-contracts';

const DRAFT_DUEL_ELITE_OVERALL = 95;

export const DRAFT_DUEL_REASON_LABELS: Readonly<Record<DraftDuelUnavailableReason, string>> = {
  claimed: 'Already drafted',
  position: "Can't fill your lineup",
  completion: "Can't complete a lineup",
  turn: 'Not your turn',
  phase: 'Draft complete',
};

export interface DraftDuelCardView {
  cardId: string;
  playerId: string;
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  franchiseId: string;
  eraId: string;
  positions: readonly string[];
  overall: number | null;
  bandLabel: string | null;
  elite: boolean;
  strengthHidden: boolean;
}

function draftDuelBandLabel(card: DraftDuelCard): string {
  const index = Math.min(Math.max(card.bandIndex, 0), OVERALL_BANDS.length - 1);
  return OVERALL_BANDS[index]?.label ?? '';
}

export function draftDuelCardView(
  card: DraftDuelCard,
  presentation: DraftDuelPresentation,
): DraftDuelCardView {
  const base = {
    cardId: card.cardId,
    playerId: card.playerId,
    playerVersionId: card.playerVersionId,
    displayName: card.displayName,
    seasonKey: card.seasonKey,
    franchiseId: card.franchiseId,
    eraId: card.eraId,
    positions: [...card.positions],
  };
  if (presentation === 'ball-knowledge') {
    return { ...base, overall: null, bandLabel: null, elite: false, strengthHidden: true };
  }
  return {
    ...base,
    overall: card.overall,
    bandLabel: draftDuelBandLabel(card),
    elite: card.overall >= DRAFT_DUEL_ELITE_OVERALL,
    strengthHidden: false,
  };
}
