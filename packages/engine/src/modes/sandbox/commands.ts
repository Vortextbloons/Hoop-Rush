import type {
  EraSimulationProfile,
  GameResult,
  GameSimulationInput,
  Lineup,
  OpponentTeam,
  PeakPlayerSeason,
  Seed,
} from '@hoop-rush/data-contracts';
import { validateLineup, type LineupValidation } from '../../domain/lineup.js';
import type { EngineContext } from '../../sim/context.js';
import { simulateGame } from '../../sim/game.js';
import { toSimulationPlayer } from './adapters.js';

/**
 * Typed Sandbox application commands (spec/10 modes/sandbox): validate the
 * drafted lineup, create the opening-game input, and simulate it. Seeds are
 * produced by the outer adapter; deterministic domain code never reads clocks
 * or platform randomness.
 */

export interface DraftedLineup {
  lineup: Lineup;
  /** Resolved pool players, one per assignment, in slot order. */
  players: PeakPlayerSeason[];
}

/** Validates the drafted five against the fixed G,G,F,F,C structure. */
export function validateDraftedLineup(drafted: DraftedLineup): LineupValidation {
  return validateLineup(drafted.lineup);
}

export interface OpeningGameArgs {
  seed: Seed;
  dataVersion: string;
  profile: EraSimulationProfile;
  drafted: DraftedLineup;
  opponent: OpponentTeam;
}

/** Creates the serialized opening-game input (home = user lineup, away = opponent). */
export function createOpeningGameInput(args: OpeningGameArgs): GameSimulationInput {
  const validation = validateDraftedLineup(args.drafted);
  if (!validation.ok) {
    const detail = validation.issues.map((issue) => issue.message).join('; ');
    throw new Error(`drafted lineup is not legal: ${detail}`);
  }
  const byId = new Map(args.drafted.players.map((p) => [p.playerId, p]));
  const homePlayers = args.drafted.lineup.assignments.map((assignment) => {
    const player = byId.get(assignment.playerId);
    if (!player) throw new Error(`drafted player ${assignment.playerId} not found in pool`);
    return toSimulationPlayer(player);
  });
  return {
    schemaVersion: 2,
    seed: args.seed,
    gameNumber: 1,
    dataVersion: args.dataVersion,
    profile: args.profile,
    home: {
      teamId: 'user',
      displayName: args.drafted.lineup.assignments.map((a) => a.playerId).join(' '),
      players: homePlayers,
    },
    away: {
      teamId: args.opponent.teamId,
      displayName: args.opponent.displayName,
      players: args.opponent.players,
    },
  };
}

/** Simulates the opening game with the injected engine context. */
export function simulateOpeningGame(
  input: GameSimulationInput,
  context: EngineContext,
): GameResult {
  return simulateGame(input, context);
}
