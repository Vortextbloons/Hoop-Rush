import type {
  ChallengeRun,
  EraSimulationProfile,
  GameResult,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  createChallenge,
  createGameInput,
  simulateChallenge,
  type ChallengeCreation,
} from '../../challenge/commands.ts';
import { deriveAttemptSeed } from '../../challenge/seeds.ts';
import { createGameBatchSimulator } from '../../sim/game.ts';
import type { EngineContext } from '../../sim/kernel.ts';
export const BEST_OF_ATTEMPTS = 2;
export interface RunScore {
  wins: number;
  differential: number;
}
export function scoreRun(run: ChallengeRun): RunScore {
  let differential = 0;
  for (const game of run.games) {
    differential += game.home.box.points - game.away.box.points;
  }
  return { wins: run.aggregates.team.wins, differential };
}
function isBetterScore(candidate: RunScore, current: RunScore): boolean {
  const winsBetter = candidate.wins > current.wins;
  const winsTied = candidate.wins === current.wins;
  const differentialBetter = candidate.differential > current.differential;
  return winsBetter || (winsTied && differentialBetter);
}
export function chooseBestRun(runs: readonly ChallengeRun[]): ChallengeRun {
  const [first, ...rest] = runs;
  if (!first) {
    throw new Error('chooseBestRun requires at least one attempt run');
  }
  let best: ChallengeRun = first;
  let bestScore = scoreRun(first);
  for (const candidate of rest) {
    const candidateScore = scoreRun(candidate);
    if (isBetterScore(candidateScore, bestScore)) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}
export function simulateChallengeAttempts(
  creation: ChallengeCreation,
  profile: EraSimulationProfile,
  context: EngineContext,
  attempts: number = BEST_OF_ATTEMPTS,
): ChallengeRun[] {
  const runs: ChallengeRun[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptRun = createChallenge({
      ...creation,
      runSeed: deriveAttemptSeed(creation.runSeed, attempt),
    });
    runs.push(simulateChallenge(attemptRun, profile, context));
  }
  return runs;
}
export function simulateChallengeBestOf(
  creation: ChallengeCreation,
  profile: EraSimulationProfile,
  context: EngineContext,
  attempts: number = BEST_OF_ATTEMPTS,
): ChallengeRun {
  return chooseBestRun(simulateChallengeAttempts(creation, profile, context, attempts));
}
export interface BestOfChoice {
  chosenRunSeed: Seed;
  chosenWins: number;
  chosenLosses: number;
  chosenDifferential: number;
}
export interface BestOfSelection extends BestOfChoice {
  /** The chosen attempt's games in game order, so callers need not re-simulate them. */
  chosenGames: GameResult[];
}
interface AttemptOutcome {
  seed: Seed;
  score: RunScore;
  games: GameResult[] | null;
}
function chooseBestAttempt(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
  retainGames: boolean,
): AttemptOutcome {
  const simulate = createGameBatchSimulator(context);
  let best: AttemptOutcome | null = null;
  for (let attempt = 0; attempt < BEST_OF_ATTEMPTS; attempt += 1) {
    const attemptSeed = deriveAttemptSeed(run.runSeed, attempt);
    const attemptRun = { ...run, runSeed: attemptSeed };
    let wins = 0;
    let differential = 0;
    const games: GameResult[] | null = retainGames ? [] : null;
    for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
      const input = createGameInput(attemptRun, profile, gameNumber);
      const result = simulate(input);
      games?.push(result);
      const pointsDiff = result.home.box.points - result.away.box.points;
      if (pointsDiff > 0) wins += 1;
      differential += pointsDiff;
    }
    const score: RunScore = { wins, differential };
    if (best === null || isBetterScore(score, best.score)) {
      best = { seed: attemptSeed, score, games };
    }
  }
  if (best === null) {
    throw new Error('chooseBestRunSeed requires at least one attempt');
  }
  return best;
}
function choiceOf(attempt: AttemptOutcome): BestOfChoice {
  return {
    chosenRunSeed: attempt.seed,
    chosenWins: attempt.score.wins,
    chosenLosses: 82 - attempt.score.wins,
    chosenDifferential: attempt.score.differential,
  };
}
export function chooseBestRunSeed(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): BestOfChoice {
  return choiceOf(chooseBestAttempt(run, profile, context, false));
}
/**
 * Same selection as {@link chooseBestRunSeed}, but returns the winning attempt's
 * games so a caller that immediately replays the chosen run does not simulate the
 * same 82 seeded games twice. At most one attempt's games are retained.
 */
export function chooseBestRunSeedWithGames(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): BestOfSelection {
  const best = chooseBestAttempt(run, profile, context, true);
  return { ...choiceOf(best), chosenGames: best.games ?? [] };
}
