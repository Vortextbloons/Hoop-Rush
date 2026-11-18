import type {
  ActiveGameAppend,
  ChallengeRun,
  CompletedRunIndex,
  EraSimulationProfile,
  GameResult,
  PromoteActiveToCompletedExpectation,
  StoredRunRecord,
} from '@hoop-rush/data-contracts';

export interface ChallengeRunRepositoryPort {
  loadActiveRun(): Promise<StoredRunRecord | null>;
  appendActiveGames(inputs: readonly ActiveGameAppend[]): Promise<void>;
  promoteActiveToCompleted(
    completed: StoredRunRecord,
    index: CompletedRunIndex,
    expected: PromoteActiveToCompletedExpectation,
  ): Promise<void>;
}

export interface ChallengeJobSimulationInput {
  run: ChallengeRun;
  profile: EraSimulationProfile;
  startGameNumber: number;
}

export interface ChallengeJobEvents {
  onResults(results: GameResult[]): void;
  onError(message: string): void;
}

export interface ChallengeJobPort {
  startSimulation(input: ChallengeJobSimulationInput, events: ChallengeJobEvents): void;
  cancel(): void;
  dispose(): void;
}

export interface ChallengeAssetPort {
  loadEraSimulationProfile(eraId: string): Promise<EraSimulationProfile>;
}

export interface ChallengeClockPort {
  now(): number;
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}
