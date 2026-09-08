import {
  COLLECTION_ACTIVE_TEAM_GAME_MINUTES,
  COLLECTION_ACTIVE_TEAM_MAX_SIZE,
  COLLECTION_ACTIVE_TEAM_MAX_TARGET_MINUTES,
  COLLECTION_ACTIVE_TEAM_MIN_SIZE,
  COLLECTION_TEAM_VERSION,
  collectionActiveTeamSchema,
  type CollectionActiveTeam,
  type CollectionCatalogCard,
  type PositionUnion,
} from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot, validateLineup } from '../domain/lineup.ts';
import type { SlotIndex } from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';
import type { CollectionTeamCheck } from './team.ts';

const STARTER_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4];

function overallOf(card: CollectionCatalogCard): number {
  return card.summarySource?.overallRating ?? 60;
}

function compareStrength(a: CollectionCatalogCard, b: CollectionCatalogCard): number {
  const byOverall = overallOf(b) - overallOf(a);
  if (byOverall !== 0) return byOverall;
  return a.cardId < b.cardId ? -1 : 1;
}

function slotsFeasible(
  remainingSlots: SlotIndex[],
  candidates: Array<{ playerId: string; positions: PositionUnion }>,
  usedPlayers: ReadonlySet<string>,
): boolean {
  return completionFeasible(candidates, usedPlayers, remainingSlots);
}

export const COMPLETION_PROBE_SCAN_CAP = 256;

export function completionFeasible(
  candidates: Array<{ playerId: string; positions: PositionUnion }>,
  usedPlayers: ReadonlySet<string>,
  remainingSlots: SlotIndex[],
): boolean {
  const pool = candidates.filter((candidate) => !usedPlayers.has(candidate.playerId));
  function search(index: number, taken: Set<string>): boolean {
    if (index === remainingSlots.length) return true;
    const slot = remainingSlots[index];
    if (slot === undefined) return false;
    let scanned = 0;
    for (const candidate of pool) {
      if (scanned >= COMPLETION_PROBE_SCAN_CAP) break;
      scanned += 1;
      if (taken.has(candidate.playerId)) continue;
      if (!canFillSlot(candidate.positions, slot)) continue;
      taken.add(candidate.playerId);
      if (search(index + 1, taken)) return true;
      taken.delete(candidate.playerId);
    }
    return false;
  }
  return search(0, new Set());
}

export interface ActiveTeamInput {
  starters: readonly string[];
  bench: readonly string[];
  targetMinutes: ReadonlyArray<{ cardId: string; minutes: number }>;
}

