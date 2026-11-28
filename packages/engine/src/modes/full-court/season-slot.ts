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
import { NBA_LEAGUE_RULES } from '../../league/nba.ts';
import { validateLeagueSchedule } from '../../league/schedule.ts';
import { ENGINE_VERSION } from '../../sim/constants.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import { withFullCourtCoaching } from './coaching.ts';
import { checkFullCourtGameResult, FULL_COURT_SEED_VERSION } from './game.ts';
import { runFullCourtGameWithHealth, type FullCourtGameHealthOutcome } from './health.ts';
import { FULL_COURT_INJURY_VERSION } from './injuries.ts';
import type { FullCourtLeagueGame } from './league.ts';
import { fixtureFullCourtDefensiveMatchups } from './matchups.ts';
import { buildFullCourtGameLineupsFromFacts } from './report.ts';
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
  const failures = validateLeagueSchedule(input.games, input.teams, NBA_LEAGUE_RULES);
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

export interface FullCourtAiGameChunk {
  readonly scores: readonly FullCourtSeasonScore[];
  readonly healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'];
}

export type FullCourtUserSlotOutcome =
  | { readonly kind: 'season-complete' }
  | {
      readonly kind: 'decision';
      readonly reason: 'rest-conflict' | 'confirm-forfeit';
      readonly fixture: FullCourtLeagueGame;
    }
  | {
      readonly kind: 'user-ready';
      readonly slot: number;
      readonly userGameId: string;
      readonly userScore: FullCourtSeasonScore;
      readonly healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'];
      readonly userGame: ResolvedGame;
    };

function validatedSlotContext(
  lock: FullCourtSeasonLock,
  previous: FullCourtSeasonCheckpoint,
):
  | { readonly kind: 'season-complete' }
  | {
      readonly kind: 'ready';
      readonly checkpoint: FullCourtSeasonCheckpoint;
      readonly slot: number;
      readonly entries: readonly FullCourtLeagueGame[];
      readonly userFixture: FullCourtLeagueGame;
      readonly userSide: 'home' | 'away';
    } {
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
  return { kind: 'ready', checkpoint, slot, entries, userFixture, userSide };
}

function playSlotFixture(
  lock: FullCourtSeasonLock,
  checkpoint: FullCourtSeasonCheckpoint,
  fixture: FullCourtLeagueGame,
  isUserGame: boolean,
  userSide: 'home' | 'away',
  context: EngineContext,
  options: FullCourtSeasonSlotOptions,
): FullCourtGameHealthOutcome {
  const { season } = lock;
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
            home: fullCourtFutureDaysOf(season, fixture, fixture.homeTeamId),
            away: fullCourtFutureDaysOf(season, fixture, fixture.awayTeamId),
          },
        }),
    ...(isUserGame
      ? {
          restingPlayerIds: { [userSide]: options.restingPlayerIds },
          // Summaries need compact lineup facts, not a playback tape. The tape
          // is built only when a watched replay was requested.
          record: options.record === true,
          lineupFacts: true,
        }
      : {}),
  });
}

function userLineupsOf(
  game: FullCourtGameHealthOutcome,
  gameId: string,
  userSide: 'home' | 'away',
): ReturnType<typeof buildFullCourtGameLineupsFromFacts> | undefined {
  if (game.kind !== 'played' || game.lineupFacts == null) return undefined;
  return buildFullCourtGameLineupsFromFacts({
    kind: 'played',
    gameId,
    userSide,
    result: game.result,
    facts: game.lineupFacts,
  });
}

function checkedScoreFor(
  fixture: FullCourtLeagueGame,
  game: FullCourtGameHealthOutcome,
  isUserGame: boolean,
  userLineups: ReturnType<typeof buildFullCourtGameLineupsFromFacts> | undefined,
  usedDefensiveMatchups = false,
): FullCourtSeasonScore {
  if (game.kind === 'rest-conflict') throw new Error(`Invalid AI rotation for ${fixture.gameId}`);
  if (game.kind === 'played') {
    const failures = checkFullCourtGameResult(game.result);
    if (failures.length > 0) {
      throw new Error(
        `Full Court game ${fixture.gameId} failed accounting: ${failures.join(', ')}`,
      );
    }
  }
  return fullCourtSeasonScoreSchema.parse({
    ...fixture,
    outcome: fullCourtScoreOutcome(game, isUserGame, userLineups, true, {
      usedDefensiveMatchups,
    }),
  });
}

