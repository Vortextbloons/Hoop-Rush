import { beforeAll, describe, expect, it } from 'vitest';
import {
  type SeasonGameSummary,
  type SeasonPlayerAggregate,
  type SeasonRun,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { blockRoundRange } from '@hoop-rush/data-contracts';
import {
  auditSeasonBlockRecap,
  buildSeasonBlockRecap,
  seasonBlockGameCount,
  type SeasonBlockRecapInput,
} from './recap.ts';
import { buildTestRun, scheduleOf } from './block-test-support.ts';
import { simulateSeasonBlock } from './block.ts';
import { pipelineInput } from './block-test-support.ts';

function emptyStandings(franchiseIds: string[]): SeasonStandings {
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: franchiseIds.map((franchiseId) => ({
      franchiseId,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      conferenceWins: 0,
      conferenceLosses: 0,
      divisionWins: 0,
      divisionLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      headToHead: franchiseIds
        .filter((other) => other !== franchiseId)
        .map((other) => ({ franchiseId: other, wins: 0, losses: 0 })),
    })),
  };
}

describe('season block recap (M2.3)', () => {
  // Block 0 costs ~10s to simulate; the first two tests consume the same
  // simulated checkpoint and its derived recap scaffolding.
  let run: SeasonRun;
  let checkpoint: ReturnType<typeof simulateSeasonBlock>;
  let zero: SeasonStandings;
  let rosterPlayerIds: Map<string, string>;
  let schedule: ReturnType<typeof scheduleOf>;

  beforeAll(() => {
    const built = buildTestRun();
    run = built.run;
    checkpoint = simulateSeasonBlock(pipelineInput(built.run, built.catalog, 0));
    const franchiseIds = run.league.teams.map((team) => team.franchiseId);
    zero = emptyStandings(franchiseIds);
    rosterPlayerIds = new Map(
      run.rosters.flatMap((roster) =>
        roster.players.map((player) => [player.playerVersionId, player.playerId]),
      ),
    );
    schedule = scheduleOf(run);
  }, 60_000);

  it('builds a recap whose every claim derives from saved facts', () => {
    const recapInput: SeasonBlockRecapInput = {
      runId: run.runId,
      blockIndex: 0,
      completedRounds: 10,
      humanFranchiseId: 'lakers',
      summaries: checkpoint.gameSummaries,
      standingsBefore: zero,
      standingsAfter: checkpoint.standings,
      playerAggregates: checkpoint.playerAggregates,
      schedule,
      rosterPlayerIds,
    };
    const recap = buildSeasonBlockRecap(recapInput);
    expect(recap.blockIndex).toBe(0);
    expect(recap.completedRounds).toBe(10);
    expect(recap.humanRecord?.franchiseId).toBe('lakers');
    expect(recap.standingsMovement).toHaveLength(30);
    expect(recap.notablePerformances.length).toBeLessThanOrEqual(10);
    expect(recap.streaks.length).toBeLessThanOrEqual(10);
    expect(recap.versionSpotlights.length).toBeLessThanOrEqual(5);
    expect(recap.upcomingHumanGames.length).toBeLessThanOrEqual(10);
    expect(recap.upcomingHumanGames.length).toBeGreaterThan(0);
    expect(auditSeasonBlockRecap(recap, recapInput)).toEqual([]);
  });

  it('lists exactly the next block human games from the schedule', () => {
    const recap = buildSeasonBlockRecap({
      runId: run.runId,
      blockIndex: 0,
      completedRounds: 10,
      humanFranchiseId: 'lakers',
      summaries: checkpoint.gameSummaries,
      standingsBefore: zero,
      standingsAfter: checkpoint.standings,
      playerAggregates: checkpoint.playerAggregates,
      schedule,
      rosterPlayerIds,
    });
    const { fromRound, toRound } = blockRoundRange(1);
    const expectedCount = schedule.games.filter(
      (game) =>
        game.round >= fromRound &&
        game.round <= toRound &&
        (game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers'),
    ).length;
    expect(recap.upcomingHumanGames).toHaveLength(expectedCount);
    for (const game of recap.upcomingHumanGames) {
      expect(game.round).toBeGreaterThanOrEqual(fromRound);
      expect(game.round).toBeLessThanOrEqual(toRound);
      expect(game.homeFranchiseId === 'lakers' || game.awayFranchiseId === 'lakers').toBe(true);
      expect(game.humanIsHome).toBe(game.homeFranchiseId === 'lakers');
    }
  });

  it('reports no upcoming games at season end and no human record without a human', () => {
    const { run, catalog } = buildTestRun();
    const finalBlockRun = { ...run, cursor: { schemaVersion: 1 as const, completedRounds: 80 } };
    const input = pipelineInput(finalBlockRun, catalog, 8);
    const checkpoint = simulateSeasonBlock(input);
    const franchiseIds = run.league.teams.map((team) => team.franchiseId);
    const base = {
      runId: run.runId,
      blockIndex: 8,
      completedRounds: 82,
      standingsBefore: emptyStandings(franchiseIds),
      standingsAfter: checkpoint.standings,
      playerAggregates: checkpoint.playerAggregates,
      schedule: scheduleOf(run),
      rosterPlayerIds: new Map(
        run.rosters.flatMap((roster) =>
          roster.players.map((player) => [player.playerVersionId, player.playerId]),
        ),
      ),
    };
    const withHuman = buildSeasonBlockRecap({
      ...base,
      humanFranchiseId: 'lakers',
      summaries: checkpoint.gameSummaries,
    });
    expect(withHuman.upcomingHumanGames).toHaveLength(0);
    const withoutHuman = buildSeasonBlockRecap({
      ...base,
      humanFranchiseId: null,
      summaries: checkpoint.gameSummaries,
    });
    expect(withoutHuman.humanRecord).toBeNull();
    expect(withoutHuman.upcomingHumanGames).toHaveLength(0);
  });

  it('counts block games as 150 for blocks 0-7 and 30 for the final block', () => {
    expect(seasonBlockGameCount(0)).toBe(150);
    expect(seasonBlockGameCount(7)).toBe(150);
    expect(seasonBlockGameCount(8)).toBe(30);
  });

  it('keeps streak facts consistent with the ordered game results', () => {
    // Hand-built three-game set: lakers win, win, lose -> current streak is
    // a 1-game losing streak (not reported); celtics lose, lose, win -> 1.
    const win = (gameId: string): SeasonGameSummary => ({
      schemaVersion: 1,
      summaryVersion: 'season-game-summary-v3',
      gameId,
      round: 1,
      homeFranchiseId: 'lakers',
      awayFranchiseId: 'celtics',
      status: 'final',
      overtimePeriods: 0,
      homeScore: 110,
      awayScore: 100,
      forfeitLoserFranchiseId: null,
      homeBox: {
        franchiseId: 'lakers',
        points: 110,
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
        franchiseId: 'celtics',
        points: 100,
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
      injuryEvents: [],
    });
    const lose = (gameId: string): SeasonGameSummary => ({
      ...win(gameId),
      gameId,
      homeScore: 100,
      awayScore: 110,
    });
    const summaries = [win('s000001'), lose('s000002'), win('s000003')];
    const franchiseIds = ['lakers', 'celtics'];
    const emptyPlayer: SeasonPlayerAggregate = {
      playerVersionId: 'pv-x',
      franchiseId: 'lakers',
      gamesPlayed: 0,
      seconds: 0,
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
    };
    const recap = buildSeasonBlockRecap({
      runId: 'run-1',
      blockIndex: 0,
      completedRounds: 1,
      humanFranchiseId: null,
      summaries,
      standingsBefore: emptyStandings(franchiseIds),
      standingsAfter: emptyStandings(franchiseIds),
      playerAggregates: [emptyPlayer],
      schedule: scheduleOf(buildTestRun().run),
      rosterPlayerIds: new Map(),
    });
    // Current streaks are all length 1: nothing is reported.
    expect(recap.streaks).toEqual([]);
  });
});
