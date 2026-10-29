import type { HavocMutationId, HavocScoringSource } from '@hoop-rush/data-contracts';

export interface HavocFieldGoalValueInput {
  nominal: 2 | 3;
  three: boolean;
  roulette: number | null;
  fourPointDunk: boolean;
  reverseBasketball: boolean;
  heatCheck: boolean;
  putback: boolean;
  bounty: boolean;
  doubleOrNothing: boolean;
  buzzerBandit: boolean;
  coldBloodBonus?: number;
  tripleThreatBonus?: number;
}

export interface HavocFieldGoalContribution {
  source: HavocScoringSource;
  points: number;
}

export interface HavocFieldGoalValue {
  addends: Array<{ source: HavocScoringSource; points: number }>;
  multipliers: Array<{ source: HavocScoringSource; factor: 2 | 3 }>;
  points: number;
  contributions: HavocFieldGoalContribution[];
}

export function havocFieldGoalValue(input: HavocFieldGoalValueInput): HavocFieldGoalValue {
  const addends: HavocFieldGoalValue['addends'] = [];
  const multipliers: HavocFieldGoalValue['multipliers'] = [];
  const contributions: HavocFieldGoalContribution[] = [];
  let value = input.nominal;
  const add = (source: HavocScoringSource, points: number): void => {
    addends.push({ source, points });
    contributions.push({ source, points });
    value += points;
  };
  if (input.roulette !== null) add('roulette', input.roulette - input.nominal);
  if (input.reverseBasketball) add('reverse-basketball', input.three ? -2 : 1);
  if ((input.coldBloodBonus ?? 0) > 0) add('cold-blooded', input.coldBloodBonus ?? 0);
  if ((input.tripleThreatBonus ?? 0) > 0) add('triple-threat', input.tripleThreatBonus ?? 0);
  const multiply = (source: HavocScoringSource, factor: 2 | 3): void => {
    multipliers.push({ source, factor });
    contributions.push({ source, points: value * (factor - 1) });
    value *= factor;
  };
  if (input.heatCheck) multiply('heat-check', 2);
  else if (input.putback) multiply('second-chance-jackpot', 2);
  else if (input.bounty) multiply('the-bounty', 3);
  else if (input.doubleOrNothing) multiply('double-or-nothing', 2);
  else if (input.buzzerBandit) multiply('buzzer-bandit', 2);
  if (input.fourPointDunk) add('four-point-dunk', 1);
  return { addends, multipliers, points: value, contributions };
}

export function fieldGoalAttributions<T extends { instanceId: string }>(
  contributions: readonly HavocFieldGoalContribution[],
  shooter: T,
  reverseOwners: readonly T[],
  doubleOwners: readonly T[],
): {
  ownerIds: string[];
  attributions: Array<{ owner: T; mutationId: HavocScoringSource; points: number }>;
} {
  const attributions: Array<{ owner: T; mutationId: HavocScoringSource; points: number }> = [];
  const ownerIds: string[] = [];
  const pushOwner = (participant: T): void => {
    if (!ownerIds.includes(participant.instanceId)) ownerIds.push(participant.instanceId);
  };
  for (const contribution of contributions) {
    const owners =
      contribution.source === 'reverse-basketball'
        ? reverseOwners
        : contribution.source === 'roulette' ||
            contribution.source === 'four-point-dunk' ||
            contribution.source === 'second-chance-jackpot' ||
            contribution.source === 'the-bounty' ||
            contribution.source === 'heat-check' ||
            contribution.source === 'cold-blooded' ||
            contribution.source === 'triple-threat' ||
            contribution.source === 'buzzer-bandit'
          ? [shooter]
          : doubleOwners;
    const primary = owners[0];
    if (primary === undefined) continue;
    if (
      contribution.source === 'reverse-basketball' ||
      contribution.source === 'double-or-nothing'
    ) {
      for (const owner of owners) pushOwner(owner);
    } else {
      pushOwner(primary);
    }
    attributions.push({
      owner: primary,
      mutationId: contribution.source,
      points: contribution.points,
    });
  }
  return { ownerIds, attributions };
}

export const HAVOC_SCORING_SOURCE_MUTATION: Record<HavocScoringSource, HavocMutationId> = {
  roulette: 'basketball-roulette',
  'four-point-dunk': 'four-point-dunk',
  'reverse-basketball': 'reverse-basketball',
  'golden-assist': 'golden-assist',
  'double-or-nothing': 'double-or-nothing',
  'heat-check': 'heat-check',
  'second-chance-jackpot': 'second-chance-jackpot',
  'the-bounty': 'the-bounty',
  'buzzer-bandit': 'buzzer-bandit',
  'charity-casino': 'charity-casino',
  'cold-blooded': 'cold-blooded',
  'triple-threat': 'triple-threat',
};
