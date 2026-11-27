import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  canonicalJson,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  fullCourtHealthProfileSetSchema,
  seasonDigestHex,
  seedSchema,
  type FullCourtCoachingRule,
  type FullCourtDefensiveMatchups,
  type FullCourtOffensiveHierarchy,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtTactics,
  type FullCourtHealthProfileSet,
  type Seed,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION } from '../../sim/constants.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import { validateCapRushLeagueSchedule } from '../cap-rush/league-schedule.ts';
import { withFullCourtCoaching } from './coaching.ts';
import { checkFullCourtGameResult, FULL_COURT_SEED_VERSION } from './game.ts';
import { runFullCourtGameWithHealth, type FullCourtGameHealthOutcome } from './health.ts';
import { FULL_COURT_INJURY_VERSION } from './injuries.ts';
import type { FullCourtLeagueGame } from './league.ts';
import { fixtureFullCourtDefensiveMatchups } from './matchups.ts';
import { buildFullCourtGameLineups } from './report.ts';
import {
  fullCourtFutureDaysOf,
  fullCourtRegularSeasonGameInput,
  fullCourtSeasonIndexOf,
  type FullCourtRegularSeason,
} from './regular-season.ts';
import { FULL_COURT_ROTATION_VERSION, type FullCourtRotationPlanInput } from './rotation.ts';
import { fullCourtScoreOutcome } from './score.ts';

export interface FullCourtSeasonLock {
  readonly digest: Seed;
  readonly season: FullCourtRegularSeason;
  readonly injuryProfiles?: FullCourtHealthProfileSet;
}

export interface FullCourtSeasonSlotOptions {
  readonly rotation?: FullCourtRotationPlanInput;
  readonly tactics?: FullCourtTactics;
  /** Ordered conditional rules applied to the user team's game only. */
  readonly rules?: readonly FullCourtCoachingRule[];
  /** Per-player offensive hierarchy applied to the user team's game only. */
  readonly hierarchy?: FullCourtOffensiveHierarchy;
  /** Per-fixture defensive matchup assignments applied only when opponent and game match. */
  readonly defensiveMatchups?: FullCourtDefensiveMatchups;
  readonly restingPlayerIds?: readonly string[];
  readonly acceptForfeit?: boolean;
  readonly record?: boolean;
}

type ResolvedGame = Exclude<FullCourtGameHealthOutcome, { kind: 'rest-conflict' }>;

export type FullCourtSeasonSlotOutcome =
  | { readonly kind: 'season-complete' }
  | {
      readonly kind: 'decision';
      readonly reason: 'rest-conflict' | 'confirm-forfeit';
      readonly fixture: FullCourtLeagueGame;
    }
  | {
      readonly kind: 'simulated';
      readonly checkpoint: FullCourtSeasonCheckpoint;
      readonly scores: readonly FullCourtSeasonScore[];
      readonly userGame: ResolvedGame;
    };

