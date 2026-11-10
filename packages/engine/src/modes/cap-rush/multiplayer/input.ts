import type {
  CapRushLeagueScheduleEntry,
  CapRushMultiplayerLockedInputs,
  CapRushPlayoffGamePlan,
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocTeamInput,
  HavocVersionSet,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  capRushLeagueGameSeed,
  capRushPlayoffGameSeed,
  havocBattleInputSchema,
} from '@hoop-rush/data-contracts';
import { capRushMultiplayerTeamById } from './locked.ts';
import { capRushPlayoffTeam } from '../playoff.ts';

export function capRushMultiplayerBattleVersionSet(
  locked: CapRushMultiplayerLockedInputs,
): HavocVersionSet {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
    engineVersion: locked.versionLocks.engineVersion,
    profileVersion: locked.versionLocks.profileVersion,
    dataVersion: locked.versionLocks.dataVersion,
    catalogVersion: locked.versionLocks.catalogVersion,
    catalogHash: locked.versionLocks.catalogHash,
    bracketHash: locked.versionLocks.bracketHash,
    profileHash: locked.versionLocks.profileHash,
  };
}

function battleTeamOf(team: HavocTeamInput, side: 'home' | 'away'): HavocBattleTeamInput {
  return { ...team, side };
}

export function capRushMultiplayerGameInputFor(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly entry: CapRushLeagueScheduleEntry;
}): HavocBattleInput {
  const home = capRushMultiplayerTeamById(input.locked, input.entry.homeTeamId);
  const away = capRushMultiplayerTeamById(input.locked, input.entry.awayTeamId);
  return havocBattleInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: input.entry.slot,
    variant: 'havoc',
    seed: capRushLeagueGameSeed(input.locked.rootSeed, input.entry.gameId),
    profile: input.locked.profile,
    home: battleTeamOf(home, 'home'),
    away: battleTeamOf(away, 'away'),
    versionSet: capRushMultiplayerBattleVersionSet(input.locked),
  });
}

function playoffGameNumber(plan: CapRushPlayoffGamePlan): number {
  const index = (plan.round - 1) * 56 + plan.seriesSlot * 7 + plan.gameOrdinal - 1;
  return (index % 82) + 1;
}

export function capRushMultiplayerPlayoffInputFor(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly plan: CapRushPlayoffGamePlan;
}): HavocBattleInput {
  const performance = input.locked.playoffPerformance?.p1;
  const home = capRushPlayoffTeam({
    team: capRushMultiplayerTeamById(input.locked, input.plan.homeTeamId),
    performance,
  });
  const away = capRushPlayoffTeam({
    team: capRushMultiplayerTeamById(input.locked, input.plan.awayTeamId),
    performance,
  });
  return havocBattleInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: playoffGameNumber(input.plan),
    variant: 'havoc',
    seed: capRushPlayoffGameSeed(
      input.locked.rootSeed,
      input.plan.round,
      input.plan.seriesSlot,
      input.plan.gameOrdinal,
    ),
    profile: input.locked.profile,
    home: battleTeamOf(home, 'home'),
    away: battleTeamOf(away, 'away'),
    versionSet: capRushMultiplayerBattleVersionSet(input.locked),
  });
}
