import {
  COLLECTION_CHALLENGE_VERSION,
  collectionChallengeValidationFactsSchema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionChallengeRequirement,
  type CollectionChallengeValidationFacts,
  type PositionUnion,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import { canFillSlot } from '../domain/lineup.ts';
import { validateCollectionActiveTeam } from './active-team.ts';
import { CollectionCommandError } from './packs.ts';
import type { CollectionTeamCheck } from './team.ts';

export const CHALLENGE_FEASIBILITY_NODE_BUDGET = 50_000;

export function challengeRequirementMatches(
  card: CollectionCatalogCard,
  requirement: CollectionChallengeRequirement,
  catalog: CollectionCatalog,
): boolean {
  switch (requirement.kind) {
    case 'era-core':
      return card.eraId === requirement.eraId;
    case 'franchise-core':
      return card.franchiseId === requirement.franchiseId;
    case 'set-family-core': {
      const set = catalog.sets.find((entry) => entry.setId === requirement.setId);
      return set !== undefined && set.memberCardIds.includes(card.cardId);
    }
  }
}

export function challengeRequirementReferenceExists(
  requirement: CollectionChallengeRequirement,
  catalog: CollectionCatalog,
): boolean {
  switch (requirement.kind) {
    case 'era-core':
      return catalog.cards.some((card) => card.eraId === requirement.eraId);
    case 'franchise-core':
      return catalog.cards.some((card) => card.franchiseId === requirement.franchiseId);
    case 'set-family-core':
      return catalog.sets.some((set) => set.setId === requirement.setId);
  }
}

export function challengeRequirementMatchingCards(
  requirement: CollectionChallengeRequirement,
  catalog: CollectionCatalog,
): CollectionCatalogCard[] {
  return catalog.cards.filter((card) => challengeRequirementMatches(card, requirement, catalog));
}

export interface CollectionChallengeTeamCheck {
  facts: CollectionChallengeValidationFacts;
  teamCheck: CollectionTeamCheck;
}

export function validateCollectionChallengeTeam(input: {
  definition: CollectionChallengeDefinition;
  team: CollectionActiveTeam;
  catalog: CollectionCatalog;
  ownedCardIds: ReadonlySet<string>;
}): CollectionChallengeTeamCheck {
  const { definition, team, catalog, ownedCardIds } = input;
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  const resolve = (cardId: string): CollectionCatalogCard | undefined => byId.get(cardId);
  const teamCheck = validateCollectionActiveTeam(team, resolve, ownedCardIds);
  const roster = [...team.starters, ...team.bench];
  const starterIds = new Set(team.starters);
  const activeRoster = roster.map((cardId) => ({
    cardId,
    playerId: byId.get(cardId)?.playerId ?? '',
    starter: starterIds.has(cardId),
  }));
  const matchingCardIds: string[] = [];
  for (const cardId of roster) {
    const card = byId.get(cardId);
    if (card === undefined) continue;
    if (challengeRequirementMatches(card, definition.requirement, catalog)) {
      matchingCardIds.push(cardId);
    }
  }
  matchingCardIds.sort();
  const matchingStarterIds = matchingCardIds.filter((cardId) => starterIds.has(cardId)).sort();
  const requirementMet =
    matchingCardIds.length >= definition.requirement.minimumRosterCount &&
    matchingStarterIds.length >= definition.requirement.minimumStarterCount;
  const success = teamCheck.ok && requirementMet;
  const failureCode = success
    ? null
    : teamCheck.ok
      ? 'challenge-roster-requirement'
      : 'challenge-team-invalid';
  const facts = collectionChallengeValidationFactsSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: definition.challengeId,
    requirement: definition.requirement,
    activeRoster,
    matchingCardIds,
    matchingStarterIds,
    rosterCount: matchingCardIds.length,
    starterCount: matchingStarterIds.length,
    requiredRosterCount: definition.requirement.minimumRosterCount,
    requiredStarterCount: definition.requirement.minimumStarterCount,
    teamValid: teamCheck.ok,
    teamIssueCodes: teamCheck.issues.map((issue) => issue.code),
    success,
    failureCode,
  });
  return { facts, teamCheck };
}

interface FeasibilityCandidate {
  playerId: string;
  positions: PositionUnion;
}

