import { describe, expect, it } from 'vitest';
import {
  franchiseIdSchema,
  seasonGameIdSchema,
  seedSchema,
  type SeasonScoreline,
} from '@hoop-rush/data-contracts';
import { generateSeasonSchedule, seasonBlockGamesOf } from '@hoop-rush/engine';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { buildBlockLiveViewModel } from './season-block-live';

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const SCHEDULE = generateSeasonSchedule({
  league: LEAGUE,
  seed: seedSchema.parse('a'.repeat(32)),
});
const HUMAN = 'lakers';
const nameOf = (id: string) => id.toUpperCase();

function line(
  gameId: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
): SeasonScoreline {
  return {
    gameId: seasonGameIdSchema.parse(gameId),
    homeFranchiseId: franchiseIdSchema.parse(home),
    homeScore,
    awayScore,
    awayFranchiseId: franchiseIdSchema.parse(away),
  };
}

function progressFor(
  blockIndex: number,
  humanLines: SeasonScoreline[],
  leagueLatest: SeasonScoreline | null,
  completed: number,
) {
  const games = seasonBlockGamesOf(SCHEDULE, blockIndex);
  return {
    gamesCompleted: completed,
    gamesTotal: games.length,
    latestGameId: leagueLatest?.gameId ?? humanLines[humanLines.length - 1]?.gameId ?? null,
    latestResult: leagueLatest ?? humanLines[humanLines.length - 1] ?? null,
    isHumanGame: leagueLatest === null && humanLines.length > 0 ? true : false,
    humanRecordInBlock: {
      wins: humanLines.filter((l) => {
        const humanScore = l.homeFranchiseId === HUMAN ? l.homeScore : l.awayScore;
        const opp = l.homeFranchiseId === HUMAN ? l.awayScore : l.homeScore;
        return humanScore > opp;
      }).length,
      losses: humanLines.filter((l) => {
        const humanScore = l.homeFranchiseId === HUMAN ? l.homeScore : l.awayScore;
        const opp = l.homeFranchiseId === HUMAN ? l.awayScore : l.homeScore;
        return humanScore <= opp;
      }).length,
    },
    humanResults: humanLines,
    leaguePulse: {
      closest: humanLines[0] ?? null,
      blowout: humanLines[0] ?? null,
      highestScoring: humanLines[0] ?? null,
    },
  };
}

describe('season block live view model (wire v10)', () => {
  it('maps 10 human slots for a full block and 2 for the shorter final block', () => {
    const block0 = buildBlockLiveViewModel({
      schedule: SCHEDULE,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      progress: null,
      franchiseNameOf: nameOf,
    });
    expect(block0.slots).toHaveLength(10);
    expect(block0.slots.every((s) => s.status === 'upcoming')).toBe(true);
    expect(block0.roundCompletion).toHaveLength(10);
    expect(block0.roundCompletion[0]?.total).toBe(15);
    expect(block0.nextOpponent.franchiseId).not.toBeNull();

    const block8 = buildBlockLiveViewModel({
      schedule: SCHEDULE,
      blockIndex: 8,
      humanFranchiseId: HUMAN,
      progress: null,
      franchiseNameOf: nameOf,
    });
    expect(block8.slots).toHaveLength(2);
    expect(block8.roundCompletion).toHaveLength(2);
    expect(block8.ticker.kind).toBe('empty');
  });

  it('flips human chips from vs to W/L once finals arrive', () => {
    const games = seasonBlockGamesOf(SCHEDULE, 0);
    const humanGames = games.filter(
      (g) => g.homeFranchiseId === HUMAN || g.awayFranchiseId === HUMAN,
    );
    const first = humanGames[0];
    if (!first) throw new Error('no human game');
    const won = line(
      first.gameId,
      first.homeFranchiseId,
      first.awayFranchiseId,
      first.homeFranchiseId === HUMAN ? 120 : 90,
      first.homeFranchiseId === HUMAN ? 100 : 110,
    );
    const progress = progressFor(0, [won], null, 15);
    const vm = buildBlockLiveViewModel({
      schedule: SCHEDULE,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      progress,
      franchiseNameOf: nameOf,
    });
    expect(vm.slots[0]?.status).toBe('final');
    expect(vm.slots[0]?.humanWon).toBe(true);
    expect(vm.slots[1]?.status).toBe('upcoming');
    expect(vm.slots[1]?.humanWon).toBeNull();
    expect(vm.humanResults).toHaveLength(1);
    expect(vm.ticker.kind).toBe('human');
    expect(vm.ticker.humanCompleted).toBe(1);
    expect(vm.ticker.humanTotal).toBe(10);
    expect(vm.nextOpponent.gameId).toBe(humanGames[1]?.gameId ?? null);
  });

  it('prefers the latest human final for the ticker, else the latest league final', () => {
    const games = seasonBlockGamesOf(SCHEDULE, 0);
    const leagueGame = games.find(
      (g) => g.homeFranchiseId !== HUMAN && g.awayFranchiseId !== HUMAN,
    );
    if (!leagueGame) throw new Error('no league-only game');
    const leagueLine = line(
      leagueGame.gameId,
      leagueGame.homeFranchiseId,
      leagueGame.awayFranchiseId,
      130,
      128,
    );
    const leagueOnly = buildBlockLiveViewModel({
      schedule: SCHEDULE,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      progress: {
        gamesCompleted: 5,
        gamesTotal: games.length,
        latestGameId: leagueLine.gameId,
        latestResult: leagueLine,
        isHumanGame: false,
        humanRecordInBlock: { wins: 0, losses: 0 },
        humanResults: [],
        leaguePulse: { closest: leagueLine, blowout: leagueLine, highestScoring: leagueLine },
      },
      franchiseNameOf: nameOf,
    });
    expect(leagueOnly.ticker.kind).toBe('league');
    expect(leagueOnly.ticker.scoreline?.gameId).toBe(leagueGame.gameId);
    expect(leagueOnly.pulse.closest?.gameId).toBe(leagueGame.gameId);
    expect(leagueOnly.pulse.blowout?.gameId).toBe(leagueGame.gameId);
    expect(leagueOnly.pulse.highestScoring?.gameId).toBe(leagueGame.gameId);
  });

  it('computes round completion from canonical order without fake state', () => {
    const games = seasonBlockGamesOf(SCHEDULE, 0);
    const vm = buildBlockLiveViewModel({
      schedule: SCHEDULE,
      blockIndex: 0,
      humanFranchiseId: HUMAN,
      progress: {
        gamesCompleted: 15,
        gamesTotal: games.length,
        latestGameId: null,
        latestResult: null,
        isHumanGame: false,
        humanRecordInBlock: { wins: 0, losses: 0 },
        humanResults: [],
        leaguePulse: { closest: null, blowout: null, highestScoring: null },
      },
      franchiseNameOf: nameOf,
    });
    const totalCompleted = vm.roundCompletion.reduce((sum, r) => sum + r.completed, 0);
    expect(totalCompleted).toBe(15);
  });
});
