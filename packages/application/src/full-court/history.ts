import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  FULL_COURT_HISTORY_SCHEMA_VERSION,
  fullCourtHistoryRecordSchema,
  type FullCourtCoachingPlan,
  type FullCourtDraftState,
  type FullCourtHistoryRecord,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtSeasonSummary,
  fullCourtPlayoffView,
  type FullCourtCompletedGameFacts,
  type FullCourtPlayoffLock,
} from '@hoop-rush/engine';

export interface FullCourtHistoryRepository {
  load(runId: string): Promise<FullCourtHistoryRecord | null>;
  list(limit?: number): Promise<FullCourtHistoryRecord[]>;
  save(record: FullCourtHistoryRecord): Promise<'saved' | 'existing'>;
}

function completedGameFacts(
  score: Pick<FullCourtSeasonScore, 'gameId' | 'homeTeamId' | 'awayTeamId' | 'outcome'>,
  gameNumber: number,
  teamId: string,
): FullCourtCompletedGameFacts[] {
  const side = score.homeTeamId === teamId ? 'home' : score.awayTeamId === teamId ? 'away' : null;
  const { outcome } = score;
  if (side === null || outcome.kind !== 'played' || !outcome.benchPoints || !outcome.benchPlayers)
    return [];
  const teamPoints = side === 'home' ? outcome.homePoints : outcome.awayPoints;
  const benchPoints = outcome.benchPoints[side];
  const teamBonusPoints = outcome.teamBonusPoints?.[side] ?? 0;
  return [
    {
      gameId: score.gameId,
      gameNumber,
      teamPoints,
      benchPoints,
      starterPoints: outcome.starterPoints?.[side] ?? teamPoints - benchPoints - teamBonusPoints,
      teamBonusPoints,
      benchPlayerCount: outcome.benchPlayers[side],
    },
  ];
}

export function fullCourtHistoryFromSeason(input: {
  readonly draft: FullCourtDraftState;
  readonly coaching: FullCourtCoachingPlan;
  readonly lock: FullCourtPlayoffLock;
  readonly checkpoint: FullCourtPlayoffCheckpoint;
  readonly completedAtIso: string;
}): FullCourtHistoryRecord | null {
  const { draft, coaching, lock, checkpoint } = input;
  const view = fullCourtPlayoffView(lock, checkpoint);
  if (
    view.nextGame !== null ||
    view.championTeamId === null ||
    view.userOutcome.status === 'pending'
  )
    return null;
  const { runId, userTeamId, teams } = lock.seasonLock.season;
  const summary = buildFullCourtSeasonSummary({
    runId,
    userTeamId,
    variant: draft.variant,
    regularScores: lock.regularScores,
    series: view.series,
    championTeamId: view.championTeamId,
    completedGames: [
      ...lock.regularScores.flatMap((score) => completedGameFacts(score, score.slot, userTeamId)),
      ...checkpoint.games.flatMap((score, index) =>
        completedGameFacts(score, CAP_RUSH_CONFERENCE_GAMES_PER_TEAM + index + 1, userTeamId),
      ),
    ],
  });
  if (!summary.completion.complete || summary.postseason === null) return null;
  return fullCourtHistoryRecordSchema.parse({
    schemaVersion: FULL_COURT_HISTORY_SCHEMA_VERSION,
    runId,
    completedAtIso: input.completedAtIso,
    draft,
    teamId: userTeamId,
    teamName: teams.find((team) => team.teamId === userTeamId)?.displayName ?? userTeamId,
    coaching,
    regularSeason: summary.regularSeason,
    ...(summary.bench === null
      ? {}
      : {
          bench: {
            gamesRecorded: summary.bench.gamesRecorded,
            totalBenchPoints: summary.bench.totalBenchPoints,
            averageBenchPoints: summary.bench.averageBenchPoints,
            bestGame:
              summary.bench.bestGame === null
                ? null
                : {
                    gameId: summary.bench.bestGame.gameId,
                    gameNumber: summary.bench.bestGame.gameNumber,
                    benchPoints: summary.bench.bestGame.benchPoints,
                  },
          },
        }),
    playoffs: {
      status: view.userOutcome.status,
      championTeamId: view.championTeamId,
      championName:
        teams.find((team) => team.teamId === view.championTeamId)?.displayName ??
        view.championTeamId,
      seriesWon: summary.postseason.userSeries.filter((series) => series.won === true).length,
      eliminatedRound: summary.postseason.eliminatedRound,
    },
    achievements: summary.achievements.map((achievement) => achievement.id),
  });
}

export async function archiveFullCourtRun(
  input: {
    readonly draft: FullCourtDraftState;
    readonly coaching: FullCourtCoachingPlan;
    readonly lock: FullCourtPlayoffLock;
    readonly checkpoint: FullCourtPlayoffCheckpoint;
    readonly completedAtIso?: string;
  },
  repository: FullCourtHistoryRepository,
): Promise<FullCourtHistoryRecord | null> {
  const existing = await repository.load(input.lock.seasonLock.season.runId);
  if (existing !== null) return existing;
  const record = fullCourtHistoryFromSeason({
    ...input,
    completedAtIso: input.completedAtIso ?? new Date().toISOString(),
  });
  if (record === null) return null;
  await repository.save(record);
  return record;
}
