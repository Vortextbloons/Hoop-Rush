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

export function seasonObjectiveCatalog(): readonly SeasonObjectiveDefinition[] {
  return SEASON_OBJECTIVE_CATALOG;
}

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

export interface SeasonObjectiveEvaluationInput {
  objectiveId: SeasonObjectiveId | null;
  blockIndex: number;
  humanFranchiseId: string | null;
  rotation: SeasonRotation | null;
  summaries: readonly SeasonGameSummary[];
  tipAvailability: readonly { gameId: string; availableCount: number }[];
}

export interface SeasonObjectiveEvaluationResult {
  objectiveId: SeasonObjectiveId | null;
  success: boolean | null;
  evaluation: SeasonObjectiveEvaluation;
}

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
