import type {
  HavocCatalog,
  HavocCatalogSource,
  HavocCommand,
  HavocCommandResult,
  HavocComparison,
  HavocCreateDraftCommand,
  HavocDraftOffer,
  HavocGameAudit,
  HavocGameInput,
  HavocGameResult,
  HavocGameSummary,
  HavocGameTape,
  HavocLockedInputs,
  HavocMutationDefinition,
  HavocReport,
  HavocRunState,
  HavocSeasonAggregate,
  HavocVariant,
  OpponentBracket,
  EraSimulationProfile,
  Position,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
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
}

export type AdaptHavocCatalog = (
  catalog: SeasonDraftCatalog,
  source: HavocCatalogSource,
) => HavocCatalog;

export interface GenerateHavocOfferInput {
  readonly catalog: HavocCatalog;
  readonly runSeed: Seed;
  readonly round: number;
  readonly slot: Position;
  readonly offerIndex: number;
  readonly draftedClaimKeys: readonly string[];
  readonly rerollUsed: boolean;
}

export type GenerateHavocOffer = (
  input: GenerateHavocOfferInput,
  environment: HavocDraftEnvironment,
) => HavocDraftOffer;

export interface HavocLockSources {
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
}

export interface HavocCommandOutcome {
  readonly state: HavocRunState;
  readonly result: HavocCommandResult;
}

export type CreateHavocRunState = (
  command: HavocCreateDraftCommand,
  catalog: HavocCatalog,
  environment: HavocDraftEnvironment,
) => HavocRunState;

export type ApplyHavocCommand = (
  state: HavocRunState,
  command: HavocCommand,
  environment: HavocDraftEnvironment,
  lockSources: HavocLockSources,
) => HavocCommandOutcome;

export type FoldHavocAggregate = (
  aggregate: HavocSeasonAggregate,
  summary: HavocGameSummary,
) => HavocSeasonAggregate;

export type HavocStateDigest = (state: HavocRunState) => string;

export interface BuildHavocGameInputInput {
  readonly locked: HavocLockedInputs;
  readonly gameNumber: number;
  readonly variant: HavocVariant;
}

export type BuildHavocGameInput = (input: BuildHavocGameInputInput) => HavocGameInput;

export interface HavocGameSimulation {
  readonly result: HavocGameResult;
  readonly tape: HavocGameTape;
}

export type SimulateHavocGame = (
  input: HavocGameInput,
  context: EngineContext,
) => HavocGameSimulation;

export type HavocGameInputDigest = (input: HavocGameInput) => string;

export type HavocGameResultDigest = (result: HavocGameResult) => string;

export type HavocGameTapeDigest = (tape: HavocGameTape) => string;

export type HavocGameSummaryOf = (
  result: HavocGameResult,
  resultDigest: string,
) => HavocGameSummary;

export type AuditHavocGame = (
  input: HavocGameInput,
  result: HavocGameResult,
  tape?: HavocGameTape,
) => HavocGameAudit;

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

export type CompareHavocSeasons = (input: CompareHavocSeasonsInput) => HavocComparison;

export interface DeriveHavocReportInput {
  readonly state: HavocRunState;
  readonly havocGames: readonly HavocStoredGame[];
  readonly normalGames: readonly HavocStoredGame[];
  readonly comparison: HavocComparison | null;
}

export type DeriveHavocReport = (input: DeriveHavocReportInput) => HavocReport;
