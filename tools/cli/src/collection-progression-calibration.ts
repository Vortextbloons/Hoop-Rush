import type { CollectionActiveTeam, CollectionDifficultyId } from '@hoop-rush/data-contracts';

export const PROGRESSION_TARGETS_GENERATED_AT_ISO = '2026-01-01T00:00:00.000Z';

export const PROGRESSION_CALIBRATION_TUNING_SEED_OFFSET = 0;
export const PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET = 5_000_000;

export const PROGRESSION_TARGETING_PULLS_PER_PACK = 6_000;
export const PROGRESSION_TARGETING_PULLS_PER_JOB = 250;

export const PROGRESSION_ACQUISITION_SEEDS = 32;
export const PROGRESSION_ACQUISITION_PULL_CAP = 240;
export const PROGRESSION_PURCHASE_SEEDS = 8;
export const PROGRESSION_PURCHASE_PULLS = 40;

export const PROGRESSION_FREQUENCY_SIGMA = 6;

export function progressionCalibrationSeed(index: number): string {
  return index.toString(16).padStart(32, '0');
}

export function progressionTuningSeed(index: number): string {
  return progressionCalibrationSeed(PROGRESSION_CALIBRATION_TUNING_SEED_OFFSET + index);
}

export function progressionHeldOutSeed(index: number): string {
  return progressionCalibrationSeed(PROGRESSION_CALIBRATION_HELD_OUT_SEED_OFFSET + index);
}

export interface ProgressionDrawJob {
  packId: string;
  rootSeed: string;
  targetPlayerId: string;
  multiplierBp: number;
  pullStart: number;
  pullCount: number;
}

export interface ProgressionDrawResult {
  packId: string;
  targetPlayerId: string;
  rootSeed: string;
  pullCount: number;
  ordinarySlots: number;
  guaranteedSlots: number;
  pullsWithTarget: number;
  targetSlots: number;
  rarityCounts: number[];
}

export interface ProgressionPurchaseJob {
  packId: string;
  rootSeed: string;
  targetPlayerId: string;
  multiplierBp: number;
  ownedTarget: boolean;
  pullCap: number;
}

export interface ProgressionPurchaseResult {
  packId: string;
  rootSeed: string;
  targetPlayerId: string;
  ownedTarget: boolean;
  pulls: number;
  hitPull: number | null;
  targetSlots: number;
  kept: number;
  duplicates: number;
  exchangeEarned: number;
  accepted: number;
  rejected: string[];
  auditFailures: number;
  reproductionFailures: number;
  conversionMismatches: number;
  finalRevision: number;
  finalDigest: string;
}

export interface ProgressionChallengeJob {
  kind: 'challenge';
  cohortId: string;
  challengeId: string;
  rootSeed: string;
  gameSequence: number;
  team: CollectionActiveTeam;
  mode: 'first' | 'repeat';
}

export interface ProgressionStandardJob {
  kind: 'standard';
  cohortId: string;
  difficultyId: CollectionDifficultyId;
  rootSeed: string;
  gameSequence: number;
  team: CollectionActiveTeam;
}

export type ProgressionGameJob = ProgressionChallengeJob | ProgressionStandardJob;

export interface ProgressionGameResult {
  kind: 'challenge' | 'standard';
  cohortId: string;
  challengeId: string | null;
  difficultyId: CollectionDifficultyId;
  rootSeed: string;
  gameSequence: number;
  mode: 'first' | 'repeat' | 'standard';
  failure: string | null;
  checkFailures: string[];
  outcome: 'completed' | 'forfeit' | null;
  winner: 'home' | 'away' | null;
  eventDigest: string | null;
  resultDigest: string | null;
  overtimePeriods: number;
  objectiveSelected: string | null;
  objectiveEvaluated: boolean;
  objectivePassed: boolean;
  difficultyFirstClearGranted: boolean;
  challengeFirstClearGranted: boolean;
  rewardTotal: number;
  repeatCoins: number;
  challengeComponentCoins: number;
  homeSeconds: number;
}

export interface ProgressionWorkerInput {
  manifestPath: string;
  kind: 'draws' | 'purchases' | 'games';
  jobs: unknown[];
}
