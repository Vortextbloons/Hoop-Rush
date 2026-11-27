import { describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
  seedSchema,
  type FullCourtPlayoffScore,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import { fullCourtTestSeasonLock } from '../../../../../apps/web/src/lib/features/full-court/full-court-test-support.ts';
import { createEngineContext } from '../../sim/kernel.ts';
import { fullCourtGameDigest, simulateFullCourtGame } from './game.ts';
import {
  FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS,
  FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS,
  fullCourtPlayoffAdaptationForTeam,
  fullCourtPlayoffGameEvidence,
  fullCourtPlayoffMatchupAdaptations,
} from './playoff-adaptation.ts';
import {
  createFullCourtPlayoffCheckpoint,
  fullCourtPlayoffView,
  fullCourtUserNextPlayoffMatchup,
  lockFullCourtPlayoffs,
  simulateFullCourtPlayoffGame,
} from './playoffs.ts';
import { createFullCourtSeasonCheckpoint } from './season-slot.ts';

function completedPlayoffSetup(userWinsEveryGame = true) {
  const lock = fullCourtTestSeasonLock();
  const regular = createFullCourtSeasonCheckpoint(lock);
  regular.completedThroughSlot = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  const scores = lock.season.games.map((fixture): FullCourtSeasonScore => {
    if (fixture.slot === regular.completedThroughSlot) {
      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
        regular.healthByTeam[teamId] = {
          teamId,
          version: FULL_COURT_HEALTH_VERSION,
          throughDay: fixture.dayOffset,
          players: {},
        };
      }
    }
    const userInGame =
      fixture.homeTeamId === lock.season.userTeamId ||
      fixture.awayTeamId === lock.season.userTeamId;
    const homeWins = userInGame
      ? userWinsEveryGame
        ? fixture.homeTeamId === lock.season.userTeamId
        : fixture.awayTeamId === lock.season.userTeamId
      : fixture.homeTeamId < fixture.awayTeamId;
    return {
      ...fixture,
      outcome: { kind: 'played', homePoints: homeWins ? 102 : 91, awayPoints: homeWins ? 91 : 102 },
    };
  });
  const playoffs = lockFullCourtPlayoffs(lock, regular, scores);
  return { lock, playoffs };
}

function scoreWithEvidence(input: {
  readonly gameId: string;
  readonly dayOffset: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeRim: number;
  readonly homeFga: number;
  readonly homeLeadUsage?: number;
  readonly homeTeamUsage?: number;
  readonly awayRim?: number;
  readonly awayFga?: number;
  readonly adaptations?: FullCourtPlayoffScore['adaptations'];
}): FullCourtPlayoffScore {
  return {
    gameId: input.gameId,
    dayOffset: input.dayOffset,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    winnerTeamId: input.homeTeamId,
    outcome: { kind: 'played', homePoints: 100, awayPoints: 95 },
    evidence: {
      home: {
        fieldGoalAttempts: input.homeFga,
        rimAttempts: input.homeRim,
        leadUsageCentis: input.homeLeadUsage ?? 2000,
        teamUsageCentis: input.homeTeamUsage ?? 10000,
      },
      away: {
        fieldGoalAttempts: input.awayFga ?? 80,
        rimAttempts: input.awayRim ?? 28,
        leadUsageCentis: 1800,
        teamUsageCentis: 10000,
      },
    },
    ...(input.adaptations === undefined ? {} : { adaptations: input.adaptations }),
  };
}