export function simulateFullCourtUserSlot(
  lock: FullCourtSeasonLock,
  previous: FullCourtSeasonCheckpoint,
  context: EngineContext,
  options: FullCourtSeasonSlotOptions = {},
): FullCourtUserSlotOutcome {
  const validated = validatedSlotContext(lock, previous);
  if (validated.kind === 'season-complete') return validated;
  const { checkpoint, slot, userFixture, userSide } = validated;
  const userGame = playSlotFixture(lock, checkpoint, userFixture, true, userSide, context, options);
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
  const userLineups = userLineupsOf(userGame, userFixture.gameId, userSide);
  const opponentTeamId = userSide === 'home' ? userFixture.awayTeamId : userFixture.homeTeamId;
  const usedDefensiveMatchups =
    fixtureFullCourtDefensiveMatchups(
      options.defensiveMatchups,
      userFixture.gameId,
      opponentTeamId,
    ) !== undefined;
  const userScore = checkedScoreFor(
    userFixture,
    userGame,
    true,
    userLineups,
    usedDefensiveMatchups,
  );
  return {
    kind: 'user-ready',
    slot,
    userGameId: userFixture.gameId,
    userScore,
    healthByTeam: {
      [userFixture.homeTeamId]: userGame.health.home,
      [userFixture.awayTeamId]: userGame.health.away,
    },
    userGame:
      userGame.kind === 'played' && options.record !== true
        ? { ...userGame, tape: null }
        : userGame,
  };
}

export function simulateFullCourtAiGames(
  lock: FullCourtSeasonLock,
  previous: FullCourtSeasonCheckpoint,
  gameIds: readonly string[],
  context: EngineContext,
): FullCourtAiGameChunk {
  const validated = validatedSlotContext(lock, previous);
  if (validated.kind === 'season-complete') {
    return { scores: [], healthByTeam: {} };
  }
  const { checkpoint, entries, userFixture, userSide } = validated;
  const byId = new Map(entries.map((fixture) => [fixture.gameId, fixture]));
  const healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'] = {};
  const scores: FullCourtSeasonScore[] = [];
  for (const gameId of gameIds) {
    const fixture = byId.get(gameId);
    if (fixture === undefined || fixture === userFixture) {
      throw new Error(`Invalid Full Court AI game id ${gameId}`);
    }
    const game = playSlotFixture(lock, checkpoint, fixture, false, userSide, context, {});
    if (game.kind === 'rest-conflict') throw new Error(`Invalid AI rotation for ${fixture.gameId}`);
    healthByTeam[fixture.homeTeamId] = game.health.home;
    healthByTeam[fixture.awayTeamId] = game.health.away;
    scores.push(checkedScoreFor(fixture, game, false, undefined));
  }
  return { scores, healthByTeam };
}

export function simulateFullCourtSeasonSlot(
  lock: FullCourtSeasonLock,
  previous: FullCourtSeasonCheckpoint,
  context: EngineContext,
  options: FullCourtSeasonSlotOptions = {},
): FullCourtSeasonSlotOutcome {
  const validated = validatedSlotContext(lock, previous);
  if (validated.kind === 'season-complete') return validated;
  const { checkpoint, slot, entries, userFixture, userSide } = validated;

  const userGame = playSlotFixture(lock, checkpoint, userFixture, true, userSide, context, options);
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
  const userLineups = userLineupsOf(userGame, userFixture.gameId, userSide);
  const opponentTeamId = userSide === 'home' ? userFixture.awayTeamId : userFixture.homeTeamId;
  const usedDefensiveMatchups =
    fixtureFullCourtDefensiveMatchups(
      options.defensiveMatchups,
      userFixture.gameId,
      opponentTeamId,
    ) !== undefined;

  const healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'] = {};
  const scores = entries.map((fixture) => {
    const isUser = fixture === userFixture;
    const game = isUser
      ? userGame
      : playSlotFixture(lock, checkpoint, fixture, false, userSide, context, {});
    if (game.kind === 'rest-conflict') throw new Error(`Invalid AI rotation for ${fixture.gameId}`);
    healthByTeam[fixture.homeTeamId] = game.health.home;
    healthByTeam[fixture.awayTeamId] = game.health.away;
    return checkedScoreFor(
      fixture,
      game,
      isUser,
      isUser ? userLineups : undefined,
      isUser && usedDefensiveMatchups,
    );
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
