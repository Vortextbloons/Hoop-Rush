import {
  SEASON_OBJECTIVE_CATALOG,
  SEASON_SEED_NAMESPACES,
  seasonNamespaceSeed,
  type SeasonGameSummary,
  type SeasonObjectiveDefinition,
  type SeasonObjectiveEvaluation,
  type SeasonObjectiveId,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';

/**
 * M2.5 block objectives (season-objective-v1, engine side). The six fixed
 * objectives, the deterministic three-choice offer per block, and the
 * frozen-measure evaluation from saved facts. Selection and evaluation flow
 * through the typed command and block pipelines; this module owns the
 * catalog-derived pure functions only.
 *
 * Evaluation measures the HUMAN franchise's block from the recorded compact
 * summaries only (never invented numbers): the human team's games, official
 * wins (forfeits count 2-0, loser named on the summary), the opponent team
 * boxes (points allowed, rebound margin, turnovers use the human team box
 * and the opponent team box; forfeit boxes are zeros), the per-tipoff
 * available-player counts collected by the block pipeline (forfeits have no
 * tipoff and are excluded via tipCountedGames), and the human rotation
 * (starters = the rotation's starter list with target minutes > 0; every
 * other human player's on-court seconds count toward bench minutes, summed
 * and floored to whole minutes).
 */

/** The fixed six-entry objective catalog (contract shape). */
export function seasonObjectiveCatalog(): readonly SeasonObjectiveDefinition[] {
  return SEASON_OBJECTIVE_CATALOG;
}

/**
 * The deterministic three-choice offer for a block (blocks 0-7): the six
 * catalog ids ranked by their named subseeds under the objective namespace,
 * taking the first three. Pure function of (root seed, block index); the
 * human picks one of the three before block submission.
 */
export function seasonObjectiveChoicesForBlock(
  rootSeed: string,
  blockIndex: number,
): SeasonObjectiveId[] {
  const ranked = SEASON_OBJECTIVE_CATALOG.map((entry) => ({
    entry,
    hash: seasonNamespaceSeed(
      rootSeed,
      SEASON_SEED_NAMESPACES.objectives,
      'choices',
      String(blockIndex),
      entry.objectiveId,
    ),
  })).sort((a, b) => {
    if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
    return a.entry.objectiveId < b.entry.objectiveId ? -1 : 1;
  });
  return ranked.slice(0, 3).map(({ entry }) => entry.objectiveId);
}

/**
 * Input facts the evaluator measures: the block's completed summaries, the
 * human rotation (starter minutes identify starters for bench-320), and the
 * per-game available-player count at each human tipoff (collected by the
 * block pipeline from the health-derived availability map).
 */
export interface SeasonObjectiveEvaluationInput {
  objectiveId: SeasonObjectiveId | null;
  blockIndex: number;
  humanFranchiseId: string | null;
  rotation: SeasonRotation | null;
  summaries: readonly SeasonGameSummary[];
  tipAvailability: readonly { gameId: string; availableCount: number }[];
}

/** Frozen-measure objective evaluation result (null when no objective). */
export interface SeasonObjectiveEvaluationResult {
  objectiveId: SeasonObjectiveId | null;
  success: boolean | null;
  evaluation: SeasonObjectiveEvaluation;
}

/**
 * Frozen-measure objective evaluation (M2.5 brief). All facts are measured
 * from the input summaries, the human rotation, and the per-tipoff
 * availability records; the six measures are:
 *
 * - `win-six`: wins >= 6 of the block's human team games
 * - `defense-108`: pointsAllowed <= 1080 (opponent team box points)
 * - `rebound-plus-20`: reboundMargin >= 20 (human box rebounds - opponent)
 * - `availability-eight`: every counted tip had >= 8 available players
 *   (tipsWithAtLeastEightAvailable === tipsTotal; forfeits have no tipoff
 *   and are excluded by the pipeline from `tipAvailability`)
 * - `bench-320`: benchMinutes >= 320 (non-starter on-court seconds / 60,
 *   floored; starters = rotation starters with target minutes > 0)
 * - `turnover-130`: turnovers <= 130 (human team box turnovers)
 *
 * A null objectiveId (the final two-game block, or a pipeline call before
 * any selection) returns the unevaluated shape with zeroed facts; a null
 * humanFranchiseId (pure AI context) returns the same unevaluated shape
 * because the human block facts cannot be identified.
 */
export function evaluateSeasonBlockObjective(
  input: SeasonObjectiveEvaluationInput,
): SeasonObjectiveEvaluationResult {
  const unevaluated: SeasonObjectiveEvaluationResult = {
    objectiveId: null,
    success: null,
    evaluation: {
      objectiveId: 'win-six',
      blockIndex: 0,
      success: false,
      facts: {
        games: 0,
        wins: 0,
        pointsAllowed: 0,
        reboundMargin: 0,
        tipsWithAtLeastEightAvailable: 0,
        tipsTotal: 0,
        benchMinutes: 0,
        turnovers: 0,
      },
      tipCountedGames: 0,
    },
  };
  if (input.objectiveId === null || input.humanFranchiseId === null) {
    return unevaluated;
  }

  const human = input.humanFranchiseId;
  const games = input.summaries.filter(
    (summary) => summary.homeFranchiseId === human || summary.awayFranchiseId === human,
  );

  let wins = 0;
  let pointsAllowed = 0;
  let reboundMargin = 0;
  let turnovers = 0;
  for (const summary of games) {
    const homeIsHuman = summary.homeFranchiseId === human;
    const humanBox = homeIsHuman ? summary.homeBox : summary.awayBox;
    const opponentBox = homeIsHuman ? summary.awayBox : summary.homeBox;
    if (summary.status === 'forfeit') {
      if (summary.forfeitLoserFranchiseId !== human) wins += 1;
    } else if (homeIsHuman) {
      if (summary.homeScore > summary.awayScore) wins += 1;
    } else if (summary.awayScore > summary.homeScore) {
      wins += 1;
    }
    pointsAllowed += opponentBox.points;
    reboundMargin +=
      humanBox.offensiveRebounds +
      humanBox.defensiveRebounds -
      (opponentBox.offensiveRebounds + opponentBox.defensiveRebounds);
    turnovers += humanBox.turnovers;
  }

  let benchMinutes = 0;
  if (input.rotation !== null) {
    const rotation = input.rotation;
    const startersWithMinutes = new Set(
      rotation.targetMinutes
        .filter((entry) => entry.minutes > 0 && rotation.starters.includes(entry.playerVersionId))
        .map((entry) => entry.playerVersionId),
    );
    let benchSeconds = 0;
    for (const summary of games) {
      const lines = summary.homeFranchiseId === human ? summary.homePlayers : summary.awayPlayers;
      for (const line of lines) {
        if (!startersWithMinutes.has(line.playerVersionId)) benchSeconds += line.seconds;
      }
    }
    benchMinutes = Math.floor(benchSeconds / 60);
  }

  const tipsWithAtLeastEightAvailable = input.tipAvailability.filter(
    (tip) => tip.availableCount >= 8,
  ).length;
  const tipsTotal = input.tipAvailability.length;

  const facts = {
    games: games.length,
    wins,
    pointsAllowed,
    reboundMargin,
    tipsWithAtLeastEightAvailable,
    tipsTotal,
    benchMinutes,
    turnovers,
  };

  let success = false;
  switch (input.objectiveId) {
    case 'win-six':
      success = facts.wins >= 6;
      break;
    case 'defense-108':
      success = facts.pointsAllowed <= 1080;
      break;
    case 'rebound-plus-20':
      success = facts.reboundMargin >= 20;
      break;
    case 'availability-eight':
      success = facts.tipsWithAtLeastEightAvailable === facts.tipsTotal;
      break;
    case 'bench-320':
      success = facts.benchMinutes >= 320;
      break;
    case 'turnover-130':
      success = facts.turnovers <= 130;
      break;
  }

  return {
    objectiveId: input.objectiveId,
    success,
    evaluation: {
      objectiveId: input.objectiveId,
      blockIndex: input.blockIndex,
      success,
      facts,
      tipCountedGames: tipsTotal,
    },
  };
}