function distinctMatchingPlayers(
  requirement: CollectionChallengeRequirement,
  catalog: CollectionCatalog,
): FeasibilityCandidate[] {
  const byPlayer = new Map<string, FeasibilityCandidate>();
  for (const card of challengeRequirementMatchingCards(requirement, catalog)) {
    if (!byPlayer.has(card.playerId)) {
      byPlayer.set(card.playerId, { playerId: card.playerId, positions: card.positions });
    }
  }
  return [...byPlayer.values()].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
}

export interface CollectionChallengeFeasibility {
  ok: boolean;
  failures: string[];
  matchingPlayerCount: number;
}

const STARTER_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4];

function legalFiveWithMatchingStarters(
  catalog: CollectionCatalog,
  matching: FeasibilityCandidate[],
  minimumStarterCount: number,
): boolean {
  const allCandidates: FeasibilityCandidate[] = catalog.cards.map((card) => ({
    playerId: card.playerId,
    positions: card.positions,
  }));
  const matchingById = new Map(matching.map((candidate) => [candidate.playerId, candidate]));
  let nodes = 0;
  const search = (slotPosition: number, used: Set<string>, matchingUsed: number): boolean => {
    if (slotPosition === STARTER_SLOTS.length) {
      return matchingUsed >= minimumStarterCount;
    }
    if (matchingUsed + (STARTER_SLOTS.length - slotPosition) < minimumStarterCount) {
      return false;
    }
    if (nodes >= CHALLENGE_FEASIBILITY_NODE_BUDGET) return false;
    const slot = STARTER_SLOTS[slotPosition];
    if (slot === undefined) return false;
    const ordered = [
      ...matching.filter((candidate) => !used.has(candidate.playerId)),
      ...allCandidates.filter((candidate) => !matchingById.has(candidate.playerId)),
    ];
    let scanned = 0;
    for (const candidate of ordered) {
      if (scanned >= 512) break;
      scanned += 1;
      if (used.has(candidate.playerId)) continue;
      if (!canFillSlot(candidate.positions, slot)) continue;
      nodes += 1;
      if (nodes >= CHALLENGE_FEASIBILITY_NODE_BUDGET) return false;
      used.add(candidate.playerId);
      const isMatching = matchingById.has(candidate.playerId);
      if (search(slotPosition + 1, used, matchingUsed + (isMatching ? 1 : 0))) {
        used.delete(candidate.playerId);
        return true;
      }
      used.delete(candidate.playerId);
    }
    return false;
  };
  return search(0, new Set(), 0);
}

export function checkCollectionChallengeFeasibility(
  definition: CollectionChallengeDefinition,
  catalog: CollectionCatalog,
): CollectionChallengeFeasibility {
  const failures: string[] = [];
  const requirement = definition.requirement;
  if (!challengeRequirementReferenceExists(requirement, catalog)) {
    failures.push(`challenge ${definition.challengeId} references unknown content`);
  }
  const matching = distinctMatchingPlayers(requirement, catalog);
  if (matching.length < requirement.minimumRosterCount) {
    failures.push(
      `challenge ${definition.challengeId} needs ${String(requirement.minimumRosterCount)} distinct matching players, has ${String(matching.length)}`,
    );
  }
  const distinctPlayers = new Set(catalog.cards.map((card) => card.playerId)).size;
  if (distinctPlayers < requirement.minimumRosterCount) {
    failures.push(
      `challenge ${definition.challengeId} needs ${String(requirement.minimumRosterCount)} distinct roster players, catalog has ${String(distinctPlayers)}`,
    );
  }
  if (!legalFiveWithMatchingStarters(catalog, matching, requirement.minimumStarterCount)) {
    failures.push(
      `challenge ${definition.challengeId} cannot field a legal five with ${String(requirement.minimumStarterCount)} matching starters`,
    );
  }
  return { ok: failures.length === 0, failures, matchingPlayerCount: matching.length };
}

export function assertCollectionChallengeFeasible(
  definition: CollectionChallengeDefinition,
  catalog: CollectionCatalog,
): void {
  const result = checkCollectionChallengeFeasibility(definition, catalog);
  if (!result.ok) {
    throw new CollectionCommandError('invalid-definition', result.failures.join('; '));
  }
}
