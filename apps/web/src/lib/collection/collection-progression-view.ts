import type {
  CollectionCatalog,
  CollectionChallengeDefinition,
  CollectionChallengeRequirement,
  CollectionChallengeValidationFacts,
  CollectionProgressionRules,
  CollectionSetProgressFacts,
  CollectionSetRewardDefinition,
} from '@hoop-rush/data-contracts';
import { collectionSetProgress } from '@hoop-rush/engine';

export function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function requirementLabel(
  requirement: CollectionChallengeRequirement,
  setTitleOf?: (setId: string) => string | null,
): string {
  const counts = `${String(requirement.minimumStarterCount)} ${
    requirement.minimumStarterCount === 1 ? 'starter' : 'starters'
  } and at least ${String(requirement.minimumRosterCount)} active ${
    requirement.minimumRosterCount === 1 ? 'card' : 'cards'
  }`;
  switch (requirement.kind) {
    case 'era-core':
      return `${counts} from the ${humanizeIdentifier(requirement.eraId)}`;
    case 'franchise-core':
      return `${counts} from the ${humanizeIdentifier(requirement.franchiseId)}`;
    case 'set-family-core': {
      const title = setTitleOf?.(requirement.setId) ?? humanizeIdentifier(requirement.setId);
      return `${counts} from the ${title} set`;
    }
  }
}

export function challengeProgressLabel(facts: CollectionChallengeValidationFacts): string {
  return `${String(facts.rosterCount)}/${String(facts.requiredRosterCount)} active · ${String(
    facts.starterCount,
  )}/${String(facts.requiredStarterCount)} starters`;
}

export type ChallengeNextAction = 'edit-team' | 'choose-objective';

export function challengeNextAction(input: {
  eligible: boolean;
  hasPendingGame: boolean;
}): ChallengeNextAction {
  if (!input.eligible || input.hasPendingGame) return 'edit-team';
  return 'choose-objective';
}

export function challengeStatusLabel(input: { cleared: boolean; eligible: boolean }): string {
  if (input.cleared) return 'First clear claimed · repeat reward on wins';
  return input.eligible ? 'Ready to play · first clear available' : 'Team requirement not met';
}

export function challengeEligibilityReason(
  facts: CollectionChallengeValidationFacts,
  setTitleOf?: (setId: string) => string | null,
): string {
  if (facts.teamValid && facts.success) return 'The committed team meets this requirement.';
  if (!facts.teamValid) {
    const code = facts.teamIssueCodes[0];
    const detail =
      code === undefined
        ? 'the committed team is not legal'
        : `the committed team is not legal (${code})`;
    return `Fix the team: ${detail}. Open Team, save a legal team, then come back.`;
  }
  const label = requirementLabel(facts.requirement, setTitleOf);
  const rosterShort = Math.max(0, facts.requiredRosterCount - facts.rosterCount);
  const starterShort = Math.max(0, facts.requiredStarterCount - facts.starterCount);
  if (rosterShort > 0 && starterShort > 0) {
    return `Add ${String(rosterShort)} more matching ${rosterShort === 1 ? 'card' : 'cards'} and start ${String(starterShort)} of them (${label}).`;
  }
  if (starterShort > 0) {
    return `Start ${String(starterShort)} more matching ${starterShort === 1 ? 'card' : 'cards'} (${label}).`;
  }
  return `Add ${String(rosterShort)} more matching ${rosterShort === 1 ? 'card' : 'cards'} to the active roster (${label}).`;
}

export interface SetProgressView {
  setId: string;
  title: string;
  description: string;
  currency: 'Exchange';
  amount: number;
  memberCardIds: string[];
  missingCardIds: string[];
  ownedCount: number;
  requiredCount: number;
  complete: boolean;
  claimed: boolean;
}

export function setProgressViews(input: {
  progression: CollectionProgressionRules;
  catalog: CollectionCatalog;
  ownedCardIds: ReadonlySet<string>;
  claimedSetIds: readonly string[];
}): SetProgressView[] {
  const claimed = new Set(input.claimedSetIds);
  return input.progression.setRewards.map((reward) =>
    setProgressView({
      reward,
      catalog: input.catalog,
      ownedCardIds: input.ownedCardIds,
      claimed: claimed.has(reward.setId),
    }),
  );
}

