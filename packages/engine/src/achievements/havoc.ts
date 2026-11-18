import type { HavocGameResult, HavocMutationId } from '@hoop-rush/data-contracts';
import {
  HAVOC_TIER_ONE_MUTATION_IDS,
  HAVOC_TIER_THREE_MUTATION_IDS,
  HAVOC_TIER_TWO_MUTATION_IDS,
} from '@hoop-rush/data-contracts';

/**
 * Pure Havoc achievement evaluation.
 *
 * `havocAchievementFactsFromRun` maps the run totals, the locked starting five,
 * stored Havoc results, and the matched comparison into the facts below. The
 * evaluator never reads saves, workers, clocks, or RNG.
 */

export const HAVOC_ACHIEVEMENT_IDS = [
  'the-curry-effect',
  'the-dynasty-effect',
  'all-star-game-numbers',
  'wilt-chamberlain-mode',
  'better-without-the-boost',
  'the-monstars',
  'space-jam',
  'manu-off-the-bench',
  // `built-different` belongs to the legacy multiplayer achievement.
  'havoc-built-different',
] as const;

export type HavocAchievementId = (typeof HAVOC_ACHIEVEMENT_IDS)[number];

export interface HavocAchievement {
  id: HavocAchievementId;
  evidence: string;
}

export interface HavocParticipantFacts {
  instanceId: string;
  kind: 'starter' | 'replacement' | 'clone';
  displayName: string;
  points: number;
}

export interface HavocBodySnatcherFacts {
  instanceId: string;
  displayName: string | null;
  /** Points the owner scored while the stolen body was active. */
  swapPoints: number;
}

export interface HavocGameFacts {
  gameNumber: number;
  /** Human team's final score. */
  humanPoints: number;
  /** Human-side participant lines only. */
  participants: readonly HavocParticipantFacts[];
  bodySnatcher: HavocBodySnatcherFacts | null;
}

export interface HavocComparisonFacts {
  matchedGames: number;
  havocWins: number;
  normalWins: number;
  winsGained: number;
  havocWinsNormalLosses: number;
}

export interface HavocAchievementFacts {
  seasonGames: number;
  wins: number;
  losses: number;
  /** Havoc-variant games only, in game-number order. */
  games: readonly HavocGameFacts[];
  /** Mutation ids owned by the human starting five. */
  mutationIds: readonly HavocMutationId[];
  comparison: HavocComparisonFacts | null;
}

export interface HavocRunTotalsSource {
  games: number;
  wins: number;
  losses: number;
}

export interface HavocStarterSource {
  mutationPackage: readonly { mutationId: HavocMutationId }[];
}

export interface HavocGameSource {
  result: HavocGameResult;
}

export interface HavocComparisonSource {
  havoc: { wins: number };
  normal: { wins: number };
  winsGained: number;
  games: readonly { flips: { havocWinNormalLoss: boolean } }[];
}

export interface HavocRunSource {
  totals: HavocRunTotalsSource;
  starters: readonly HavocStarterSource[];
  havocGames: readonly HavocGameSource[];
  comparison?: HavocComparisonSource | null | undefined;
}

function mutationTierOf(mutationId: HavocMutationId): 1 | 2 | 3 | null {
  if (HAVOC_TIER_ONE_MUTATION_IDS.some((candidate) => candidate === mutationId)) return 1;
  if (HAVOC_TIER_TWO_MUTATION_IDS.some((candidate) => candidate === mutationId)) return 2;
  if (HAVOC_TIER_THREE_MUTATION_IDS.some((candidate) => candidate === mutationId)) return 3;
  return null;
}

export function havocAchievementFactsFromRun(input: HavocRunSource): HavocAchievementFacts {
  const games = input.havocGames
    .map((game) => game.result)
    .filter((result) => result.variant === 'havoc')
    .sort((left, right) => left.gameNumber - right.gameNumber)
    .map((result) => {
      const human = result.humanSide === 'home' ? result.home : result.away;
      let bodySnatcher: HavocBodySnatcherFacts | null = null;
      for (const rollup of result.rollups) {
        if (rollup.side !== 'human' || rollup.mutationId !== 'body-snatcher') continue;
        if (bodySnatcher !== null && bodySnatcher.swapPoints >= rollup.swapPoints) continue;
        const line = human.participants.find(
          (participant) => participant.instanceId === rollup.ownerInstanceId,
        );
        bodySnatcher = {
          instanceId: rollup.ownerInstanceId,
          displayName: line?.displayName ?? null,
          swapPoints: rollup.swapPoints,
        };
      }
      return {
        gameNumber: result.gameNumber,
        humanPoints: human.points,
        participants: human.participants.map((line) => ({
          instanceId: line.instanceId,
          kind: line.kind,
          displayName: line.displayName,
          points: line.points,
        })),
        bodySnatcher,
      };
    });
  return {
    seasonGames: input.totals.games,
    wins: input.totals.wins,
    losses: input.totals.losses,
    games,
    mutationIds: input.starters.flatMap((starter) =>
      starter.mutationPackage.map((entry) => entry.mutationId),
    ),
    comparison:
      input.comparison === undefined || input.comparison === null
        ? null
        : {
            matchedGames: input.comparison.games.length,
            havocWins: input.comparison.havoc.wins,
            normalWins: input.comparison.normal.wins,
            winsGained: input.comparison.winsGained,
            havocWinsNormalLosses: input.comparison.games.filter(
              (game) => game.flips.havocWinNormalLoss,
            ).length,
          },
  };
}

