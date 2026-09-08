import {
  playableSlotGroups,
  type CollectionActiveTeam,
  type CollectionCatalogCard,
  type Position,
} from '@hoop-rush/data-contracts';
import {
  allocateDefaultMinutes,
  initializeCollectionActiveTeam,
  validateCollectionActiveTeam,
  type CollectionTeamCheck,
} from '@hoop-rush/engine';

export const STARTER_SLOT_LABELS = ['Guard', 'Guard', 'Forward', 'Forward', 'Center'] as const;
export const STARTER_SLOT_GROUPS = ['G', 'G', 'F', 'F', 'C'] as const;
export const TEAM_MINUTES_TOTAL = 240;

export interface TeamDraft {
  starters: Array<string | null>;
  bench: string[];
  minutes: Record<string, number>;
}

export function emptyDraft(): TeamDraft {
  return { starters: [null, null, null, null, null], bench: [], minutes: {} };
}

export function draftFromTeam(team: CollectionActiveTeam): TeamDraft {
  return {
    starters: [...team.starters],
    bench: [...team.bench],
    minutes: Object.fromEntries(team.targetMinutes.map((entry) => [entry.cardId, entry.minutes])),
  };
}

export function draftRoster(draft: TeamDraft): string[] {
  return [...draft.starters.filter((cardId) => cardId !== null), ...draft.bench];
}

export function draftToInput(draft: TeamDraft): {
  starters: string[];
  bench: string[];
  targetMinutes: Array<{ cardId: string; minutes: number }>;
} {
  const roster = draftRoster(draft);
  return {
    starters: draft.starters.filter((cardId): cardId is string => cardId !== null),
    bench: [...draft.bench],
    targetMinutes: roster.map((cardId) => ({ cardId, minutes: draft.minutes[cardId] ?? 0 })),
  };
}

export function checkDraft(
  draft: TeamDraft,
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
  owned: ReadonlySet<string>,
): CollectionTeamCheck {
  return validateCollectionActiveTeam(draftToInput(draft), resolve, owned);
}

export function firstValidationMessage(
  check: CollectionTeamCheck,
  draft: TeamDraft,
): string | null {
  if (check.ok) return null;
  const rosterSize = draftRoster(draft).length;
  const issue = check.issues[0];
  if (issue === undefined) return 'This team is not valid yet.';
  switch (issue.code) {
    case 'too-few-cards':
      return `Add ${String(5 - rosterSize)} more card${5 - rosterSize === 1 ? '' : 's'} to reach five.`;
    case 'too-many-cards':
      return 'Teams hold at most 12 cards. Remove one to continue.';
    case 'duplicate-card':
      return 'That card is already on the team.';
    case 'duplicate-player':
      return 'Two versions of the same player cannot share a team.';
    case 'unknown-card':
    case 'unowned-card':
      return 'That card is not in your collection.';
    case 'illegal-starters': {
      const emptySlots = draft.starters.filter((slot) => slot === null).length;
      if (emptySlots > 0) {
        return `Fill all five starter slots (${String(emptySlots)} empty).`;
      }
      return 'Starters must cover Guard, Guard, Forward, Forward, Center.';
    }
    case 'invalid-minutes': {
      const total = Object.values(draft.minutes).reduce((sum, value) => sum + value, 0);
      if (total !== TEAM_MINUTES_TOTAL) {
        return `Minutes must total exactly 240 (now ${String(total)}).`;
      }
      return 'Every starter needs at least one minute, at most 48 per card.';
    }
    default:
      return issue.message;
  }
}

export function blockedCardIds(
  draft: TeamDraft,
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
  candidates: readonly string[],
): Map<string, string> {
  const roster = new Set(draftRoster(draft));
  const rosterPlayers = new Set<string>();
  for (const cardId of roster) {
    const card = resolve(cardId);
    if (card !== undefined) rosterPlayers.add(card.playerId);
  }
  const blocked = new Map<string, string>();
  for (const cardId of candidates) {
    if (roster.has(cardId)) {
      blocked.set(cardId, 'Already on the team.');
      continue;
    }
    const card = resolve(cardId);
    if (card !== undefined && rosterPlayers.has(card.playerId)) {
      blocked.set(cardId, 'Another version of this player is already on the team.');
    }
  }
  return blocked;
}

export function slotEligibility(positions: readonly Position[], slotIndex: number): boolean {
  const group = STARTER_SLOT_GROUPS[slotIndex];
  if (group === undefined) return false;
  return playableSlotGroups([...positions]).includes(group);
}

export function buildAutoDraft(
  ownedCardIds: readonly string[],
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
): TeamDraft {
  return draftFromTeam(initializeCollectionActiveTeam(ownedCardIds, resolve));
}

export function balanceDraftMinutes(draft: TeamDraft): TeamDraft {
  const roster = draftRoster(draft);
  const starterIds = new Set(draft.starters.filter((cardId): cardId is string => cardId !== null));
  const balanced = allocateDefaultMinutes(
    roster.map((cardId) => ({ cardId, starter: starterIds.has(cardId) })),
  );
  return {
    ...draft,
    minutes: Object.fromEntries(balanced.map((entry) => [entry.cardId, entry.minutes])),
  };
}

export function minutesTotal(draft: TeamDraft): number {
  return draftRoster(draft).reduce((sum, cardId) => sum + (draft.minutes[cardId] ?? 0), 0);
}
