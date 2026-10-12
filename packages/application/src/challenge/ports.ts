import type { ChallengeRun, EraSimulationProfile, GameResult } from '@hoop-rush/data-contracts';
import type {
  ActiveGameAppend,
  CompletedRunIndex,
  PromoteActiveToCompletedExpectation,
  StoredRunRecord,
} from '@hoop-rush/persistence';

export interface ChallengeRunRepositoryPort {
  loadActiveRun(): Promise<StoredRunRecord | null>;
  saveActiveRun(record: StoredRunRecord): Promise<void>;
  appendActiveGame(input: ActiveGameAppend): Promise<void>;
  promoteActiveToCompleted(
    completed: StoredRunRecord,
    index: CompletedRunIndex,
    expected: PromoteActiveToCompletedExpectation,
  ): Promise<void>;
}

export interface ChallengeJobAttemptInput {
  run: ChallengeRun;
  profile: EraSimulationProfile;
}

export interface ChallengeJobSimulationInput {
  run: ChallengeRun;
  profile: EraSimulationProfile;
  startGameNumber: number;
}

export interface ChallengeJobEvents {
  onStartResult(chosenRunSeed: string): void;
  onResults(results: GameResult[]): void;
  onError(message: string): void;
}

export interface ChallengeJobPort {
  startAttempt(input: ChallengeJobAttemptInput, events: ChallengeJobEvents): void;
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
