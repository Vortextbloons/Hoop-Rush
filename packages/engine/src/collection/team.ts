import type { CollectionCatalogCard } from '@hoop-rush/data-contracts';
import { assignLineup, validateLineup } from '../domain/lineup.ts';

export interface CollectionTeamCheck {
  ok: boolean;
  issues: Array<{ code: string; cardId: string; message: string }>;
}

export function validateCollectionTeamFoundation(
  cardIds: readonly string[],
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
): CollectionTeamCheck {
  const issues: CollectionTeamCheck['issues'] = [];
  if (cardIds.length > 12) {
    issues.push({
      code: 'too-many-cards',
      cardId: '',
      message: `team has ${String(cardIds.length)} cards, max 12`,
    });
  }
  const seenCards = new Set<string>();
  for (const cardId of cardIds) {
    if (seenCards.has(cardId)) {
      issues.push({
        code: 'duplicate-card',
        cardId,
        message: `card ${cardId} appears more than once`,
      });
    }
    seenCards.add(cardId);
  }
  const seenPlayers = new Map<string, string>();
  for (const cardId of cardIds) {
    const card = resolve(cardId);
    if (card === undefined) {
      issues.push({ code: 'unknown-card', cardId, message: `unknown card ${cardId}` });
      continue;
    }
    const first = seenPlayers.get(card.playerId);
    if (first !== undefined) {
      issues.push({
        code: 'duplicate-player',
        cardId,
        message: `player ${card.playerId} already used by ${first}`,
      });
    } else {
      seenPlayers.set(card.playerId, cardId);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateCollectionPlayableFive(
  cardIds: readonly string[],
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
): CollectionTeamCheck {
  const foundation = validateCollectionTeamFoundation(cardIds, resolve);
  if (!foundation.ok) return foundation;
  if (cardIds.length < 5) {
    return {
      ok: false,
      issues: [
        {
          code: 'too-few-cards',
          cardId: '',
          message: `need at least 5 cards to play, have ${String(cardIds.length)}`,
        },
      ],
    };
  }
  const players = cardIds.slice(0, 5).map((cardId) => {
    const card = resolve(cardId);
    if (card === undefined) throw new Error(`validateCollectionPlayableFive: ${cardId}`);
    return { playerId: card.playerId, positions: card.positions };
  });
  const assignment = assignLineup(players);
  if (assignment === null) {
    return {
      ok: false,
      issues: [
        {
          code: 'no-legal-five',
          cardId: '',
          message: 'first five cards cannot fill G/G/F/F/C',
        },
      ],
    };
  }
  const lineup = {
    structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
    assignments: assignment,
  };
  const checked = validateLineup(lineup);
  if (!checked.ok) {
    return {
      ok: false,
      issues: checked.issues.map((issue) => ({
        code: issue.code,
        cardId: issue.playerId,
        message: issue.message,
      })),
    };
  }
  return { ok: true, issues: [] };
}
