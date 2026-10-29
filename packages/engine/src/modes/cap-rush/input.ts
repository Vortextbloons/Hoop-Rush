import type {
  CapRushLockedInputs,
  HavocGameInput,
  HavocVersionSet,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  capRushGameSeed,
  havocGameInputSchema,
} from '@hoop-rush/data-contracts';

export function capRushBattleVersionSet(locked: CapRushLockedInputs): HavocVersionSet {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
    engineVersion: locked.versionSet.engineVersion,
    profileVersion: locked.versionSet.profileVersion,
    dataVersion: locked.versionSet.dataVersion,
    catalogVersion: locked.versionSet.catalogVersion,
    catalogHash: locked.versionSet.catalogHash,
    bracketHash: locked.versionSet.bracketHash,
    profileHash: locked.versionSet.profileHash,
  };
}

export function capRushHumanSideOf(
  locked: CapRushLockedInputs,
  gameNumber: number,
): 'home' | 'away' {
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined) {
    throw new Error(`cap rush input: no schedule entry for game ${String(gameNumber)}`);
  }
  return entry.humanHome ? 'home' : 'away';
}

export function buildCapRushGameInput(input: {
  readonly locked: CapRushLockedInputs;
  readonly gameNumber: number;
}): HavocGameInput {
  const { locked, gameNumber } = input;
  const entry = locked.schedule[gameNumber - 1];
  if (entry === undefined) {
    throw new Error(`cap rush input: no schedule entry for game ${String(gameNumber)}`);
  }
  const frozen = locked.opponents.find((candidate) => candidate.opponentId === entry.opponentId);
  if (frozen === undefined) {
    throw new Error(`cap rush input: schedule references unknown opponent ${entry.opponentId}`);
  }
  const humanHome = entry.humanHome;
  return havocGameInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber,
    variant: 'havoc',
    seed: capRushGameSeed(locked.runSeed, gameNumber),
    profile: locked.profile,
    humanSide: humanHome ? 'home' : 'away',
    home: humanHome ? locked.human : frozen.team,
    away: humanHome ? frozen.team : locked.human,
    versionSet: capRushBattleVersionSet(locked),
  });
}