export function setProgressView(input: {
  reward: CollectionSetRewardDefinition;
  catalog: CollectionCatalog;
  ownedCardIds: ReadonlySet<string>;
  claimed: boolean;
}): SetProgressView {
  const catalogSet = input.catalog.sets.find((set) => set.setId === input.reward.setId);
  const facts: CollectionSetProgressFacts = collectionSetProgress({
    setId: input.reward.setId,
    title: catalogSet?.title ?? input.reward.title,
    memberCardIds: catalogSet?.memberCardIds ?? input.reward.memberCardIds,
    ownedCardIds: input.ownedCardIds,
  });
  return {
    setId: facts.setId,
    title: facts.title,
    description: input.reward.description,
    currency: input.reward.currency,
    amount: input.reward.amount,
    memberCardIds: facts.memberCardIds,
    missingCardIds: facts.missingCardIds,
    ownedCount: facts.ownedCount,
    requiredCount: facts.requiredCount,
    complete: facts.complete,
    claimed: input.claimed,
  };
}

export interface ChallengeRewardRow {
  kind: 'challenge-first-clear' | 'challenge-repeat-win';
  label: string;
  detail: string;
  coins: number;
}

export interface ChallengeRewardPreview {
  challengeId: string;
  cleared: boolean;
  firstClearCoins: number;
  repeatWinCoins: number;
  rows: ChallengeRewardRow[];
}

export function challengeRewardPreview(
  challenge: CollectionChallengeDefinition,
  cleared: boolean,
): ChallengeRewardPreview {
  const rows: ChallengeRewardRow[] = [
    {
      kind: 'challenge-first-clear',
      label: cleared ? 'Challenge first clear (claimed)' : 'Challenge first clear',
      detail: cleared
        ? 'This challenge is already cleared; a win pays the repeat reward only.'
        : `${String(challenge.firstClearCoins)} Coins, fixed by the challenge`,
      coins: cleared ? 0 : challenge.firstClearCoins,
    },
    {
      kind: 'challenge-repeat-win',
      label: 'Challenge repeat win',
      detail: `${String(challenge.repeatWinCoins)} Coins, fixed by the challenge`,
      coins: challenge.repeatWinCoins,
    },
  ];
  return {
    challengeId: challenge.challengeId,
    cleared,
    firstClearCoins: cleared ? 0 : challenge.firstClearCoins,
    repeatWinCoins: challenge.repeatWinCoins,
    rows,
  };
}

export interface ChallengeCardView {
  challengeId: string;
  displayName: string;
  description: string;
  requirementLabel: string;
  difficultyId: CollectionChallengeDefinition['difficultyId'];
  firstClearCoins: number;
  repeatWinCoins: number;
  cleared: boolean;
  eligible: boolean;
  progressLabel: string;
  statusLabel: string;
  nextAction: ChallengeNextAction;
  reason: string;
}

export function challengeCardView(input: {
  challenge: CollectionChallengeDefinition;
  facts: CollectionChallengeValidationFacts;
  cleared: boolean;
  hasPendingGame: boolean;
  setTitleOf?: (setId: string) => string | null;
}): ChallengeCardView {
  const eligible = input.facts.success;
  return {
    challengeId: input.challenge.challengeId,
    displayName: input.challenge.displayName,
    description: input.challenge.description,
    requirementLabel: requirementLabel(input.challenge.requirement, input.setTitleOf),
    difficultyId: input.challenge.difficultyId,
    firstClearCoins: input.challenge.firstClearCoins,
    repeatWinCoins: input.challenge.repeatWinCoins,
    cleared: input.cleared,
    eligible,
    progressLabel: challengeProgressLabel(input.facts),
    statusLabel: challengeStatusLabel({ cleared: input.cleared, eligible }),
    nextAction: challengeNextAction({ eligible, hasPendingGame: input.hasPendingGame }),
    reason: challengeEligibilityReason(input.facts, input.setTitleOf),
  };
}
