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
import { compareStrings } from '../../domain/math.ts';

export interface HavocCapabilityTargets {
  readonly bodySnatcher: ReadonlyMap<string, string>;
  readonly bounty: string | null;
}

function opponentTeam(input: HavocGameInput): HavocTeamInput {
  return input.humanSide === 'home' ? input.away : input.home;
}

function humanTeam(input: HavocGameInput): HavocTeamInput {
  return input.humanSide === 'home' ? input.home : input.away;
}

export function rankedHavocOpponentStarters(input: HavocGameInput): HavocParticipant[] {
  return [...opponentTeam(input).starters].sort((a, b) => {
    const overall = b.source.originalOverall - a.source.originalOverall;
    if (overall !== 0) return overall;
    const aVersion = a.source.playerVersionId ?? a.source.playerId;
    const bVersion = b.source.playerVersionId ?? b.source.playerId;
    const version = compareStrings(aVersion, bVersion);
    if (version !== 0) return version;
    return compareStrings(a.instanceId, b.instanceId);
  });
}

export function havocCapabilityTargets(input: HavocGameInput): HavocCapabilityTargets {
  const ranked = rankedHavocOpponentStarters(input);
  const bodySnatcher = new Map<string, string>();
  const owners = humanTeam(input).starters.filter((starter) =>
    starter.mutationPackage.some((entry) => entry.mutationId === 'body-snatcher'),
  );
  owners.forEach((owner, index) => {
    const target = ranked[index];
    if (target !== undefined) bodySnatcher.set(owner.instanceId, target.instanceId);
  });
  return { bodySnatcher, bounty: ranked[0]?.instanceId ?? null };
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
