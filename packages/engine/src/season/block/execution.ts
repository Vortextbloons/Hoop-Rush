import {
  SEASON_SEED_NAMESPACES,
  blockRoundRange,
  franchiseIdSchema,
  seasonNamespaceSeed,
  type Position,
  type SeasonEffectsState,
  type SeasonGamePlayerInput,
  type SeasonGameSimulationInput,
  type SeasonHealthState,
  type SeasonInvalidRosterInterruption,
  type SeasonRetainedGameDetail,
  type SeasonRotation,
  type SeasonSchedule,
  type SeasonScheduleGame,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { applySeasonGameEffectsTransition } from '../effects.ts';
import {
  activeSeasonPlayers,
  buildSeasonGameSimulationInput,
  durabilityByCatalog,
  positionsOfPlayers,
} from '../game-launch.ts';
import {
  auditSeasonGameSummary,
  seasonGameSummaryFromResult,
  seasonRetainedDetailFromResult,
} from '../game-summary.ts';
import {
  seasonFranchiseLegalFiveFacts,
  seasonGameHealthSeam,
  seasonPregameAvailabilityOf,
} from '../health.ts';
import { applySeasonGameHealthTransition } from '../injuries.ts';
import { compactSeasonInjuryEvents, sameGameReturnResolutionsOf } from '../injury-events.ts';
import { seasonBlockGameCount } from '../recap.ts';
import { simulateSeasonGameWithEffects } from '../season-game.ts';
import { applySeasonRecoveryTick } from '../stamina.ts';
import { SeasonBlockInvariantError } from './errors.ts';
import type {
  SeasonBlockGameOutcome,
  SeasonBlockGameSimulationOptions,
  SeasonBlockSimulationInput,
  SimulateSeasonBlockGameArgs,
} from './types.ts';

export function seasonBlockGamesOf(
  schedule: SeasonSchedule,
  blockIndex: number,
): SeasonScheduleGame[] {
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  const blockGames = schedule.games
    .filter((game) => game.round >= fromRound && game.round <= toRound)
    .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const expectedGameCount = seasonBlockGameCount(blockIndex);
  if (blockGames.length !== expectedGameCount) {
    throw new SeasonBlockInvariantError(
      `block ${String(blockIndex)} holds ${String(blockGames.length)} games, expected ${String(expectedGameCount)}`,
      { blockIndex },
    );
  }
  return blockGames;
}
function isSimulateSeasonBlockGameArgs(
  value: SimulateSeasonBlockGameArgs | SeasonBlockSimulationInput,
): value is SimulateSeasonBlockGameArgs {
  return 'game' in value && 'effects' in value && 'health' in value;
}
export function simulateSeasonBlockGame(args: SimulateSeasonBlockGameArgs): SeasonBlockGameOutcome;
export function simulateSeasonBlockGame(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  effects: SeasonEffectsState,
  health: SeasonHealthState,
  options?: SeasonBlockGameSimulationOptions,
): SeasonBlockGameOutcome;
export function simulateSeasonBlockGame(
  argsOrInput: SimulateSeasonBlockGameArgs | SeasonBlockSimulationInput,
  positionalGame?: SeasonScheduleGame,
  positionalEffects?: SeasonEffectsState,
  positionalHealth?: SeasonHealthState,
  positionalOptions: SeasonBlockGameSimulationOptions = {},
): SeasonBlockGameOutcome {
  let input: SeasonBlockSimulationInput;
  let game: SeasonScheduleGame;
  let effects: SeasonEffectsState;
  let health: SeasonHealthState;
  let options: SeasonBlockGameSimulationOptions;
  if (
    positionalGame !== undefined &&
    positionalEffects !== undefined &&
    positionalHealth !== undefined
  ) {
    if (isSimulateSeasonBlockGameArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'simulateSeasonBlockGame: ambiguous call shape (object and positional args)',
      );
    }
    input = argsOrInput;
    game = positionalGame;
    effects = positionalEffects;
    health = positionalHealth;
    options = positionalOptions;
  } else {
    if (!isSimulateSeasonBlockGameArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError('simulateSeasonBlockGame: missing game/effects/health');
    }
    input = argsOrInput.input;
    game = argsOrInput.game;
    effects = argsOrInput.effects;
    health = argsOrInput.health;
    options = argsOrInput.options ?? {};
  }
  const command = input.command;
  const run = input.run;
  const gameNumberById =
    options.gameNumberById ??
    new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1]));
  const rotationByFranchise =
    options.rotationByFranchise ??
    new Map(run.rotations.map((rotation) => [rotation.franchiseId, rotation]));
  const rosterByFranchise =
    options.rosterByFranchise ?? new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const homeRoster = rosterByFranchise.get(game.homeFranchiseId);
  const awayRoster = rosterByFranchise.get(game.awayFranchiseId);
  const homeRotation = rotationByFranchise.get(game.homeFranchiseId);
  const awayRotation = rotationByFranchise.get(game.awayFranchiseId);
  if (
    homeRoster === undefined ||
    awayRoster === undefined ||
    homeRotation === undefined ||
    awayRotation === undefined
  ) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} references a roster or rotation outside the run`,
      { gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  const expandedPlayerOf = (playerVersionId: string): SeasonGamePlayerInput =>
    expandedPlayer(input, game.gameId, playerVersionId);
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
  const missingSide = (playerVersionId: string): Error =>
    new SeasonBlockInvariantError(
      `season block: version ${playerVersionId} plays neither side of ${game.gameId}`,
    );
  const seed = seasonNamespaceSeed(run.rootSeed, SEASON_SEED_NAMESPACES.scheduleGames, game.gameId);
  let pregame = effects;
  if (!(options.skipRecoveryTick ?? false)) {
    pregame = applySeasonRecoveryTick(
      pregame,
      options.staminaByVersion ?? staminaByVersionOf(input),
    );
  }
  const positions = options.positions ?? positionsOf(input);
  const participantFranchiseIds =
    input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : []);
  const humanPlays = participantFranchiseIds.some(
    (id) => game.homeFranchiseId === id || game.awayFranchiseId === id,
  );
  let homeLegalFacts: {
    legal: boolean;
    unavailablePlayerVersionIds: string[];
  } | null = null;
  let awayLegalFacts: {
    legal: boolean;
    unavailablePlayerVersionIds: string[];
  } | null = null;
  if (humanPlays) {
    for (const pid of participantFranchiseIds) {
      if (game.homeFranchiseId !== pid && game.awayFranchiseId !== pid) continue;
      const facts = seasonFranchiseLegalFiveFacts(run, pid, health, positions);
      if (pid === game.homeFranchiseId) homeLegalFacts = facts;
      if (pid === game.awayFranchiseId) awayLegalFacts = facts;
      if (!facts.legal) {
        const interruption: SeasonInvalidRosterInterruption = {
          code: 'invalid-roster',
          runId: run.runId,
          blockIndex: command.blockIndex,
          commandId: command.commandId,
          nextGameId: game.gameId,
          humanFranchiseId: franchiseIdSchema.parse(pid),
          unavailablePlayerVersionIds: facts.unavailablePlayerVersionIds,
        };
        return { interruption };
      }
    }
  }
  homeLegalFacts ??= seasonFranchiseLegalFiveFacts(run, game.homeFranchiseId, health, positions);
  awayLegalFacts ??= seasonFranchiseLegalFiveFacts(run, game.awayFranchiseId, health, positions);
  const forfeitPending = !homeLegalFacts.legal || !awayLegalFacts.legal;
  const targetMinutesByPlayer = targetMinutesOf(input, game, rotationByFranchise);
  const seam = forfeitPending
    ? {
        pregame: seasonPregameAvailabilityOf(health, [...homePlayers, ...awayPlayers]),
        removals: [],
        returns: [],
        newInjuries: [],
      }
    : seasonGameHealthSeam(run, health, {
        rootSeed: run.rootSeed,
        gameId: game.gameId,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        targetMinutesByPlayer,
        durabilityByPlayer: options.durabilityByVersion ?? durabilityByVersionOf(input),
        effects: pregame,
      });
  if (humanPlays) {
    const fresh: { gameId: string; availableCount: number }[] = [];
    for (const pid of [...participantFranchiseIds].sort()) {
      if (game.homeFranchiseId !== pid && game.awayFranchiseId !== pid) continue;
      const roster = rosterByFranchise.get(pid);
      const availableCount =
        roster === undefined
          ? 0
          : roster.players.filter((player) => seam.pregame.get(player.playerVersionId) === true)
              .length;
      fresh.push({ gameId: game.gameId, availableCount });
    }
    const retained = (input.collectedTipAvailability ?? []).filter(
      (entry) => entry.gameId !== game.gameId,
    );
    input.collectedTipAvailability = [...retained, ...fresh];
  }
  const gameInput: SeasonGameSimulationInput = buildSeasonGameSimulationInput({
    seed,
    gameNumber: gameNumberById.get(game.gameId) ?? 1,
    dataVersion: input.catalog.dataVersion,
    profile: input.profile,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
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
  const { result, transition } = simulateSeasonGameWithEffects(
    gameInput,
    createEngineContext(),
    pregame,
  );
  if (result.seed !== seed) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} result seed ${result.seed} does not match the derived seed ${seed}`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  if (result.outcome === 'no-legal-five-both') {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} has no legal five on either side (seed ${seed}); refusing to fabricate a winner`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  const nextEffects = applySeasonGameEffectsTransition(pregame, transition);
  const sameGameReturned = sameGameReturnResolutionsOf(seam.newInjuries, result);
  const nextHealth = applySeasonGameHealthTransition(health, {
    gameId: game.gameId,
    round: game.round,
    franchises: [game.homeFranchiseId, game.awayFranchiseId],
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
  const summary = seasonGameSummaryFromResult(result, game, transition, injuryEvents);
  const summaryFailures = auditSeasonGameSummary(summary);
  if (summaryFailures.length > 0) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} summary audit failed: ${summaryFailures.join('; ')}`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  let retainedDetail: SeasonRetainedGameDetail | null = null;
  if (
    participantFranchiseIds.some((id) => game.homeFranchiseId === id || game.awayFranchiseId === id)
  ) {
    retainedDetail = seasonRetainedDetailFromResult(
      result,
      game,
      run.runId,
      transition,
      injuryEvents,
    );
  }
  return { summary, retainedDetail, effects: nextEffects, health: nextHealth };
}

