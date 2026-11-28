import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_SERIES_WINS,
  FULL_COURT_PLAYOFFS_VERSION,
  canonicalJson,
  capRushSeriesWinner,
  capRushSeriesWins,
  fullCourtPlayoffCheckpointSchema,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  havocInstanceSeed,
  seasonDigestHex,
  seedSchema,
  type CapRushPlayoffGamePlan,
  type CapRushPostseasonUserOutcome,
  type FullCourtPlayoffAdaptation,
  type FullCourtPlayoffCheckpoint,
  type FullCourtPlayoffScore,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type Seed,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import {
  conferenceOpeningSeries,
  finalsHomeCourtOf,
  playoffSeriesFields,
} from '../conference-playoffs.ts';
import { capRushNextPlayoffGamePlan } from '../cap-rush/playoff-shared.ts';
import { adjustedAnchors, adjustedTendencies } from '../cap-rush/playoff.ts';
import { withFullCourtCoaching } from './coaching.ts';
import { checkFullCourtGameResult, type FullCourtTeamGameInput } from './game.ts';
import { runFullCourtGameWithHealth, type FullCourtGameHealthOutcome } from './health.ts';
import { fixtureFullCourtDefensiveMatchups } from './matchups.ts';
import {
  fullCourtPlayoffAdaptationForTeam,
  fullCourtPlayoffAdaptationsEqual,
  fullCourtPlayoffGameEvidence,
  fullCourtPlayoffMatchupAdaptations,
  fullCourtPlayoffSeriesEvidenceCount,
} from './playoff-adaptation.ts';
import { buildFullCourtGameLineupsFromFacts } from './report.ts';
import type { FullCourtRegularSeason } from './regular-season.ts';
import { fullCourtScoreOutcome } from './score.ts';
import {
  frozenCopy,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
} from './season-slot.ts';
import {
  fullCourtStandings,
  type FullCourtStandings,
  type FullCourtStandingsRow,
} from './standings.ts';
import { resolveFullCourtTactics } from './tactics.ts';

const ROUND_GAP_DAYS = 3;
const SERIES_GAME_GAP_DAYS = 2;

export interface FullCourtPlayoffLock {
  readonly seasonLock: FullCourtSeasonLock;
  readonly digest: Seed;
  readonly standings: FullCourtStandings;
  readonly initialHealth: FullCourtSeasonCheckpoint['healthByTeam'];
  readonly regularScores: readonly FullCourtSeasonScore[];
  readonly firstGameDay: number;
}

export interface FullCourtPlayoffSeries {
  readonly seriesId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly highSeed: number;
  readonly lowSeed: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly games: FullCourtPlayoffScore[];
}

export interface FullCourtPlayoffFixture extends CapRushPlayoffGamePlan {
  readonly gameId: string;
  readonly dayOffset: number;
}

export interface FullCourtPlayoffOpponentPreview {
  readonly gameId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly gameOrdinal: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeSeed: number;
  readonly awaySeed: number;
  readonly userSide: 'home' | 'away';
  readonly opponentTeamId: string;
  readonly priorPlayedGames: number;
  readonly adaptation: FullCourtPlayoffAdaptation | null;
}

function applyAiAdaptation(
  team: FullCourtTeamGameInput,
  adaptation: FullCourtPlayoffAdaptation | undefined,
): FullCourtTeamGameInput {
  if (adaptation === undefined) return team;
  return {
    ...team,
    tactics: {
      ...resolveFullCourtTactics(team.tactics),
      defense: adaptation.defense,
    },
  };
}

type ResolvedGame = Exclude<FullCourtGameHealthOutcome, { kind: 'rest-conflict' }>;
export type FullCourtPlayoffGameOutcome =
  | { readonly kind: 'playoffs-complete' }
  | {
      readonly kind: 'decision';
      readonly reason: 'rest-conflict' | 'confirm-forfeit';
      readonly fixture: FullCourtPlayoffFixture;
    }
  | {
      readonly kind: 'simulated';
      readonly checkpoint: FullCourtPlayoffCheckpoint;
      readonly game: ResolvedGame;
    };

