import type {
  HavocEffectiveProfile,
  HavocGameInput,
  HavocParticipant,
  HavocTeamInput,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocGameInputSchema,
  havocGameSeed,
} from '@hoop-rush/data-contracts';
import type { BuildHavocGameInputInput } from './api.ts';
import { soloToBattleInput } from './core/battle-adapters.ts';
import { havocBattleCapabilityTargets, rankedHavocStarters } from './core/battle-targets.ts';

/**
 * The frozen `havocGameInputSchema` carries no capability-target field, so the
 * per-game target assignment is a pure function of the input and is derived
 * independently by the runtime. Both sides use this function.
 */
export interface HavocCapabilityTargets {
  /** Body Snatcher owner instance id -> opponent starter instance id. */
  readonly bodySnatcher: ReadonlyMap<string, string>;
  /** The Bounty target: highest-ranked opponent starter instance id. */
  readonly bounty: string | null;
}

function opponentTeam(input: HavocGameInput): HavocTeamInput {
  return input.humanSide === 'home' ? input.away : input.home;
}

/** Opponent starters ranked by frozen original Overall, source version id, source player id. */
export function rankedHavocOpponentStarters(input: HavocGameInput): HavocParticipant[] {
  return rankedHavocStarters({ ...opponentTeam(input), side: 'home' });
}

export function havocCapabilityTargets(input: HavocGameInput): HavocCapabilityTargets {
  const targets = havocBattleCapabilityTargets(soloToBattleInput(input));
  const humanSideIndex: 0 | 1 = input.humanSide === 'home' ? 0 : 1;
  return {
    bodySnatcher: targets.bodySnatcher,
    bounty: targets.bounty[humanSideIndex],
  };
}

function unmutatedTeam(team: HavocTeamInput): HavocTeamInput {
  return {
    ...team,
    clones: [],
    starters: team.starters.map(unmutatedParticipant),
    replacements: team.replacements.map(unmutatedParticipant),
  };
}

function unmutatedParticipant(participant: HavocParticipant): HavocParticipant {
  const source = participant.source;
  const physical = participant.effective.physical;
  const effective: HavocEffectiveProfile = {
    ratings: { ...source.profile.ratings },
    tendencies: { ...source.profile.tendencies },
    physical: {
      baselineHeightInches: physical.baselineHeightInches,
      baselineHeightSource: physical.baselineHeightSource,
      heightInches: physical.baselineHeightInches,
      weightLbs: source.physical.weightLbs,
      wingspanDeltaInches: 0,
      reachUnits: 0,
    },
    authoritativeChannels: [],
  };
  return { ...participant, mutationPackage: [], effective };
}

export function buildHavocGameInput(input: BuildHavocGameInputInput): HavocGameInput {
  const { locked, gameNumber, variant } = input;
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined) {
    throw new Error(`havoc input: no schedule entry for game ${String(gameNumber)}`);
  }
  const frozen = locked.opponents.find((candidate) => candidate.opponentId === entry.opponentId);
  if (frozen === undefined) {
    throw new Error(`havoc input: schedule references unknown opponent ${entry.opponentId}`);
  }
  const human = variant === 'havoc' ? locked.human : unmutatedTeam(locked.human);
  const home = entry.humanHome ? human : frozen.team;
  const away = entry.humanHome ? frozen.team : human;
  return havocGameInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber,
    variant,
    seed: havocGameSeed(locked.runSeed, gameNumber),
    profile: locked.profile,
    humanSide: entry.humanHome ? 'home' : 'away',
    home,
    away,
    versionSet: locked.versionSet,
  } satisfies HavocGameInput);
}
