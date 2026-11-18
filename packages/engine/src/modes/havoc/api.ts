import type { HavocCommandOutcome } from '@hoop-rush/data-contracts';
import type {
  HavocCatalog,
  HavocComparison,
  HavocDraftOffer,
  HavocGameResult,
  HavocLockedInputs,
  HavocMutationDefinition,
  HavocMutationId,
  HavocRunState,
  HavocVariant,
  OpponentBracket,
  EraSimulationProfile,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import type { Rng } from '../../sim/rng.ts';

export class HavocCatalogCoverageError extends Error {
  readonly code = 'catalog-coverage';
  readonly slot: Position;

  constructor(slot: Position, message: string) {
    super(`havoc catalog coverage failed for ${slot}: ${message}`);
    this.name = 'HavocCatalogCoverageError';
    this.slot = slot;
  }
}

export interface HavocDraftEnvironment {
  readonly rngFactory: (seed: string) => Rng;
  readonly definitions: readonly HavocMutationDefinition[];
  readonly catalog?: HavocCatalog;
}

export interface GenerateHavocOfferInput {
  readonly catalog: HavocCatalog;
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerIndex: number;
  readonly draftedClaimKeys: readonly string[];
  readonly rerollUsed: boolean;
  readonly ownedTeamExclusiveMutationIds?: readonly HavocMutationId[];
}

export type GenerateHavocOffer = (
  input: GenerateHavocOfferInput,
  environment: HavocDraftEnvironment,
) => HavocDraftOffer;

export interface HavocLockSources {
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
}

export type { HavocCommandOutcome } from '@hoop-rush/data-contracts';

export interface BuildHavocGameInputInput {
  readonly locked: HavocLockedInputs;
  readonly gameNumber: number;
  readonly variant: HavocVariant;
}

export interface HavocStoredGame {
  readonly gameNumber: number;
  readonly result: HavocGameResult;
  readonly resultDigest: string;
}

export interface CompareHavocSeasonsInput {
  readonly runId: string;
  readonly locked: HavocLockedInputs;
  readonly havocGames: readonly HavocStoredGame[];
  readonly normalGames: readonly HavocStoredGame[];
}

export interface DeriveHavocReportInput {
  readonly state: HavocRunState;
  readonly havocGames: readonly HavocStoredGame[];
  readonly normalGames: readonly HavocStoredGame[];
  readonly comparison: HavocComparison | null;
}
