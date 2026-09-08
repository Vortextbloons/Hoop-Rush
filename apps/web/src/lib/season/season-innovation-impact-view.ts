import {
  courtInnovationEntryOf,
  type SeasonGameRule,
  type SeasonGameSummary,
  type SeasonRetainedGameDetail,
} from '@hoop-rush/data-contracts';

export type SeasonInnovationRule = Exclude<SeasonGameRule, 'standard'>;

export interface InnovationImpactGame {
  gameId: string;
  round: number;
  opponentFranchiseId: string;
  homeScore: number;
  awayScore: number;
  result: 'W' | 'L';
  margin: number;
  possessions: number;
  pointsPer100: number | null;
  detailAvailable: boolean;
}

export type InnovationImpactEvidence =
  | {
      kind: 'deep-four';
      attempts: number | null;
      makes: number | null;
      points: number | null;
    }
  | {
      kind: 'twenty-second-clock';
      possessions: number;
      turnovers: number;
      shotClockViolations: number | null;
    }
  | {
      kind: 'first-to-seven-overtime';
      overtimeGames: number;
      raceHomePoints: number | null;
      raceAwayPoints: number | null;
      racePossessions: number | null;
    };

export interface SeasonInnovationImpact {
  rule: SeasonInnovationRule;
  displayName: string;
  games: InnovationImpactGame[];
  wins: number;
  losses: number;
  averageMargin: number;
  pointsPer100: number | null;
  evidence: InnovationImpactEvidence;
}

function rounded(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function pointsPer100(points: number, possessions: number): number | null {
  return possessions > 0 ? rounded((points / possessions) * 100, 1) : null;
}

function evidenceOf(
  rule: SeasonInnovationRule,
  summaries: readonly SeasonGameSummary[],
  detailsByGameId: ReadonlyMap<string, SeasonRetainedGameDetail>,
): InnovationImpactEvidence {
  if (rule === 'deep-four') {
    let attempts = 0;
    let makes = 0;
    let available = true;
    for (const summary of summaries) {
      const deep = summary.homeBox.fourPointersAttempted;
      const made = summary.homeBox.fourPointersMade;
      if (deep === undefined || made === undefined) {
        available = false;
        continue;
      }
      attempts += deep;
      makes += made;
    }
    return {
      kind: 'deep-four',
      attempts: available ? attempts : null,
      makes: available ? makes : null,
      points: available ? makes * 4 : null,
    };
  }

  if (rule === 'twenty-second-clock') {
    let turnovers = 0;
    let possessions = 0;
    let shotClockViolations = 0;
    let violationsAvailable = true;
    for (const summary of summaries) {
      turnovers += summary.homeBox.turnovers;
      possessions += summary.homeBox.possessions;
      if (summary.homeBox.shotClockViolations === undefined) {
        violationsAvailable = false;
      } else {
        shotClockViolations += summary.homeBox.shotClockViolations;
      }
    }
    return {
      kind: 'twenty-second-clock',
      possessions,
      turnovers,
      shotClockViolations: violationsAvailable ? shotClockViolations : null,
    };
  }

  let overtimeGames = 0;
  let raceHomePoints = 0;
  let raceAwayPoints = 0;
  let racePossessions = 0;
  let racePossessionsAvailable = true;
  for (const summary of summaries) {
    const race = summary.overtimeRace;
    if (race === undefined) continue;
    overtimeGames += 1;
    raceHomePoints += race.homePoints;
    raceAwayPoints += race.awayPoints;
    const detail = detailsByGameId.get(summary.gameId);
    const result = detail?.result;
    if (result?.outcome !== 'completed' || result.overtimeRace === undefined) {
      racePossessionsAvailable = false;
    } else {
      racePossessions += result.overtimeRace.possessions;
    }
  }
  return {
    kind: 'first-to-seven-overtime',
    overtimeGames,
    raceHomePoints: overtimeGames > 0 ? raceHomePoints : null,
    raceAwayPoints: overtimeGames > 0 ? raceAwayPoints : null,
    racePossessions: racePossessionsAvailable && overtimeGames > 0 ? racePossessions : null,
  };
}

export function seasonInnovationImpactOf(input: {
  summaries: readonly SeasonGameSummary[];
  details?: readonly SeasonRetainedGameDetail[];
  humanFranchiseId: string;
  rule: SeasonInnovationRule;
}): SeasonInnovationImpact | null {
  const summaries = input.summaries.filter(
    (summary) =>
      summary.status === 'final' &&
      summary.homeFranchiseId === input.humanFranchiseId &&
      summary.gameRule === input.rule,
  );
  if (summaries.length === 0) return null;

  const detailsByGameId = new Map((input.details ?? []).map((detail) => [detail.gameId, detail]));
  const games = summaries.map((summary) => {
    const margin = summary.homeScore - summary.awayScore;
    return {
      gameId: summary.gameId,
      round: summary.round,
      opponentFranchiseId: summary.awayFranchiseId,
      homeScore: summary.homeScore,
      awayScore: summary.awayScore,
      result: margin > 0 ? ('W' as const) : ('L' as const),
      margin,
      possessions: summary.homeBox.possessions,
      pointsPer100: pointsPer100(summary.homeBox.points, summary.homeBox.possessions),
      detailAvailable: detailsByGameId.has(summary.gameId),
    };
  });
  const wins = games.filter((game) => game.result === 'W').length;
  const totalMargin = games.reduce((sum, game) => sum + game.margin, 0);
  const totalPoints = games.reduce((sum, game) => sum + game.homeScore, 0);
  const totalPossessions = games.reduce((sum, game) => sum + game.possessions, 0);

  return {
    rule: input.rule,
    displayName: courtInnovationEntryOf(input.rule).displayName,
    games,
    wins,
    losses: games.length - wins,
    averageMargin: rounded(totalMargin / games.length, 1),
    pointsPer100: pointsPer100(totalPoints, totalPossessions),
    evidence: evidenceOf(input.rule, summaries, detailsByGameId),
  };
}