export function validateCollectionActiveTeam(
  team: ActiveTeamInput,
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
  owned: ReadonlySet<string>,
): CollectionTeamCheck {
  const issues: CollectionTeamCheck['issues'] = [];
  const roster = [...team.starters, ...team.bench];
  if (roster.length < COLLECTION_ACTIVE_TEAM_MIN_SIZE) {
    issues.push({
      code: 'too-few-cards',
      cardId: '',
      message: `need at least ${String(COLLECTION_ACTIVE_TEAM_MIN_SIZE)} cards to play, have ${String(roster.length)}`,
    });
  }
  if (roster.length > COLLECTION_ACTIVE_TEAM_MAX_SIZE) {
    issues.push({
      code: 'too-many-cards',
      cardId: '',
      message: `team has ${String(roster.length)} cards, max ${String(COLLECTION_ACTIVE_TEAM_MAX_SIZE)}`,
    });
  }
  const seenCards = new Set<string>();
  for (const cardId of roster) {
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
  let unknown = false;
  for (const cardId of roster) {
    const card = resolve(cardId);
    if (card === undefined) {
      issues.push({ code: 'unknown-card', cardId, message: `unknown card ${cardId}` });
      unknown = true;
      continue;
    }
    if (!owned.has(cardId)) {
      issues.push({ code: 'unowned-card', cardId, message: `card ${cardId} is not owned` });
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
  if (!unknown && team.starters.length === 5) {
    const players = team.starters.map((cardId) => {
      const card = resolve(cardId);
      if (card === undefined) throw new Error(`validateCollectionActiveTeam: ${cardId}`);
      return { playerId: card.playerId, positions: card.positions };
    });
    const assignment = assignLineup(players);
    if (assignment === null) {
      issues.push({
        code: 'illegal-starters',
        cardId: '',
        message: 'starters cannot fill G/G/F/F/C',
      });
    } else {
      const checked = validateLineup({
        structure: ['G', 'G', 'F', 'F', 'C'],
        assignments: assignment,
      });
      if (!checked.ok) {
        issues.push({
          code: 'illegal-starters',
          cardId: '',
          message: checked.issues[0]?.message ?? 'starters are illegal',
        });
      }
    }
  } else if (team.starters.length !== 5) {
    issues.push({
      code: 'illegal-starters',
      cardId: '',
      message: `need exactly 5 starters, have ${String(team.starters.length)}`,
    });
  }
  const minutesById = new Map<string, number>();
  for (const entry of team.targetMinutes) {
    if (minutesById.has(entry.cardId)) {
      issues.push({
        code: 'invalid-minutes',
        cardId: entry.cardId,
        message: `duplicate minutes entry ${entry.cardId}`,
      });
    }
    minutesById.set(entry.cardId, entry.minutes);
  }
  let total = 0;
  for (const cardId of roster) {
    const minutes = minutesById.get(cardId);
    if (minutes === undefined) {
      issues.push({
        code: 'invalid-minutes',
        cardId,
        message: `missing minutes entry ${cardId}`,
      });
      continue;
    }
    if (
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > COLLECTION_ACTIVE_TEAM_MAX_TARGET_MINUTES
    ) {
      issues.push({
        code: 'invalid-minutes',
        cardId,
        message: `minutes for ${cardId} must be an integer 0-48`,
      });
    }
    total += minutes;
  }
  for (const cardId of minutesById.keys()) {
    if (!seenCards.has(cardId)) {
      issues.push({
        code: 'invalid-minutes',
        cardId,
        message: `minutes entry ${cardId} is not rostered`,
      });
    }
  }
  if (total !== COLLECTION_ACTIVE_TEAM_GAME_MINUTES) {
    issues.push({
      code: 'invalid-minutes',
      cardId: '',
      message: `target minutes total ${String(total)} != ${String(COLLECTION_ACTIVE_TEAM_GAME_MINUTES)}`,
    });
  }
  for (const cardId of team.starters) {
    if ((minutesById.get(cardId) ?? 0) < 1) {
      issues.push({
        code: 'invalid-minutes',
        cardId,
        message: `starter ${cardId} needs at least one minute`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function allocateDefaultMinutes(
  roster: ReadonlyArray<{ cardId: string; starter: boolean }>,
): Array<{ cardId: string; minutes: number }> {
  const weights = roster.map((entry) => (entry.starter ? 2 : 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new CollectionCommandError('invalid-minutes', 'empty roster');
  const exact = weights.map(
    (weight) => (COLLECTION_ACTIVE_TEAM_GAME_MINUTES * weight) / totalWeight,
  );
  const floored = exact.map((share) => Math.floor(share));
  let remainder =
    COLLECTION_ACTIVE_TEAM_GAME_MINUTES - floored.reduce((sum, value) => sum + value, 0);
  const order = roster
    .map((entry, index) => ({ index, fraction: (exact[index] ?? 0) - (floored[index] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .map((entry) => entry.index);
  const minutes = [...floored];
  for (const index of order) {
    if (remainder <= 0) break;
    minutes[index] = (minutes[index] ?? 0) + 1;
    remainder -= 1;
  }
  return roster.map((entry, index) => ({ cardId: entry.cardId, minutes: minutes[index] ?? 0 }));
}

export function initializeCollectionActiveTeam(
  ownedCardIds: readonly string[],
  resolve: (cardId: string) => CollectionCatalogCard | undefined,
): CollectionActiveTeam {
  const owned: CollectionCatalogCard[] = [];
  for (const cardId of ownedCardIds) {
    const card = resolve(cardId);
    if (card === undefined) {
      throw new CollectionCommandError('missing-content', `unknown owned card ${cardId}`);
    }
    owned.push(card);
  }
  const bestByPlayer = new Map<string, CollectionCatalogCard>();
  for (const card of owned) {
    const current = bestByPlayer.get(card.playerId);
    if (current === undefined || compareStrength(card, current) < 0) {
      bestByPlayer.set(card.playerId, card);
    }
  }
  const candidates = [...bestByPlayer.values()].sort(compareStrength);
  const chosen: CollectionCatalogCard[] = [];
  const usedPlayers = new Set<string>();
  const pool = candidates.map((card) => ({
    playerId: card.playerId,
    positions: card.positions,
    card,
  }));
  for (const [slotPosition, slot] of STARTER_SLOTS.entries()) {
    let picked: CollectionCatalogCard | null = null;
    for (const candidate of pool) {
      if (usedPlayers.has(candidate.playerId)) continue;
      if (!canFillSlot(candidate.positions, slot)) continue;
      const probeUsed = new Set(usedPlayers);
      probeUsed.add(candidate.playerId);
      if (!slotsFeasible(STARTER_SLOTS.slice(slotPosition + 1), pool, probeUsed)) continue;
      picked = candidate.card;
      break;
    }
    if (picked === null) {
      throw new CollectionCommandError(
        'no-legal-five',
        `no completion-safe owned candidate fills slot ${String(slot)}`,
      );
    }
    chosen.push(picked);
    usedPlayers.add(picked.playerId);
  }
  const bench = candidates
    .filter((card) => !usedPlayers.has(card.playerId))
    .slice(0, COLLECTION_ACTIVE_TEAM_MAX_SIZE - chosen.length);
  const roster = [...chosen, ...bench];
  const starterIds = new Set(chosen.map((card) => card.cardId));
  const team = collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters: chosen.map((card) => card.cardId),
    bench: bench.map((card) => card.cardId),
    targetMinutes: allocateDefaultMinutes(
      roster.map((card) => ({ cardId: card.cardId, starter: starterIds.has(card.cardId) })),
    ),
  });
  return team;
}