export function lockFullCourtPlayoffs(
  seasonLock: FullCourtSeasonLock,
  input: FullCourtSeasonCheckpoint,
  scores: readonly FullCourtSeasonScore[],
): FullCourtPlayoffLock {
  const { season } = seasonLock;
  const regular = fullCourtSeasonCheckpointSchema.parse(input);
  if (
    regular.completedThroughSlot !== CAP_RUSH_CONFERENCE_GAMES_PER_TEAM ||
    regular.runId !== season.runId ||
    regular.lockDigest !== seasonLock.digest
  ) {
    throw new Error('Full Court playoffs require the completed locked regular season');
  }
  const byId = new Map(
    scores.map((score) => [score.gameId, fullCourtSeasonScoreSchema.parse(score)]),
  );
  if (scores.length !== season.games.length || byId.size !== scores.length) {
    throw new Error('Full Court playoffs require one score per regular-season fixture');
  }
  const regularScores = season.games.map((fixture) => {
    const score = byId.get(fixture.gameId);
    if (
      score === undefined ||
      score.slot !== fixture.slot ||
      score.homeTeamId !== fixture.homeTeamId ||
      score.awayTeamId !== fixture.awayTeamId
    ) {
      throw new Error(`Full Court regular-season score does not match ${fixture.gameId}`);
    }
    if (
      fixture.slot === regular.completedThroughSlot &&
      (regular.healthByTeam[fixture.homeTeamId]?.throughDay !== fixture.dayOffset ||
        regular.healthByTeam[fixture.awayTeamId]?.throughDay !== fixture.dayOffset)
    ) {
      throw new Error('Full Court playoff health does not match the completed calendar');
    }
    return score;
  });
  const digest = seedSchema.parse(
    seasonDigestHex(canonicalJson([FULL_COURT_PLAYOFFS_VERSION, regular, regularScores])),
  );
  const inputs = frozenCopy({
    regularScores,
    standings: fullCourtStandings(season.teams, regularScores),
    initialHealth: regular.healthByTeam,
  });
  return Object.freeze({
    seasonLock,
    digest,
    ...inputs,
    firstGameDay: Math.max(...season.games.map((game) => game.dayOffset)) + ROUND_GAP_DAYS,
  });
}

export function createFullCourtPlayoffCheckpoint(
  lock: FullCourtPlayoffLock,
): FullCourtPlayoffCheckpoint {
  return fullCourtPlayoffCheckpointSchema.parse({
    schemaVersion: FULL_COURT_PLAYOFFS_VERSION,
    runId: lock.seasonLock.season.runId,
    lockDigest: lock.digest,
    games: [],
    healthByTeam: lock.initialHealth,
  });
}

function seriesOf(
  round: number,
  seriesSlot: number,
  high: FullCourtStandingsRow,
  low: FullCourtStandingsRow,
): FullCourtPlayoffSeries {
  return {
    ...playoffSeriesFields(round, seriesSlot, high, low),
    games: [],
  };
}

function requireRow(row: FullCourtStandingsRow | undefined): FullCourtStandingsRow {
  if (row === undefined) throw new Error('Missing Full Court playoff seed');
  return row;
}

function winnerOf(
  game: Pick<FullCourtPlayoffScore, 'outcome' | 'homeTeamId' | 'awayTeamId'>,
  doubleForfeit: string | null,
): string | null {
  const { outcome, homeTeamId, awayTeamId } = game;
  if (outcome.kind === 'played') {
    if (outcome.homePoints === outcome.awayPoints)
      throw new Error('A Full Court game cannot end tied');
    return outcome.homePoints > outcome.awayPoints ? homeTeamId : awayTeamId;
  }
  if (outcome.losingSides.length === 2) return doubleForfeit;
  return outcome.losingSides[0] === 'home' ? awayTeamId : homeTeamId;
}

function nextRound(
  lock: FullCourtPlayoffLock,
  current: readonly FullCourtPlayoffSeries[],
  round: number,
): FullCourtPlayoffSeries[] {
  const entries = [...lock.standings.west, ...lock.standings.east];
  const winners = current.map((series) =>
    requireRow(entries.find((row) => row.teamId === capRushSeriesWinner(series))),
  );
  const result: FullCourtPlayoffSeries[] = [];
  for (let index = 0; index < winners.length; index += 2) {
    const left = requireRow(winners[index]);
    const right = requireRow(winners[index + 1]);
    let high = left.seed <= right.seed ? left : right;
    if (round === CAP_RUSH_PLAYOFF_ROUNDS) {
      const headToHead = lock.regularScores
        .filter(
          (game) =>
            (game.homeTeamId === left.teamId && game.awayTeamId === right.teamId) ||
            (game.homeTeamId === right.teamId && game.awayTeamId === left.teamId),
        )
        .map((game) => winnerOf(game, null));
      high =
        finalsHomeCourtOf(
          left,
          right,
          headToHead.filter((winner) => winner === left.teamId).length,
          headToHead.filter((winner) => winner === right.teamId).length,
        ) === left.teamId
          ? left
          : right;
    }
    result.push(seriesOf(round, index / 2, high, high === left ? right : left));
  }
  return result;
}

