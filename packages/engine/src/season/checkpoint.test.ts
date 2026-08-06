import { beforeAll, describe, expect, it } from 'vitest';
import {
  seasonCandidateCheckpointSchema,
  seasonRunSchema,
  type SeasonCandidateCheckpoint,
  type SeasonGameSummary,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  reconstructSeasonGames,
  seasonCheckpointCanonical,
  seasonCheckpointDigest,
} from './checkpoint.ts';
import { seasonBlockRecapCanonical } from './recap.ts';
import { buildTestRun, scheduleOf } from './block-test-support.ts';
import { simulateSeasonBlock } from './block.ts';
import { pipelineInput } from './block-test-support.ts';
/** A real 1,230-game schedule with the three interesting games extracted. */
function tinySchedule(): SeasonSchedule {
  return scheduleOf(buildTestRun().run);
}

function summaryOf(
  gameId: string,
  round: number,
  homeScore: number,
  awayScore: number,
): SeasonGameSummary {
  const homeFranchiseId = round % 2 === 1 ? 'lakers' : 'celtics';
  const awayFranchiseId = homeFranchiseId === 'lakers' ? 'celtics' : 'lakers';
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v2',
    gameId,
    round,
    homeFranchiseId,
    awayFranchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: {
      franchiseId: homeFranchiseId,
      points: homeScore,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 90,
      threePointersMade: 10,
      threePointersAttempted: 30,
      freeThrowsMade: 20,
      freeThrowsAttempted: 25,
      offensiveRebounds: 10,
      defensiveRebounds: 30,
      assists: 25,
      steals: 8,
      blocks: 5,
      turnovers: 12,
      fouls: 18,
      possessions: 100,
    },
    awayBox: {
      franchiseId: awayFranchiseId,
      points: awayScore,
      fieldGoalsMade: 38,
      fieldGoalsAttempted: 88,
      threePointersMade: 9,
      threePointersAttempted: 28,
      freeThrowsMade: 22,
      freeThrowsAttempted: 26,
      offensiveRebounds: 11,
      defensiveRebounds: 29,
      assists: 23,
      steals: 7,
      blocks: 4,
      turnovers: 13,
      fouls: 19,
      possessions: 101,
    },
    homePlayers: [],
    awayPlayers: [],
  };
}

describe('season game reconstruction (M2.3)', () => {
  it('overlays final and forfeit state on the scheduled base in schedule order', () => {
    const schedule = tinySchedule();
    const first = schedule.games[0];
    const second = schedule.games[1];
    if (first === undefined || second === undefined) throw new Error('schedule too short');
    const finalSummary = summaryOf(first.gameId, first.round, 110, 100);
    const forfeit: SeasonGameSummary = {
      ...summaryOf(second.gameId, second.round, 2, 0),
      status: 'forfeit',
      forfeitLoserFranchiseId: second.awayFranchiseId,
      homePlayers: [],
      awayPlayers: [],
      homeBox: {
        franchiseId: second.homeFranchiseId,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
      },
      awayBox: {
        franchiseId: second.awayFranchiseId,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
      },
    };
    const games = reconstructSeasonGames(schedule, [finalSummary, forfeit]);
    expect(games).toHaveLength(1230);
    expect(games[0]?.gameId).toBe(first.gameId);
    expect(games[1]?.gameId).toBe(second.gameId);
    expect(games[0]).toMatchObject({
      status: 'final',
      homeScore: 110,
      awayScore: 100,
      forfeitLoserFranchiseId: null,
    });
    expect(games[1]).toMatchObject({
      status: 'forfeit',
      homeScore: null,
      awayScore: null,
      forfeitLoserFranchiseId: second.awayFranchiseId,
    });
    expect(games[2]).toMatchObject({ status: 'scheduled', homeScore: null, awayScore: null });
  });
});

describe('season checkpoint digest (M2.3)', () => {
  // Block 0 simulation costs ~10s; all five tests consume the same simulated
  // checkpoint, and the digest functions only read from it.
  let checkpoint: SeasonCandidateCheckpoint;
  let run: SeasonRun;

  beforeAll(() => {
    const built = buildTestRun();
    run = built.run;
    checkpoint = simulateSeasonBlock(pipelineInput(built.run, built.catalog, 0));
  }, 60_000);

  it('is deterministic regardless of array order', () => {
    const digest = seasonCheckpointDigest(checkpoint);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(digest).toBe(checkpoint.digest);

    // Shuffle every canonical-sorted array; the digest must not change.
    const shuffled: SeasonCandidateCheckpoint = {
      ...checkpoint,
      teamAggregates: [...checkpoint.teamAggregates].reverse(),
      playerAggregates: [...checkpoint.playerAggregates].reverse(),
      gameSummaries: [...checkpoint.gameSummaries].reverse(),
      retainedDetails: [...checkpoint.retainedDetails].reverse(),
      standings: {
        ...checkpoint.standings,
        rows: [...checkpoint.standings.rows].reverse(),
      },
    };
    expect(seasonCheckpointDigest(shuffled)).toBe(digest);
  });

  it('sorts recap arrays canonically inside the canonical serialization', () => {
    const recap = checkpoint.recap;
    const reversed = {
      ...recap,
      standingsMovement: [...recap.standingsMovement].reverse(),
      notablePerformances: [...recap.notablePerformances].reverse(),
      streaks: [...recap.streaks].reverse(),
      versionSpotlights: [...recap.versionSpotlights].reverse(),
      upcomingHumanGames: [...recap.upcomingHumanGames].reverse(),
    };
    expect(seasonBlockRecapCanonical(reversed)).toBe(seasonBlockRecapCanonical(recap));
  });

  it('excludes the digest field itself from the serialization', () => {
    const withoutDigest = { ...checkpoint, digest: '' };
    expect(seasonCheckpointDigest(withoutDigest)).toBe(seasonCheckpointDigest(checkpoint));
    // The canonical serialization never contains the digest string.
    expect(seasonCheckpointCanonical(checkpoint)).not.toContain(checkpoint.digest);
  });

  it('is stable across runtime parsing (object key reordering)', () => {
    const digest = seasonCheckpointDigest(checkpoint);
    // JSON round-trip + zod parsing reorder object keys; the canonical
    // serialization sorts keys recursively, so the digest is unchanged.
    const reparsed = seasonCandidateCheckpointSchema.parse(
      JSON.parse(JSON.stringify(checkpoint)) as unknown,
    );
    expect(seasonCheckpointDigest(reparsed)).toBe(digest);
  });

  it('produces a schema-valid checkpoint for the pipeline output', () => {
    expect(seasonCandidateCheckpointSchema.safeParse(checkpoint).success).toBe(true);
    expect(seasonRunSchema.safeParse(run).success).toBe(true);
  });
});
