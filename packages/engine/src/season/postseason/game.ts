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
import {
  activeSeasonPlayers,
  buildSeasonGameSimulationInput,
  durabilityByCatalog,
  positionsOfPlayers,
  targetMinutesOfRotations,
} from '../game-launch.ts';
import { seasonGameSummaryFromResult } from '../game-summary.ts';
import { seasonFranchiseLegalFiveFacts, seasonPregameAvailabilityOf } from '../health.ts';
import { applySeasonGameHealthTransition } from '../injuries.ts';
import { compactSeasonInjuryEvents, sameGameReturnResolutionsOf } from '../injury-events.ts';
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
  const expandedPlayerOf = (playerVersionId: string): SeasonGamePlayerInput =>
    expandedPlayer(input, playerVersionId);
  const allHomePlayers = homeRoster.players.map((player) =>
    expandedPlayerOf(player.playerVersionId),
  );
  const allAwayPlayers = awayRoster.players.map((player) =>
    expandedPlayerOf(player.playerVersionId),
  );
  const homePlayers = activeSeasonPlayers({
    roster: homeRoster,
    rotation: homeRotation,
    expandedPlayer: expandedPlayerOf,
  });
  const awayPlayers = activeSeasonPlayers({
    roster: awayRoster,
    rotation: awayRotation,
    expandedPlayer: expandedPlayerOf,
  });
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
  const positions = positionsOfPlayers([...allHomePlayers, ...allAwayPlayers]);
  const targetMinutes = targetMinutesOfRotations([homeRotation, awayRotation]);
  const durability = durabilityByCatalog(catalog);
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
  const missingSide = (playerVersionId: string): Error =>
    new SeasonPostseasonInvariantError(`version ${playerVersionId} plays neither side of the game`);
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
        homeFranchiseId: homeId,
        awayFranchiseId: awayId,
        targetMinutesByPlayer: targetMinutes,
        durabilityByPlayer: durability,
        effects: pregame,
      });
  const gameInput: SeasonGameSimulationInput = buildSeasonGameSimulationInput({
    seed,
    gameNumber: ordinal,
    dataVersion: catalog.dataVersion,
    profile,
    homeFranchiseId: homeId,
    awayFranchiseId: awayId,
    homePlayers,
    awayPlayers,
    homeRotation,
    awayRotation,
    seam,
    homeRoster,
    awayRoster,
    evolution:
      (run as unknown as { evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState })
        .evolution ?? null,
    missingSide,
  });
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
  const injuryEvents = compactSeasonInjuryEvents({
    homeRoster,
    awayRoster,
    seam,
    result,
    missing: missingSide,
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