function expandedPlayer(
  input: SeasonBlockSimulationInput,
  gameId: string,
  playerVersionId: string,
): SeasonGamePlayerInput {
  const player = input.expanded.get(playerVersionId);
  if (player === undefined) {
    throw new SeasonBlockInvariantError(
      `game ${gameId} references an unexpanded version ${playerVersionId}`,
      { gameId },
    );
  }
  return player;
}

export function staminaByVersionOf(input: SeasonBlockSimulationInput): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const player of input.expanded.values()) {
    if (player.stamina === undefined) {
      throw new SeasonBlockInvariantError(
        `expanded player ${player.playerVersionId} has no stamina profile`,
      );
    }
    ratings.set(player.playerVersionId, player.stamina.rating);
  }
  return ratings;
}
function targetMinutesOf(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  rotationByFranchise: ReadonlyMap<string, SeasonRotation>,
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const franchiseId of [game.homeFranchiseId, game.awayFranchiseId]) {
    const rotation = rotationByFranchise.get(franchiseId);
    if (rotation === undefined) {
      throw new SeasonBlockInvariantError(
        `game ${game.gameId} references rotation ${franchiseId}`,
        { gameId: game.gameId, blockIndex: input.command.blockIndex },
      );
    }
    for (const entry of rotation.targetMinutes) {
      targets.set(entry.playerVersionId, entry.minutes);
    }
  }
  return targets;
}
export function durabilityByVersionOf(input: SeasonBlockSimulationInput): Map<string, number> {
  return durabilityByCatalog(input.catalog);
}
export function positionsOf(input: SeasonBlockSimulationInput): Map<string, readonly Position[]> {
  return positionsOfPlayers(input.expanded.values());
}