export function frozenCopy<T extends object>(input: T): T {
  const copy = structuredClone(input);
  function freeze(value: unknown): void {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  freeze(copy);
  return copy;
}

export function lockFullCourtRegularSeason(
  input: FullCourtRegularSeason,
  experimentalInjuries?: {
    readonly profiles: FullCourtHealthProfileSet;
    readonly catalogAssetHash: string;
  },
): FullCourtSeasonLock {
  const failures = validateCapRushLeagueSchedule(input.games, input.teams);
  if (failures.length > 0) throw new Error(`Invalid Full Court schedule: ${failures.join(', ')}`);
  const gameIds = new Set<string>();
  const lastDay = new Map<string, number>();
  for (const game of [...input.games].sort((left, right) => left.slot - right.slot)) {
    if (gameIds.has(game.gameId)) throw new Error(`Duplicate Full Court fixture ${game.gameId}`);
    gameIds.add(game.gameId);
    for (const teamId of [game.homeTeamId, game.awayTeamId]) {
      if (!Number.isSafeInteger(game.dayOffset) || game.dayOffset <= (lastDay.get(teamId) ?? -1)) {
        throw new Error(`Invalid Full Court game day for ${teamId}`);
      }
      lastDay.set(teamId, game.dayOffset);
    }
  }
  const season = frozenCopy(input);
  let injuryProfiles: FullCourtHealthProfileSet | undefined;
  if (experimentalInjuries !== undefined) {
    const profiles = fullCourtHealthProfileSetSchema.parse(experimentalInjuries.profiles);
    if (experimentalInjuries.catalogAssetHash !== profiles.catalogHash) {
      throw new Error('Full Court injury profiles were generated from a different catalog asset');
    }
    const players: FullCourtHealthProfileSet['players'] = {};
    for (const team of season.teams) {
      for (const { playerVersionId } of team.roster) {
        const profile =
          playerVersionId === undefined ? undefined : profiles.players[playerVersionId];
        if (playerVersionId === undefined || profile === undefined) {
          throw new Error(`Full Court injury profile missing on ${team.teamId}`);
        }
        players[playerVersionId] = profile;
      }
    }
    injuryProfiles = frozenCopy({ ...profiles, players });
  }
  const digest = seedSchema.parse(
    seasonDigestHex(
      canonicalJson({
        schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
        engineVersion: ENGINE_VERSION,
        rotationVersion: FULL_COURT_ROTATION_VERSION,
        seedVersion: FULL_COURT_SEED_VERSION,
        healthVersion: FULL_COURT_HEALTH_VERSION,
        experimentalInjuries:
          injuryProfiles === undefined
            ? null
            : {
                injuryVersion: FULL_COURT_INJURY_VERSION,
                profiles: injuryProfiles,
              },
        season,
      }),
    ),
  );
  return Object.freeze({
    digest,
    season,
    ...(injuryProfiles === undefined ? {} : { injuryProfiles }),
  });
}

export function createFullCourtSeasonCheckpoint(
  lock: FullCourtSeasonLock,
): FullCourtSeasonCheckpoint {
  return {
    schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId: lock.season.runId,
    lockDigest: lock.digest,
    completedThroughSlot: 0,
    healthByTeam: {},
  };
}

export function simulateFullCourtSeasonSlot(
  lock: FullCourtSeasonLock,
  previous: FullCourtSeasonCheckpoint,
  context: EngineContext,
  options: FullCourtSeasonSlotOptions = {},
): FullCourtSeasonSlotOutcome {
  const checkpoint = fullCourtSeasonCheckpointSchema.parse(previous);
  const { season } = lock;
  const seasonIndex = fullCourtSeasonIndexOf(season);
  if (checkpoint.runId !== season.runId || checkpoint.lockDigest !== lock.digest) {
    throw new Error('Full Court checkpoint does not match the locked season');
  }
  const previousSlot = checkpoint.completedThroughSlot;
  if (previousSlot > 0) {
    for (const game of seasonIndex.gamesBySlot.get(previousSlot) ?? []) {
      if (
        checkpoint.healthByTeam[game.homeTeamId]?.throughDay !== game.dayOffset ||
        checkpoint.healthByTeam[game.awayTeamId]?.throughDay !== game.dayOffset
      ) {
        throw new Error('Full Court checkpoint health does not match the locked calendar');
      }
    }
  }
  if (previousSlot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) return { kind: 'season-complete' };
  const slot = previousSlot + 1;
  const entries = seasonIndex.gamesBySlot.get(slot) ?? [];
  const participants = new Set(entries.flatMap((game) => [game.homeTeamId, game.awayTeamId]));
  const userFixture = entries.find(
    (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
  );
  if (
    entries.length !== CAP_RUSH_TAKEOVER_TEAMS / 2 ||
    participants.size !== CAP_RUSH_TAKEOVER_TEAMS ||
    userFixture === undefined
  ) {
    throw new Error('Full Court slot must contain one fixture per team');
  }

  const userSide = userFixture.homeTeamId === season.userTeamId ? 'home' : 'away';
  function daysAfter(fixture: FullCourtLeagueGame, teamId: string): readonly number[] {
    return fullCourtFutureDaysOf(season, fixture, teamId);
  }
  function play(fixture: FullCourtLeagueGame, isUserGame: boolean) {
    const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
    const opponentTeamId = userSide === 'home' ? fixture.awayTeamId : fixture.homeTeamId;
    const defensiveMatchups = isUserGame
      ? fixtureFullCourtDefensiveMatchups(options.defensiveMatchups, fixture.gameId, opponentTeamId)
      : undefined;
    const game = isUserGame
      ? {
          ...input,
          [userSide]: withFullCourtCoaching(input[userSide], {
            ...options,
            defensiveMatchups,
          }),
        }
      : input;
    return runFullCourtGameWithHealth(game, fixture.dayOffset, context, {
      health: {
        home: checkpoint.healthByTeam[fixture.homeTeamId],
        away: checkpoint.healthByTeam[fixture.awayTeamId],
      },
      ...(lock.injuryProfiles === undefined
        ? {}
        : {
            injuryProfiles: lock.injuryProfiles,
            futureGameDays: {
              home: daysAfter(fixture, fixture.homeTeamId),
              away: daysAfter(fixture, fixture.awayTeamId),
            },
          }),
      ...(isUserGame
        ? {
            restingPlayerIds: { [userSide]: options.restingPlayerIds },
            // The user game is always recorded internally so compact lineup
            // facts can be derived; the tape is discarded unless it was asked for.
            record: true,
          }
        : {}),
    });
  }

  const userGame = play(userFixture, true);
  if (userGame.kind === 'rest-conflict') {
    return { kind: 'decision', reason: 'rest-conflict', fixture: userFixture };
  }
  if (
    userGame.kind === 'forfeit' &&
    userGame.sides.includes(userSide) &&
    options.acceptForfeit !== true
  ) {
    return { kind: 'decision', reason: 'confirm-forfeit', fixture: userFixture };
  }
  const userLineups =
    userGame.kind === 'played' && userGame.tape !== null
      ? buildFullCourtGameLineups({
          kind: 'played',
          gameId: userFixture.gameId,
          userSide,
          result: userGame.result,
          tape: userGame.tape,
        })
      : undefined;

  const healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'] = {};
  const scores = entries.map((fixture) => {
    const game = fixture === userFixture ? userGame : play(fixture, false);
    if (game.kind === 'rest-conflict') throw new Error(`Invalid AI rotation for ${fixture.gameId}`);
    healthByTeam[fixture.homeTeamId] = game.health.home;
    healthByTeam[fixture.awayTeamId] = game.health.away;
    if (game.kind === 'played') {
      const failures = checkFullCourtGameResult(game.result);
      if (failures.length > 0)
        throw new Error(
          `Full Court game ${fixture.gameId} failed accounting: ${failures.join(', ')}`,
        );
    }
    return fullCourtSeasonScoreSchema.parse({
      ...fixture,
      outcome: fullCourtScoreOutcome(
        game,
        fixture === userFixture,
        fixture === userFixture ? userLineups : undefined,
      ),
    });
  });
  return {
    kind: 'simulated',
    checkpoint: { ...checkpoint, completedThroughSlot: slot, healthByTeam },
    scores,
    userGame:
      userGame.kind === 'played' && options.record !== true
        ? { ...userGame, tape: null }
        : userGame,
  };
}