interface CloneOutscoringFacts {
  game: HavocGameFacts;
  clone: HavocParticipantFacts;
  outscored: readonly HavocParticipantFacts[];
}

function cloneOutscoringThreeStarters(
  games: readonly HavocGameFacts[],
): CloneOutscoringFacts | null {
  for (const game of games) {
    const starters = game.participants.filter((participant) => participant.kind === 'starter');
    for (const clone of game.participants) {
      if (clone.kind !== 'clone') continue;
      const outscored = starters.filter((starter) => starter.points < clone.points);
      if (outscored.length >= 3) return { game, clone, outscored };
    }
  }
  return null;
}

export function evaluateHavocAchievements(facts: HavocAchievementFacts): HavocAchievement[] {
  const unlocks: HavocAchievement[] = [];
  const comparison = facts.comparison;

  if (comparison !== null && comparison.havocWinsNormalLosses >= 25) {
    unlocks.push({
      id: 'the-curry-effect',
      evidence:
        `${String(comparison.havocWinsNormalLosses)} of ${String(comparison.matchedGames)} ` +
        'matched games flipped from a Normal loss to a Havoc win',
    });
  }

  if (comparison !== null && comparison.winsGained >= 40) {
    unlocks.push({
      id: 'the-dynasty-effect',
      evidence:
        `Havoc won ${String(comparison.winsGained)} more games than Normal ` +
        `(${String(comparison.havocWins)} to ${String(comparison.normalWins)})`,
    });
  }

  const allStarGame = facts.games.find((game) => game.humanPoints >= 200);
  if (allStarGame !== undefined) {
    unlocks.push({
      id: 'all-star-game-numbers',
      evidence: `Scored ${String(allStarGame.humanPoints)} points in Havoc game ${String(allStarGame.gameNumber)}`,
    });
  }

  let wilt: { game: HavocGameFacts; player: HavocParticipantFacts } | null = null;
  for (const game of facts.games) {
    const player = game.participants.find((participant) => participant.points >= 100);
    if (player !== undefined) {
      wilt = { game, player };
      break;
    }
  }
  if (wilt !== null) {
    unlocks.push({
      id: 'wilt-chamberlain-mode',
      evidence: `${wilt.player.displayName} scored ${String(wilt.player.points)} points in Havoc game ${String(wilt.game.gameNumber)}`,
    });
  }

  if (comparison !== null && comparison.normalWins > comparison.havocWins) {
    unlocks.push({
      id: 'better-without-the-boost',
      evidence: `Normal won ${String(comparison.normalWins)} games to Havoc's ${String(comparison.havocWins)}`,
    });
  }

  if (facts.seasonGames === 82 && facts.wins === 82 && facts.losses === 0) {
    unlocks.push({
      id: 'the-monstars',
      evidence: 'Finished the Havoc season 82-0',
    });
  }

  let spaceJam: { game: HavocGameFacts; bodySnatcher: HavocBodySnatcherFacts } | null = null;
  for (const game of facts.games) {
    if (game.bodySnatcher !== null && game.bodySnatcher.swapPoints >= 40) {
      spaceJam = { game, bodySnatcher: game.bodySnatcher };
      break;
    }
  }
  if (spaceJam !== null) {
    unlocks.push({
      id: 'space-jam',
      evidence:
        `${spaceJam.bodySnatcher.displayName ?? 'Body Snatcher'} scored ` +
        `${String(spaceJam.bodySnatcher.swapPoints)} points in a stolen body ` +
        `in game ${String(spaceJam.game.gameNumber)}`,
    });
  }

  const manu = cloneOutscoringThreeStarters(facts.games);
  if (manu !== null) {
    unlocks.push({
      id: 'manu-off-the-bench',
      evidence:
        `Clone ${manu.clone.displayName} scored ${String(manu.clone.points)} points, ` +
        `outscoring ${String(manu.outscored.length)} original starters ` +
        `in game ${String(manu.game.gameNumber)}`,
    });
  }

  if (facts.seasonGames === 82 && facts.wins >= 75) {
    const tierOwner = new Map<1 | 2 | 3, HavocMutationId>();
    for (const mutationId of facts.mutationIds) {
      const tier = mutationTierOf(mutationId);
      if (tier !== null && !tierOwner.has(tier)) tierOwner.set(tier, mutationId);
    }
    const tierOne = tierOwner.get(1);
    const tierTwo = tierOwner.get(2);
    const tierThree = tierOwner.get(3);
    if (tierOne !== undefined && tierTwo !== undefined && tierThree !== undefined) {
      unlocks.push({
        id: 'havoc-built-different',
        evidence:
          `Won ${String(facts.wins)} games with tier-1 ${tierOne}, ` +
          `tier-2 ${tierTwo}, and tier-3 ${tierThree} mutations`,
      });
    }
  }

  return unlocks;
}