describe('full court playoff adaptation', () => {
  test('requires at least two valid played games, ignores forfeits and tiny samples, and uses fixed two-game windows', () => {
    const common = {
      adaptingTeamId: 'celtics',
      opponentTeamId: 'lakers',
      userTeamId: 'lakers',
    };

    expect(fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: [] })).toBeUndefined();

    const oneGame = [
      scoreWithEvidence({
        gameId: 'fcp-1-0-1',
        dayOffset: 170,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 45,
        homeFga: 80,
      }),
    ];
    expect(fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: oneGame })).toBeUndefined();

    const onePlayedOneForfeit: FullCourtPlayoffScore[] = [
      ...oneGame,
      {
        gameId: 'fcp-1-0-2',
        dayOffset: 172,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        winnerTeamId: 'lakers',
        outcome: { kind: 'forfeit', losingSides: ['away'] },
      },
    ];
    expect(
      fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: onePlayedOneForfeit }),
    ).toBeUndefined();

    const onePlayedOneTiny = [
      ...oneGame,
      scoreWithEvidence({
        gameId: 'fcp-1-0-2',
        dayOffset: 172,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 10,
        homeFga: 15,
      }),
    ];
    expect(
      fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: onePlayedOneTiny }),
    ).toBeUndefined();

    // Game 1 is 55%, Game 2 is 38% (below 42% per-game floor) -> no adaptation on a single outlier.
    const outlierOnly = [
      ...oneGame,
      scoreWithEvidence({
        gameId: 'fcp-1-0-2',
        dayOffset: 172,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 30,
        homeFga: 79,
      }),
    ];
    expect(
      fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: outlierOnly }),
    ).toBeUndefined();

    // Persistent inside scoring across games 1 & 2 -> protect-paint locked for games 3 & 4.
    const windowOneGames = [
      scoreWithEvidence({
        gameId: 'fcp-1-0-1',
        dayOffset: 170,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 40,
        homeFga: 80,
      }),
      scoreWithEvidence({
        gameId: 'fcp-1-0-2',
        dayOffset: 172,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 38,
        homeFga: 80,
      }),
    ];
    const windowOne = fullCourtPlayoffAdaptationForTeam({
      ...common,
      seriesGames: windowOneGames,
    });
    expect(windowOne).toEqual({
      defense: 'protect-paint',
      reason: 'persistent-inside-scoring',
      sampleGames: 2,
      windowGames: 2,
      observedShareBps: 4875,
      thresholdShareBps: FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS,
    });

    // After Game 3 changes to perimeter, Game 4 still stays locked in Window 1.
    const afterGameThree = [
      ...windowOneGames,
      scoreWithEvidence({
        gameId: 'fcp-1-0-3',
        dayOffset: 174,
        homeTeamId: 'celtics',
        awayTeamId: 'lakers',
        homeRim: 25,
        homeFga: 80,
        awayRim: 22,
        awayFga: 80,
        adaptations: { home: windowOne },
      }),
    ];
    expect(fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: afterGameThree })).toEqual(
      windowOne,
    );

    // After Game 4 also shifts to opportunity concentration, Window 2 switches to pressure for Game 5.
    const afterGameFour = [
      ...afterGameThree,
      scoreWithEvidence({
        gameId: 'fcp-1-0-4',
        dayOffset: 176,
        homeTeamId: 'celtics',
        awayTeamId: 'lakers',
        homeRim: 24,
        homeFga: 80,
        awayRim: 20,
        awayFga: 80,
        adaptations: { home: windowOne },
      }),
    ];
    // Manually set away lead usage in games 3 & 4 to reflect star-heavy concentration.
    const game3 = afterGameFour[2];
    const game4 = afterGameFour[3];
    if (game3?.evidence === undefined || game4?.evidence === undefined) {
      throw new Error('Expected game evidence');
    }
    const firstWin = windowOneGames[0];
    const secondWin = windowOneGames[1];
    if (firstWin === undefined || secondWin === undefined) {
      throw new Error('Expected window one games');
    }
    const concentrated = [
      firstWin,
      secondWin,
      {
        ...game3,
        evidence: {
          ...game3.evidence,
          away: { ...game3.evidence.away, leadUsageCentis: 2900, teamUsageCentis: 10000 },
        },
      },
      {
        ...game4,
        evidence: {
          ...game4.evidence,
          away: { ...game4.evidence.away, leadUsageCentis: 2800, teamUsageCentis: 10000 },
        },
      },
    ];
    expect(fullCourtPlayoffAdaptationForTeam({ ...common, seriesGames: concentrated })).toEqual({
      defense: 'pressure',
      reason: 'persistent-opportunity-concentration',
      sampleGames: 2,
      windowGames: 2,
      observedShareBps: 2850,
      thresholdShareBps: FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS,
    });

    // User team never receives automatic AI adaptation.
    expect(
      fullCourtPlayoffAdaptationForTeam({
        seriesGames: windowOneGames,
        adaptingTeamId: 'lakers',
        opponentTeamId: 'celtics',
        userTeamId: 'lakers',
      }),
    ).toBeUndefined();
  });

  test('never leaks adaptation across opponents or round boundaries', () => {
    const roundOneGames = [
      scoreWithEvidence({
        gameId: 'fcp-1-0-1',
        dayOffset: 170,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 42,
        homeFga: 80,
      }),
      scoreWithEvidence({
        gameId: 'fcp-1-0-2',
        dayOffset: 172,
        homeTeamId: 'lakers',
        awayTeamId: 'celtics',
        homeRim: 41,
        homeFga: 80,
      }),
    ];
    expect(
      fullCourtPlayoffMatchupAdaptations({
        seriesGames: roundOneGames,
        homeTeamId: 'lakers',
        awayTeamId: 'heat',
        userTeamId: 'lakers',
      }),
    ).toBeUndefined();
  });

  test('proves real tactical counterplay on paired seeds for both protect-paint and pressure without altering ratings', () => {
    const { lock } = completedPlayoffSetup(true);
    const context = createEngineContext();
    const userTeam = lock.season.teams.find((team) => team.teamId === lock.season.userTeamId);
    const aiTeam = lock.season.teams.find((team) => team.teamId !== lock.season.userTeamId);
    if (userTeam === undefined || aiTeam === undefined) throw new Error('Missing test teams');

    const userSnapshot = JSON.stringify(userTeam.roster);
    const aiSnapshot = JSON.stringify(aiTeam.roster);

    const paintAdapt = fullCourtPlayoffAdaptationForTeam({
      seriesGames: [
        scoreWithEvidence({
          gameId: 'fcp-1-0-1',
          dayOffset: 170,
          homeTeamId: userTeam.teamId,
          awayTeamId: aiTeam.teamId,
          homeRim: 42,
          homeFga: 80,
        }),
        scoreWithEvidence({
          gameId: 'fcp-1-0-2',
          dayOffset: 172,
          homeTeamId: userTeam.teamId,
          awayTeamId: aiTeam.teamId,
          homeRim: 40,
          homeFga: 80,
        }),
      ],
      adaptingTeamId: aiTeam.teamId,
      opponentTeamId: userTeam.teamId,
      userTeamId: userTeam.teamId,
    });
    expect(paintAdapt?.defense).toBe('protect-paint');

    const pressureAdapt = fullCourtPlayoffAdaptationForTeam({
      seriesGames: [
        scoreWithEvidence({
          gameId: 'fcp-1-0-1',
          dayOffset: 170,
          homeTeamId: userTeam.teamId,
          awayTeamId: aiTeam.teamId,
          homeRim: 24,
          homeFga: 80,
          homeLeadUsage: 2900,
          homeTeamUsage: 10000,
        }),
        scoreWithEvidence({
          gameId: 'fcp-1-0-2',
          dayOffset: 172,
          homeTeamId: userTeam.teamId,
          awayTeamId: aiTeam.teamId,
          homeRim: 24,
          homeFga: 80,
          homeLeadUsage: 2800,
          homeTeamUsage: 10000,
        }),
      ],
      adaptingTeamId: aiTeam.teamId,
      opponentTeamId: userTeam.teamId,
      userTeamId: userTeam.teamId,
    });
    expect(pressureAdapt?.defense).toBe('pressure');

    let baseRim = 0;
    let paintRim = 0;
    let baseFga = 0;
    let paintFga = 0;
    let baseThrees = 0;
    let paintThrees = 0;
    let baseUserTurnovers = 0;
    let pressureUserTurnovers = 0;
    let baseAiSteals = 0;
    let pressureAiSteals = 0;
    let baseAiDreb = 0;
    let pressureAiDreb = 0;

    for (let index = 0; index < 32; index += 1) {
      const seed = seedSchema.parse(`${'a'.repeat(24)}${String(index).padStart(8, '0')}`);
      const baseGame = simulateFullCourtGame(
        {
          schemaVersion: 1,
          seed,
          gameNumber: 85,
          dataVersion: lock.season.catalog.dataVersion,
          profile: lock.season.profile,
          home: {
            ...userTeam,
            tactics: { pace: 'balanced', offense: 'interior', defense: 'balanced' },
          },
          away: aiTeam,
        },
        context,
      );
      const paintGame = simulateFullCourtGame(
        {
          schemaVersion: 1,
          seed,
          gameNumber: 85,
          dataVersion: lock.season.catalog.dataVersion,
          profile: lock.season.profile,
          home: {
            ...userTeam,
            tactics: { pace: 'balanced', offense: 'interior', defense: 'balanced' },
          },
          away: {
            ...aiTeam,
            tactics: {
              pace: 'balanced',
              offense: 'balanced',
              defense: paintAdapt?.defense ?? 'balanced',
            },
          },
        },
        context,
      );
      const pressureBase = simulateFullCourtGame(
        {
          schemaVersion: 1,
          seed,
          gameNumber: 85,
          dataVersion: lock.season.catalog.dataVersion,
          profile: lock.season.profile,
          home: userTeam,
          away: aiTeam,
        },
        context,
      );
      const pressureGame = simulateFullCourtGame(
        {
          schemaVersion: 1,
          seed,
          gameNumber: 85,
          dataVersion: lock.season.catalog.dataVersion,
          profile: lock.season.profile,
          home: userTeam,
          away: {
            ...aiTeam,
            tactics: {
              pace: 'balanced',
              offense: 'balanced',
              defense: pressureAdapt?.defense ?? 'balanced',
            },
          },
        },
        context,
      );

      baseRim += fullCourtPlayoffGameEvidence(baseGame)?.home.rimAttempts ?? 0;
      paintRim += fullCourtPlayoffGameEvidence(paintGame)?.home.rimAttempts ?? 0;
      baseFga += baseGame.home.box.fieldGoals.attempted;
      paintFga += paintGame.home.box.fieldGoals.attempted;
      baseThrees += baseGame.home.box.threes.attempted;
      paintThrees += paintGame.home.box.threes.attempted;

      baseUserTurnovers += pressureBase.home.box.turnovers;
      pressureUserTurnovers += pressureGame.home.box.turnovers;
      baseAiSteals += pressureBase.away.box.steals;
      pressureAiSteals += pressureGame.away.box.steals;
      baseAiDreb += pressureBase.away.box.rebounds.defensive;
      pressureAiDreb += pressureGame.away.box.rebounds.defensive;
    }

    expect(paintRim / 32).toBeLessThan(baseRim / 32 - 2);
    expect(paintThrees / 32).toBeGreaterThan(baseThrees / 32 + 0.4);
    expect(paintThrees / paintFga).toBeGreaterThan(baseThrees / baseFga);
    expect(pressureUserTurnovers / 32).toBeGreaterThan(baseUserTurnovers / 32 + 0.25);
    expect(pressureAiSteals / 32).toBeGreaterThan(baseAiSteals / 32 + 0.2);
    expect(pressureAiDreb / 32).toBeLessThan(baseAiDreb / 32 - 0.5);
    expect(JSON.stringify(userTeam.roster)).toBe(userSnapshot);
    expect(JSON.stringify(aiTeam.roster)).toBe(aiSnapshot);
  }, 30_000);

  test('integrates into playoff series progression deterministically, preserves retry & legacy compatibility, and rejects tampering', () => {
    const { lock, playoffs } = completedPlayoffSetup(true);
    const context = createEngineContext();
    let checkpoint = createFullCourtPlayoffCheckpoint(playoffs);

    // Advance until user's series has 2 played games with interior offense, triggering protect-paint for Game 3.
    let game3Preview = null as ReturnType<typeof fullCourtUserNextPlayoffMatchup>;
    for (let step = 0; step < 30; step += 1) {
      const preview = fullCourtUserNextPlayoffMatchup({
        userTeamId: lock.season.userTeamId,
        runSeed: lock.season.runSeed,
        series: fullCourtPlayoffView(playoffs, checkpoint).series,
      });
      if (preview !== null && preview.gameOrdinal === 3) {
        game3Preview = preview;
        break;
      }
      const outcome = simulateFullCourtPlayoffGame(playoffs, checkpoint, context, {
        tactics: { pace: 'balanced', offense: 'interior', defense: 'balanced' },
      });
      if (outcome.kind !== 'simulated') throw new Error('Expected simulated playoff step');
      if (step < 8) {
        // Retry on same checkpoint must produce exact same checkpoint and result.
        const retry = simulateFullCourtPlayoffGame(playoffs, structuredClone(checkpoint), context, {
          tactics: { pace: 'balanced', offense: 'interior', defense: 'balanced' },
        });
        expect(retry).toEqual(outcome);
      }
      checkpoint = outcome.checkpoint;
    }

    expect(game3Preview).not.toBeNull();
    expect(game3Preview?.priorPlayedGames).toBe(2);
    expect(game3Preview?.adaptation?.defense).toBe('protect-paint');
    expect(game3Preview?.adaptation?.reason).toBe('persistent-inside-scoring');

    // Legacy checkpoint without evidence or adaptations remains valid and adds no adaptation.
    const legacyCheckpoint = fullCourtPlayoffCheckpointSchema.parse({
      ...checkpoint,
      schemaVersion: FULL_COURT_PLAYOFFS_VERSION,
      games: checkpoint.games.map(
        ({ gameId, dayOffset, homeTeamId, awayTeamId, winnerTeamId, outcome }) => ({
          gameId,
          dayOffset,
          homeTeamId,
          awayTeamId,
          winnerTeamId,
          outcome,
        }),
      ),
    });
    const legacyView = fullCourtPlayoffView(playoffs, legacyCheckpoint);
    expect(
      fullCourtUserNextPlayoffMatchup({
        userTeamId: lock.season.userTeamId,
        runSeed: lock.season.runSeed,
        series: legacyView.series,
      })?.adaptation,
    ).toBeNull();

    // Advance until user Game 3 actually runs so Game 3 records the applied adaptation.
    let userGame3Score: FullCourtPlayoffScore | undefined;
    for (let step = 0; step < 16; step += 1) {
      const next = fullCourtPlayoffView(playoffs, checkpoint).nextGame;
      const outcome = simulateFullCourtPlayoffGame(playoffs, checkpoint, context, {
        tactics: { pace: 'balanced', offense: 'interior', defense: 'balanced' },
      });
      if (outcome.kind !== 'simulated') throw new Error('Expected simulated game 3');
      checkpoint = outcome.checkpoint;
      if (next?.gameId === game3Preview?.gameId) {
        userGame3Score = checkpoint.games.at(-1);
        break;
      }
    }

    expect(userGame3Score).toBeDefined();
    expect(userGame3Score?.adaptations).toBeDefined();
    const userSide = game3Preview?.userSide;
    if (userSide === undefined) throw new Error('Expected user side');
    const aiSide = userSide === 'home' ? 'away' : 'home';
    expect(userGame3Score?.adaptations?.[aiSide]?.defense).toBe('protect-paint');
    expect(userGame3Score?.adaptations?.[userSide]).toBeUndefined();

    // Tampering with recorded adaptation fails validation.
    const tampered = structuredClone(checkpoint);
    const last = tampered.games.at(-1);
    if (last === undefined) throw new Error('Missing last game');
    delete last.adaptations;
    expect(() => fullCourtPlayoffView(playoffs, tampered)).toThrow(
      'adaptation does not match series evidence',
    );
  }, 30_000);

  test('keeps seeded no-adaptation game digest unchanged when evidence stays below thresholds', () => {
    const { playoffs } = completedPlayoffSetup(true);
    const context = createEngineContext();
    let checkpoint = createFullCourtPlayoffCheckpoint(playoffs);
    const first = simulateFullCourtPlayoffGame(playoffs, checkpoint, context);
    if (first.kind !== 'simulated' || first.game.kind !== 'played') {
      throw new Error('Expected played game');
    }
    const view = fullCourtPlayoffView(playoffs, checkpoint);
    const fixture = view.nextGame;
    if (fixture === null) throw new Error('Missing next fixture');
    const home = playoffs.seasonLock.season.teams.find((t) => t.teamId === fixture.homeTeamId);
    const away = playoffs.seasonLock.season.teams.find((t) => t.teamId === fixture.awayTeamId);
    if (home === undefined || away === undefined) throw new Error('Missing teams');
    const direct = simulateFullCourtGame(
      {
        schemaVersion: 1,
        seed: fixture.seed,
        gameNumber: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM + 1,
        dataVersion: playoffs.seasonLock.season.catalog.dataVersion,
        profile: playoffs.seasonLock.season.profile,
        home,
        away,
      },
      context,
    );
    expect(fullCourtGameDigest(first.game.result)).toBe(fullCourtGameDigest(direct));
    expect(first.checkpoint.games[0]?.adaptations).toBeUndefined();
    checkpoint = first.checkpoint;
    expect(checkpoint.games).toHaveLength(1);
  });
});
