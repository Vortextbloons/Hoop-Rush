export type UltimateNextAction = {
  kind:
    | 'claim-starter'
    | 'finish-team'
    | 'resume-matchup'
    | 'view-result'
    | 'open-pack'
    | 'play'
    | 'browse';
  label: string;
  href: string;
  detail: string;
};

export interface UltimateNextActionInput {
  starterClaimed: boolean;
  team: { exists: boolean; valid: boolean; saved: boolean };
  pendingMatchup: boolean;
  unviewedResult: boolean;
  affordablePackId: string | null;
}

export function ultimateNextActionOf(input: UltimateNextActionInput): UltimateNextAction {
  if (!input.starterClaimed) {
    return {
      kind: 'claim-starter',
      label: 'Claim your starter',
      href: '/ultimate/run/collection',
      detail: 'Five cards and 3,000 Coins begin your run.',
    };
  }
  if (!input.team.exists || !input.team.valid || !input.team.saved) {
    return {
      kind: 'finish-team',
      label: 'Finish your team',
      href: '/ultimate/run/team',
      detail: 'Save a legal five before preparing a game.',
    };
  }
  if (input.pendingMatchup) {
    return {
      kind: 'resume-matchup',
      label: 'Resume matchup',
      href: '/ultimate/run/play',
      detail: 'Your prepared game is ready to continue.',
    };
  }
  if (input.unviewedResult) {
    return {
      kind: 'view-result',
      label: 'View result',
      href: '/ultimate/run/play',
      detail: 'Review the final score and recorded reward.',
    };
  }
  if (input.affordablePackId) {
    return {
      kind: 'open-pack',
      label: 'Open a pack',
      href: '/ultimate/run/packs',
      detail: 'Use a pack you can afford to add to the collection.',
    };
  }
  return {
    kind: 'play',
    label: 'Play a game',
    href: '/ultimate/run/play',
    detail: 'Take your saved lineup into the next matchup.',
  };
}
