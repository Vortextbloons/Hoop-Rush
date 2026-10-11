import {
  SEASON_POSTSEASON_SUMMARY_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_SEED_NAMESPACES,
  franchiseIdSchema,
  parsePlayoffGameId,
  postseasonPhaseOfGameId,
  seasonGameIdSchema,
  seasonNamespaceSeed,
  seasonPostseasonSummaryDigest,
  seasonPostseasonSummarySchema,
  type ConferenceId,
  type EraSimulationProfile,
  type Position,
  type SeasonCompactInjuryEvent,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameEffectsTransition,
  type SeasonGamePlayerInput,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonLeague,
  type SeasonPostseasonState,
  type SeasonPostseasonSummary,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { applySeasonGameEffectsTransition } from '../effects.ts';
import { seasonGameSummaryFromResult } from '../game-summary.ts';
import { seasonFranchiseLegalFiveFacts, seasonPregameAvailabilityOf } from '../health.ts';
import { SEASON_HOME_COURT_PROFILE } from '../home-court.ts';
import { resolveHomeGameRule } from '../evolution.ts';
import { applySeasonGameHealthTransition } from '../injuries.ts';
import { conferenceOf } from '../league.ts';
import { simulateSeasonGameWithEffects } from '../season-game.ts';
import { findSeriesOrNull } from './bracket.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
import { postseasonGameHealthSeam } from './injuries.ts';
import { parsePlayInGameId } from './play-in.ts';
import { seasonPostseasonGameOrdinal, seasonPostseasonGameTeamsOf } from './schedule.ts';
import type { SeasonPostseasonGameFacts } from './types.ts';

export type SeasonPostseasonGameResolver = (input: {
  gameId: string;
  gameInput: SeasonGameSimulationInput;
  pregameEffects: SeasonEffectsState;
}) => {
  result: SeasonGameSimulationResult;
  transition: SeasonGameEffectsTransition;
};
export function defaultSeasonPostseasonGameResolver(input: {
  gameId: string;
  gameInput: SeasonGameSimulationInput;
  pregameEffects: SeasonEffectsState;
}): {
  result: SeasonGameSimulationResult;
  transition: SeasonGameEffectsTransition;
} {
  return simulateSeasonGameWithEffects(
    input.gameInput,
    createEngineContext(),
    input.pregameEffects,
  );
}
export function zeroSeasonGameTransition(effects: SeasonEffectsState): SeasonGameEffectsTransition {
  return {
    schemaVersion: 1,
    pregamePlayerStates: [...effects.playerStates],
    postgamePlayerStates: [...effects.playerStates],
    pairIncrements: [],
    evidence: [],
  };
}
export type SeasonPostseasonGameOutcome =
  | {
      kind: 'simulated';
      facts: SeasonPostseasonGameFacts;
      summary: SeasonPostseasonSummary;
      nextHealth: SeasonHealthState;
      nextEffects: SeasonEffectsState;
    }
  | {
      kind: 'integrity-failure';
      reason: string;
    };
export interface SeasonPostseasonGameSimulationInput {
  run: SeasonRun;
  effects: SeasonEffectsState;
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  gameId: string;
  humanFranchiseId: string | null;
  forfeitHumanGame?: boolean;
}
export function simulateSeasonPostseasonGame(
  input: SeasonPostseasonGameSimulationInput,
  options: {
    resolver?: SeasonPostseasonGameResolver;
  } = {},
): SeasonPostseasonGameOutcome {
  const { run, effects, catalog, profile, gameId, humanFranchiseId } = input;
  const phase = postseasonPhaseOfGameId(gameId);
  const teams = seasonPostseasonGameTeamsOf(run.postseason, gameId);
  if (teams === null) {
    return {
      kind: 'integrity-failure',
      reason: `game ${gameId} is not scheduleable from the current postseason state`,
    };
  }
  const homeId = teams.home;
  const awayId = teams.away;
  const homeRoster = run.rosters.find((roster) => roster.franchiseId === homeId);
  const awayRoster = run.rosters.find((roster) => roster.franchiseId === awayId);
  const homeRotation = run.rotations.find((rotation) => rotation.franchiseId === homeId);
  const awayRotation = run.rotations.find((rotation) => rotation.franchiseId === awayId);
  if (
    homeRoster === undefined ||
    awayRoster === undefined ||
    homeRotation === undefined ||
    awayRotation === undefined
  ) {
    return {
      kind: 'integrity-failure',
      reason: `game ${gameId} references a roster or rotation outside the run`,
    };
  }
  const expandedPlayers = (roster: typeof homeRoster): SeasonGamePlayerInput[] =>
    roster.players.map((player) => expandedPlayer(input, player.playerVersionId));
  const activePlayers = (
    players: readonly SeasonGamePlayerInput[],
    rotation: typeof homeRotation,
  ): SeasonGamePlayerInput[] => {
    const activeIds = new Set([...rotation.starters, ...rotation.benchOrder]);
    return players.filter((player) => activeIds.has(player.playerVersionId));
  };
  const allHomePlayers = expandedPlayers(homeRoster);
  const allAwayPlayers = expandedPlayers(awayRoster);
  const homePlayers = activePlayers(allHomePlayers, homeRotation);
  const awayPlayers = activePlayers(allAwayPlayers, awayRotation);
  const seed = seasonNamespaceSeed(
    run.rootSeed,
    phase === 'play-in' ? SEASON_SEED_NAMESPACES.playInGames : SEASON_SEED_NAMESPACES.playoffGames,
    gameId,
  );
  if (
    input.forfeitHumanGame === true &&
    humanFranchiseId !== null &&
    (homeId === humanFranchiseId || awayId === humanFranchiseId)
  ) {
    const humanIsHome = homeId === humanFranchiseId;
    const winnerFranchiseId = humanIsHome ? awayId : homeId;
    const result: SeasonGameSimulationResult = {
      schemaVersion: 1,
      outcome: 'forfeit',
      seed,
      gameNumber: seasonPostseasonGameOrdinal(gameId),
      dataVersion: catalog.dataVersion,
      engineVersion: createEngineContext().engineVersion,
      profileVersion: profile.profileVersion,
      winner: humanIsHome ? 'away' : 'home',
      losingFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
      trigger: 'human-interruption-forfeit',
      homeScore: humanIsHome ? 0 : 2,
      awayScore: humanIsHome ? 2 : 0,
    };
    const factsOf = roundFactsOf(run.postseason, run.league, gameId);
    const summary = seasonPostseasonSummaryFromGame({
      runId: run.runId,
      gameId,
      phase,
      round: factsOf.round,
      seriesId: factsOf.seriesId,
      gameNumber: factsOf.gameNumber,
      conference: factsOf.conference,
      homeFranchiseId: homeId,
      awayFranchiseId: awayId,
      result,
      injuryEvents: [],
    });
    return {
      kind: 'simulated',
      facts: {
        gameId,
        status: 'forfeit',
        winnerFranchiseId,
        loserFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
        homeScore: null,
        awayScore: null,
      },
      summary,
      nextHealth: run.health,
      nextEffects: effects,
    };
  }
  const positions = new Map<string, readonly Position[]>();
  const targetMinutes = new Map<string, number>();
  for (const player of [...allHomePlayers, ...allAwayPlayers]) {
    positions.set(player.playerVersionId, player.positions);
  }
  for (const rotation of [homeRotation, awayRotation]) {
    for (const entry of rotation.targetMinutes) {
      targetMinutes.set(entry.playerVersionId, entry.minutes);
    }
  }
  const durability = new Map<string, number>();
  for (const candidate of catalog.candidates) {
    durability.set(candidate.playerVersionId, candidate.durability.rating);
  }
  const homeLegalFacts = seasonFranchiseLegalFiveFacts(run, homeId, run.health, positions);
  const awayLegalFacts = seasonFranchiseLegalFiveFacts(run, awayId, run.health, positions);
  if (
    humanFranchiseId !== null &&
    ((homeId === humanFranchiseId && !homeLegalFacts.legal) ||
      (awayId === humanFranchiseId && !awayLegalFacts.legal))
  ) {
    return {
      kind: 'integrity-failure',
      reason: `the human franchise ${humanFranchiseId} cannot field a legal five for ${gameId}; the caller must return the rotation decision instead`,
    };
  }
  if (!homeLegalFacts.legal && !awayLegalFacts.legal) {
    return {
      kind: 'integrity-failure',
      reason: `game ${gameId} has no legal five on either side; refusing to fabricate a winner`,
    };
  }
  const forfeitPending = !homeLegalFacts.legal || !awayLegalFacts.legal;
  const ordinal = seasonPostseasonGameOrdinal(gameId);
  const round = SEASON_ROUND_COUNT;
  const pregame = effects;
  const seam = forfeitPending
    ? {
        pregame: seasonPregameAvailabilityOf(run.health, [...homePlayers, ...awayPlayers]),
        removals: [] as {
          playerVersionId: string;
          clock: {
            period: number;
            seconds: number;
          };
          reason: 'injury';
        }[],
        returns: [] as {
          playerVersionId: string;
          clock: {
            period: number;
            seconds: number;
          };
          reason: 'injury-return';
        }[],
        newInjuries: [] as SeasonInjuryRecord[],
      }
    : postseasonGameHealthSeam({
        run,
        health: run.health,
        gameId,
        round,
        homeFranchiseId: homeId,
        awayFranchiseId: awayId,
        targetMinutesByPlayer: targetMinutes,
        durabilityByPlayer: durability,
        effects: pregame,
      });
  const gameInput: SeasonGameSimulationInput = {
    schemaVersion: 1,
    seed,
    gameNumber: ordinal,
    dataVersion: catalog.dataVersion,
    profile,
    home: {
      teamId: homeId,
      displayName: homeId,
      franchiseId: franchiseIdSchema.parse(homeId),
      players: homePlayers,
    },
    away: {
      teamId: awayId,
      displayName: awayId,
      franchiseId: franchiseIdSchema.parse(awayId),
      players: awayPlayers,
    },
    homeRotation,
    awayRotation,
    availability: [...homePlayers, ...awayPlayers].map((player) => ({
      playerVersionId: player.playerVersionId,
      available: seam.pregame.get(player.playerVersionId) ?? true,
    })),
    removals: seam.removals.map((removal) => ({
      side: sideOfPlayer(homeRoster, awayRoster, removal.playerVersionId),
      playerVersionId: removal.playerVersionId,
      period: removal.clock.period,
      secondsRemaining: removal.clock.seconds,
      reason: 'injury' as const,
    })),
    returns: seam.returns.map((ret) => ({
      side: sideOfPlayer(homeRoster, awayRoster, ret.playerVersionId),
      playerVersionId: ret.playerVersionId,
      period: ret.clock.period,
      secondsRemaining: ret.clock.seconds,
      reason: 'injury-return' as const,
    })),
    homeCourt: SEASON_HOME_COURT_PROFILE,
    gameRule: resolveHomeGameRule(
      (run as unknown as { evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState })
        .evolution ?? null,
      homeId,
    ),
  };
  const resolver = options.resolver ?? defaultSeasonPostseasonGameResolver;
  const { result, transition } = resolver({ gameId, gameInput, pregameEffects: pregame });
  if (result.seed !== seed) {
    throw new SeasonPostseasonInvariantError(
      `game ${gameId} result seed ${result.seed} does not match the derived seed ${seed}`,
    );
  }
  if (result.outcome === 'no-legal-five-both') {
    return {
      kind: 'integrity-failure',
      reason: `game ${gameId} has no legal five on either side (seed ${seed}); refusing to fabricate a winner`,
    };
  }
  const nextEffects = applySeasonGameEffectsTransition(pregame, transition);
  const sameGameReturned = sameGameReturnResolutionsOf(seam.newInjuries, result);
  const nextHealth = applySeasonGameHealthTransition(run.health, {
    gameId,
    round,
    franchises: [homeId, awayId],
    newInjuries: seam.newInjuries,
    sameGameReturned,
  });
  const injuryEvents = compactPostseasonInjuryEvents({
    homeRoster,
    awayRoster,
    seam,
    result,
  });
  const factsOf = roundFactsOf(run.postseason, run.league, gameId);
  const summary = seasonPostseasonSummaryFromGame({
    runId: run.runId,
    gameId,
    phase,
    round: factsOf.round,
    seriesId: factsOf.seriesId,
    gameNumber: factsOf.gameNumber,
    conference: factsOf.conference,
    homeFranchiseId: homeId,
    awayFranchiseId: awayId,
    result,
    injuryEvents,
  });
  let parsedSummary: SeasonPostseasonSummary;
  try {
    parsedSummary = seasonPostseasonSummarySchema.parse(summary);
  } catch (error) {
    throw new SeasonPostseasonInvariantError(
      `game ${gameId} summary fails the schema: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  const winner =
    result.outcome === 'forfeit'
      ? result.losingFranchiseId === homeId
        ? awayId
        : homeId
      : result.winner === 'home'
        ? homeId
        : awayId;
  const loser =
    result.outcome === 'forfeit' ? result.losingFranchiseId : winner === homeId ? awayId : homeId;
  return {
    kind: 'simulated',
    facts: {
      gameId,
      status: result.outcome === 'forfeit' ? 'forfeit' : 'final',
      winnerFranchiseId: winner,
      loserFranchiseId: loser,
      homeScore: result.outcome === 'forfeit' ? null : result.home.score,
      awayScore: result.outcome === 'forfeit' ? null : result.away.score,
    },
    summary: parsedSummary,
    nextHealth,
    nextEffects,
  };
}
function expandedPlayer(
  input: SeasonPostseasonGameSimulationInput,
  playerVersionId: string,
): SeasonGamePlayerInput {
  const player = input.expanded.get(playerVersionId);
  if (player === undefined) {
    throw new SeasonPostseasonInvariantError(
      `game ${input.gameId} references an unexpanded version ${playerVersionId}`,
    );
  }
  return player;
}
function sideOfPlayer(
  homeRoster: SeasonRun['rosters'][number],
  awayRoster: SeasonRun['rosters'][number],
  playerVersionId: string,
): 'home' | 'away' {
  if (homeRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'home';
  }
  if (awayRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'away';
  }
  throw new SeasonPostseasonInvariantError(
    `version ${playerVersionId} plays neither side of the game`,
  );
}
function sameGameReturnResolutionsOf(
  newInjuries: readonly SeasonInjuryRecord[],
  result: SeasonGameSimulationResult,
): {
  injuryId: string;
  returned: boolean;
}[] {
  const candidates = newInjuries.filter((record) => record.sameGameReturn);
  if (candidates.length === 0) return [];
  const returnedIds = new Set<string>();
  if (result.outcome === 'completed') {
    for (const side of [result.home, result.away]) {
      for (const ret of side.returns) returnedIds.add(ret.playerVersionId);
    }
  }
  return candidates.map((record) => ({
    injuryId: record.injuryId,
    returned: returnedIds.has(record.playerVersionId),
  }));
}
function compactPostseasonInjuryEvents(input: {
  homeRoster: SeasonRun['rosters'][number];
  awayRoster: SeasonRun['rosters'][number];
  seam: ReturnType<typeof postseasonGameHealthSeam>;
  result: SeasonGameSimulationResult;
}): SeasonCompactInjuryEvent[] {
  if (input.seam.newInjuries.length === 0) return [];
  const appliedRemovalByPlayer = new Map<
    string,
    {
      period: number;
      seconds: number;
    }
  >();
  const appliedReturnByPlayer = new Map<
    string,
    {
      period: number;
      seconds: number;
    }
  >();
  if (input.result.outcome === 'completed') {
    for (const event of input.result.removals) {
      appliedRemovalByPlayer.set(event.playerVersionId, {
        period: event.period,
        seconds: event.secondsRemaining,
      });
    }
    for (const side of [input.result.home, input.result.away]) {
      for (const event of side.returns) {
        appliedReturnByPlayer.set(event.playerVersionId, {
          period: event.period,
          seconds: event.secondsRemaining,
        });
      }
    }
  }
  const rolledRemovalByPlayer = new Map(
    input.seam.removals.map((removal) => [removal.playerVersionId, removal.clock]),
  );
  return input.seam.newInjuries.map((record) => {
    const appliedRemoval = appliedRemovalByPlayer.get(record.playerVersionId);
    const rolledRemoval = rolledRemovalByPlayer.get(record.playerVersionId);
    const removedClock = appliedRemoval ?? rolledRemoval ?? { period: 1, seconds: 720 };
    const appliedReturn = appliedReturnByPlayer.get(record.playerVersionId);
    return {
      playerVersionId: record.playerVersionId,
      side: sideOfPlayer(input.homeRoster, input.awayRoster, record.playerVersionId),
      type: record.type,
      severity: record.severity,
      removedClock,
      returned: appliedReturn !== undefined,
      returnClock: appliedReturn ?? null,
    };
  });
}
function roundFactsOf(
  state: SeasonPostseasonState,
  league: SeasonLeague,
  gameId: string,
): {
  phase: 'play-in' | 'playoffs';
  round: SeasonPostseasonSummary['round'];
  seriesId: string | null;
  gameNumber: number;
  conference: ConferenceId;
} {
  if (postseasonPhaseOfGameId(gameId) === 'play-in') {
    const parsed = parsePlayInGameId(gameId);
    if (parsed === null) {
      throw new SeasonPostseasonInvariantError(`malformed play-in game id ${gameId}`);
    }
    return {
      phase: 'play-in',
      round: parsed.matchup,
      seriesId: null,
      gameNumber: 1,
      conference: parsed.conference,
    };
  }
  const parsed = parsePlayoffGameId(gameId);
  if (parsed === null) {
    throw new SeasonPostseasonInvariantError(`malformed playoff game id ${gameId}`);
  }
  const series = findSeriesOrNull(state.bracket, parsed.seriesId);
  if (series === null) {
    throw new SeasonPostseasonInvariantError(`unknown series ${parsed.seriesId}`);
  }
  const teams = seasonPostseasonGameTeamsOf(state, gameId);
  const conference =
    series.round === 'finals'
      ? conferenceOf(league, teams?.home ?? series.homeCourtFranchiseId ?? '')
      : (series.conference ?? 'east');
  return {
    phase: 'playoffs',
    round: series.round,
    seriesId: series.seriesId,
    gameNumber: parsed.gameNumber,
    conference,
  };
}
export function seasonPostseasonSummaryFromGame(input: {
  runId: string;
  gameId: string;
  phase: 'play-in' | 'playoffs';
  round: SeasonPostseasonSummary['round'];
  seriesId: string | null;
  gameNumber: number;
  conference: ConferenceId;
  homeFranchiseId: string;
  awayFranchiseId: string;
  result: SeasonGameSimulationResult;
  injuryEvents: readonly SeasonCompactInjuryEvent[];
}): SeasonPostseasonSummary {
  const homeId = franchiseIdSchema.parse(input.homeFranchiseId);
  const awayId = franchiseIdSchema.parse(input.awayFranchiseId);
  const seasonSummary = seasonGameSummaryFromResult(
    input.result,
    {
      gameId: seasonGameIdSchema.parse('s000001'),
      round: 1,
      homeFranchiseId: homeId,
      awayFranchiseId: awayId,
    },
    undefined,
    input.injuryEvents,
  );
  const homeWon = seasonSummary.homeScore > seasonSummary.awayScore;
  const winnerRaw =
    seasonSummary.status === 'forfeit'
      ? seasonSummary.forfeitLoserFranchiseId === homeId
        ? input.awayFranchiseId
        : input.homeFranchiseId
      : homeWon
        ? input.homeFranchiseId
        : input.awayFranchiseId;
  const loserRaw =
    seasonSummary.status === 'forfeit'
      ? (seasonSummary.forfeitLoserFranchiseId ?? winnerRaw)
      : homeWon
        ? input.awayFranchiseId
        : input.homeFranchiseId;
  const winnerFranchiseId = franchiseIdSchema.parse(winnerRaw);
  const loserFranchiseId = franchiseIdSchema.parse(loserRaw);
  const homeSubstitutions =
    input.result.outcome === 'completed'
      ? input.result.substitutions.filter((sub) => sub.side === 'home').length
      : 0;
  const awaySubstitutions =
    input.result.outcome === 'completed'
      ? input.result.substitutions.filter((sub) => sub.side === 'away').length
      : 0;
  const summary: SeasonPostseasonSummary = {
    schemaVersion: 1,
    summaryVersion: SEASON_POSTSEASON_SUMMARY_VERSION,
    runId: input.runId,
    gameId: input.gameId,
    phase: input.phase,
    round: input.round,
    seriesId: input.seriesId,
    gameNumber: input.gameNumber,
    conference: input.conference,
    homeFranchiseId: homeId,
    awayFranchiseId: awayId,
    winnerFranchiseId,
    loserFranchiseId,
    status: seasonSummary.status,
    homeScore: seasonSummary.homeScore,
    awayScore: seasonSummary.awayScore,
    forfeitLoserFranchiseId: seasonSummary.forfeitLoserFranchiseId,
    homeBox: seasonSummary.homeBox,
    awayBox: seasonSummary.awayBox,
    homePlayers: seasonSummary.homePlayers,
    awayPlayers: seasonSummary.awayPlayers,
    rotationEvidence: {
      home: {
        playersUsed: seasonSummary.homePlayers.filter((line) => line.seconds > 0).length,
        substitutions: homeSubstitutions,
      },
      away: {
        playersUsed: seasonSummary.awayPlayers.filter((line) => line.seconds > 0).length,
        substitutions: awaySubstitutions,
      },
    },
    injuryEvents: [...seasonSummary.injuryEvents],
    resultDigest: '',
    ...(seasonSummary.gameRule !== undefined ? { gameRule: seasonSummary.gameRule } : {}),
    ...(seasonSummary.ruleVersion !== undefined ? { ruleVersion: seasonSummary.ruleVersion } : {}),
    ...(seasonSummary.overtimeRace !== undefined
      ? {
          overtimeRace: {
            target: 7 as const,
            homePoints: seasonSummary.overtimeRace.homePoints,
            awayPoints: seasonSummary.overtimeRace.awayPoints,
          },
        }
      : {}),
  };
  return { ...summary, resultDigest: seasonPostseasonSummaryDigest(summary) };
}