function playoffState(lock: FullCourtPlayoffLock, previous: FullCourtPlayoffCheckpoint) {
  const checkpoint = fullCourtPlayoffCheckpointSchema.parse(previous);
  const { season } = lock.seasonLock;
  if (checkpoint.runId !== season.runId || checkpoint.lockDigest !== lock.digest) {
    throw new Error('Full Court playoff checkpoint does not match the locked season');
  }
  let current = conferenceOpeningSeries(
    [lock.standings.west, lock.standings.east],
    (slot, high, low) => seriesOf(1, slot, high, low),
    'Missing Full Court playoff seed',
  );
  const series = [...current];
  let round = 1;
  let startDay = lock.firstGameDay;
  const expectedDays = new Map(
    Object.entries(lock.initialHealth).map(([id, health]) => [id, health.throughDay]),
  );
  let lastDay = startDay;
  const playoffSeed = havocInstanceSeed(season.runSeed, 'full-court-playoffs-v1');
  function next() {
    let selected = current
      .filter((entry) => capRushSeriesWinner(entry) === null)
      .sort(
        (left, right) =>
          left.games.length - right.games.length || left.seriesSlot - right.seriesSlot,
      )[0];
    if (selected === undefined && round < CAP_RUSH_PLAYOFF_ROUNDS) {
      round += 1;
      current = nextRound(lock, current, round);
      series.push(...current);
      startDay = lastDay + ROUND_GAP_DAYS;
      selected = current[0];
    }
    if (selected === undefined) return null;
    const plan = capRushNextPlayoffGamePlan({
      series: selected,
      runSeed: playoffSeed,
      userTeamId: season.userTeamId,
    });
    const fixture: FullCourtPlayoffFixture = {
      ...plan,
      gameId: `fcp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
      dayOffset: startDay + (plan.gameOrdinal - 1) * SERIES_GAME_GAP_DAYS,
    };
    return { fixture, series: selected };
  }
  for (const game of checkpoint.games) {
    const planned = next();
    if (
      planned === null ||
      game.gameId !== planned.fixture.gameId ||
      game.dayOffset !== planned.fixture.dayOffset ||
      game.homeTeamId !== planned.fixture.homeTeamId ||
      game.awayTeamId !== planned.fixture.awayTeamId ||
      game.winnerTeamId !== winnerOf(game, planned.series.highTeamId)
    ) {
      throw new Error(`Full Court playoff score does not match the bracket for ${game.gameId}`);
    }
    if (game.outcome.kind === 'forfeit') {
      if (game.evidence !== undefined || game.adaptations !== undefined) {
        throw new Error(`Forfeit playoff game cannot carry adaptation data for ${game.gameId}`);
      }
    } else if (game.evidence !== undefined || game.adaptations !== undefined) {
      const expectedAdaptations = fullCourtPlayoffMatchupAdaptations({
        seriesGames: planned.series.games,
        homeTeamId: planned.fixture.homeTeamId,
        awayTeamId: planned.fixture.awayTeamId,
        userTeamId: season.userTeamId,
      });
      if (!fullCourtPlayoffAdaptationsEqual(game.adaptations, expectedAdaptations)) {
        throw new Error(
          `Full Court playoff adaptation does not match series evidence for ${game.gameId}`,
        );
      }
    }
    planned.series.games.push(game);
    lastDay = game.dayOffset;
    expectedDays.set(game.homeTeamId, game.dayOffset);
    expectedDays.set(game.awayTeamId, game.dayOffset);
  }
  for (const [id, day] of expectedDays) {
    if (checkpoint.healthByTeam[id]?.throughDay !== day)
      throw new Error(`Full Court playoff health has the wrong game day for ${id}`);
  }
  return { checkpoint, series, upcoming: next() };
}

export function fullCourtPlayoffView(
  lock: FullCourtPlayoffLock,
  checkpoint: FullCourtPlayoffCheckpoint,
) {
  const { series, upcoming } = playoffState(lock, checkpoint);
  const user = lock.seasonLock.season.userTeamId;
  const userSeries = series
    .filter((entry) => entry.highTeamId === user || entry.lowTeamId === user)
    .at(-1);
  const finals = series.find((entry) => entry.round === CAP_RUSH_PLAYOFF_ROUNDS);
  const champion = finals === undefined ? null : capRushSeriesWinner(finals);
  const winner = userSeries === undefined ? null : capRushSeriesWinner(userSeries);
  const userOutcome: CapRushPostseasonUserOutcome =
    userSeries === undefined
      ? { status: 'not-qualified', round: null }
      : winner !== null && winner !== user
        ? { status: 'eliminated', round: userSeries.round }
        : champion === user
          ? { status: 'champion', round: CAP_RUSH_PLAYOFF_ROUNDS }
          : { status: 'pending', round: null };
  return { series, championTeamId: champion, userOutcome, nextGame: upcoming?.fixture ?? null };
}

export function fullCourtUserNextPlayoffMatchup(input: {
  readonly userTeamId: string;
  readonly runSeed: Seed;
  readonly series: readonly FullCourtPlayoffSeries[];
}): FullCourtPlayoffOpponentPreview | null {
  const { userTeamId, runSeed, series } = input;
  const userSeries = series
    .filter((entry) => entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId)
    .at(-1);
  if (userSeries === undefined || capRushSeriesWinner(userSeries) !== null) return null;
  const playoffSeed = havocInstanceSeed(runSeed, 'full-court-playoffs-v1');
  const plan = capRushNextPlayoffGamePlan({
    series: userSeries,
    runSeed: playoffSeed,
    userTeamId,
  });
  if (plan.userSide === null) return null;
  const opponentTeamId = plan.userSide === 'home' ? plan.awayTeamId : plan.homeTeamId;
  return {
    gameId: `fcp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
    round: plan.round,
    seriesSlot: plan.seriesSlot,
    gameOrdinal: plan.gameOrdinal,
    homeTeamId: plan.homeTeamId,
    awayTeamId: plan.awayTeamId,
    homeSeed: plan.homeSeed,
    awaySeed: plan.awaySeed,
    userSide: plan.userSide,
    opponentTeamId,
    priorPlayedGames: fullCourtPlayoffSeriesEvidenceCount(
      userSeries.games,
      opponentTeamId,
      userTeamId,
    ),
    adaptation:
      fullCourtPlayoffAdaptationForTeam({
        seriesGames: userSeries.games,
        adaptingTeamId: opponentTeamId,
        opponentTeamId: userTeamId,
        userTeamId,
      }) ?? null,
  };
}

function withFullCourtPlayoffEffects<T extends { readonly roster: readonly SimulationPlayer[] }>(
  team: T,
  playoffEffects: FullCourtRegularSeason['playoffEffects'],
): T {
  if (playoffEffects === undefined) return team;
  return {
    ...team,
    roster: team.roster.map((player) => {
      const applied =
        player.playerVersionId === undefined ? undefined : playoffEffects[player.playerVersionId];
      if (applied === undefined) return player;
      return {
        ...player,
        tendencies: adjustedTendencies(player.tendencies, applied),
        ...(player.anchors === undefined
          ? {}
          : { anchors: adjustedAnchors(player.anchors, applied) }),
      };
    }),
  };
}

export function simulateFullCourtPlayoffGame(
  lock: FullCourtPlayoffLock,
  previous: FullCourtPlayoffCheckpoint,
  context: EngineContext,
  options: FullCourtSeasonSlotOptions = {},
): FullCourtPlayoffGameOutcome {
  const { checkpoint, upcoming } = playoffState(lock, previous);
  if (upcoming === null) return { kind: 'playoffs-complete' };
  const { fixture, series } = upcoming;
  const { season, injuryProfiles } = lock.seasonLock;
  const home = season.teams.find((team) => team.teamId === fixture.homeTeamId);
  const away = season.teams.find((team) => team.teamId === fixture.awayTeamId);
  if (home === undefined || away === undefined) throw new Error('Missing Full Court playoff team');
  const adaptations = fullCourtPlayoffMatchupAdaptations({
    seriesGames: series.games,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    userTeamId: season.userTeamId,
  });
  const leadingWins = Math.max(
    capRushSeriesWins(series, series.highTeamId),
    capRushSeriesWins(series, series.lowTeamId),
  );
  const futureDays = Array.from(
    { length: CAP_RUSH_SERIES_WINS - leadingWins - 1 },
    (_, index) => fixture.dayOffset + (index + 1) * SERIES_GAME_GAP_DAYS,
  );
  const side = fixture.userSide;
  const userDefensiveMatchups =
    side === null
      ? undefined
      : fixtureFullCourtDefensiveMatchups(
          options.defensiveMatchups,
          fixture.gameId,
          side === 'home' ? away.teamId : home.teamId,
        );
  const homeTeam = withFullCourtPlayoffEffects(
    side === 'home'
      ? withFullCourtCoaching(home, { ...options, defensiveMatchups: userDefensiveMatchups })
      : applyAiAdaptation(home, adaptations?.home),
    season.playoffEffects,
  );
  const awayTeam = withFullCourtPlayoffEffects(
    side === 'away'
      ? withFullCourtCoaching(away, { ...options, defensiveMatchups: userDefensiveMatchups })
      : applyAiAdaptation(away, adaptations?.away),
    season.playoffEffects,
  );
  const game = runFullCourtGameWithHealth(
    {
      schemaVersion: 1,
      seed: fixture.seed,
      gameNumber: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM + checkpoint.games.length + 1,
      dataVersion: season.catalog.dataVersion,
      profile: season.profile,
      home: homeTeam,
      away: awayTeam,
    },
    fixture.dayOffset,
    context,
    {
      health: {
        home: checkpoint.healthByTeam[home.teamId],
        away: checkpoint.healthByTeam[away.teamId],
      },
      ...(injuryProfiles === undefined
        ? {}
        : { injuryProfiles, futureGameDays: { home: futureDays, away: futureDays } }),
      ...(side === null
        ? {}
        : {
            restingPlayerIds: { [side]: options.restingPlayerIds },
            // Summaries need compact lineup facts, not a playback tape. The tape
            // only reaches the caller when a watch replay was requested.
            record: options.record === true,
            lineupFacts: true,
          }),
    },
  );
  if (game.kind === 'rest-conflict') return { kind: 'decision', reason: 'rest-conflict', fixture };
  if (
    game.kind === 'forfeit' &&
    side !== null &&
    game.sides.includes(side) &&
    options.acceptForfeit !== true
  ) {
    return { kind: 'decision', reason: 'confirm-forfeit', fixture };
  }
  let evidence: FullCourtPlayoffScore['evidence'];
  if (game.kind === 'played') {
    const failures = checkFullCourtGameResult(game.result);
    if (failures.length > 0)
      throw new Error(`Full Court playoff accounting: ${failures.join(', ')}`);
    evidence = fullCourtPlayoffGameEvidence(game.result);
  }
  const userLineups =
    side !== null && game.kind === 'played' && game.lineupFacts != null
      ? buildFullCourtGameLineupsFromFacts({
          kind: 'played',
          gameId: fixture.gameId,
          userSide: side,
          result: game.result,
          facts: game.lineupFacts,
        })
      : undefined;
  const score: Omit<FullCourtPlayoffScore, 'winnerTeamId'> = {
    gameId: fixture.gameId,
    dayOffset: fixture.dayOffset,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    outcome: fullCourtScoreOutcome(game, side !== null, userLineups, true),
    ...(game.kind === 'played' && evidence !== undefined ? { evidence } : {}),
    ...(game.kind === 'played' && adaptations !== undefined ? { adaptations } : {}),
  };
  const winnerTeamId = winnerOf(score, series.highTeamId);
  if (winnerTeamId === null) throw new Error('Missing Full Court playoff winner');
  return {
    kind: 'simulated',
    game:
      side !== null && game.kind === 'played' && options.record !== true
        ? { ...game, tape: null }
        : game,
    checkpoint: {
      ...checkpoint,
      games: [...checkpoint.games, { ...score, winnerTeamId }],
      healthByTeam: {
        ...checkpoint.healthByTeam,
        [home.teamId]: game.health.home,
        [away.teamId]: game.health.away,
      },
    },
  };
}
