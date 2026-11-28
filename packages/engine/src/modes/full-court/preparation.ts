import {
  FULL_COURT_PRACTICE_REPORT_SCHEMA_VERSION,
  havocInstanceSeed,
  type FullCourtCoachingRule,
  type FullCourtDefensiveMatchups,
  type FullCourtOffensiveHierarchy,
  type FullCourtPracticeReport,
  type FullCourtTactics,
  type Seed,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { simulateFullCourtGame, type FullCourtGameInput } from './game.ts';
import { fixtureFullCourtDefensiveMatchups } from './matchups.ts';
import type { FullCourtRegularSeason } from './regular-season.ts';
import { FULL_COURT_TIRED_ENERGY, type FullCourtRotationPlanInput } from './rotation.ts';

export const FULL_COURT_TRAINING_CAMP_SEED_PURPOSE = 'full-court-training-camp-v1';

/**
 * Training Camp gets its own named seed stream. It can never collide with a
 * scheduled game because the purpose differs from the regular and playoff
 * fixture seeds derived from the same run.
 */
export function fullCourtTrainingCampSeed(runSeed: Seed, reportId: string): Seed {
  return havocInstanceSeed(runSeed, FULL_COURT_TRAINING_CAMP_SEED_PURPOSE, reportId);
}

export interface FullCourtTrainingCampOptions {
  readonly rotation?: FullCourtRotationPlanInput;
  readonly tactics?: FullCourtTactics;
  readonly rules?: readonly FullCourtCoachingRule[];
  readonly hierarchy?: FullCourtOffensiveHierarchy;
  readonly defensiveMatchups?: FullCourtDefensiveMatchups;
}

export interface FullCourtTrainingCampInput extends FullCourtTrainingCampOptions {
  readonly seed: Seed;
  readonly opponentTeamId: string;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function threeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function practiceGameInput(
  season: FullCourtRegularSeason,
  input: FullCourtTrainingCampInput,
): FullCourtGameInput {
  const userTeam = season.teams.find((team) => team.teamId === season.userTeamId);
  const opponent = season.teams.find((team) => team.teamId === input.opponentTeamId);
  if (userTeam === undefined) throw new Error('The Full Court user roster is unavailable');
  if (opponent === undefined || opponent.teamId === userTeam.teamId) {
    throw new Error('Training camp needs a distinct practice opponent');
  }
  const defensiveMatchups =
    input.defensiveMatchups !== undefined &&
    input.defensiveMatchups.opponentTeamId === opponent.teamId &&
    input.defensiveMatchups.assignments.length > 0
      ? fixtureFullCourtDefensiveMatchups(
          { ...input.defensiveMatchups, gameId: undefined },
          'practice',
          opponent.teamId,
        )
      : undefined;
  return {
    schemaVersion: 1,
    seed: input.seed,
    gameNumber: 0,
    dataVersion: season.catalog.dataVersion,
    profile: season.profile,
    home: {
      ...userTeam,
      rotation: {
        ...(userTeam.rotation ?? {}),
        ...(input.rotation ?? {}),
        ...(input.rules === undefined ? {} : { rules: input.rules }),
      },
      ...(input.tactics === undefined ? {} : { tactics: input.tactics }),
      ...(input.hierarchy === undefined ? {} : { hierarchy: input.hierarchy }),
      ...(defensiveMatchups === undefined ? {} : { defensiveMatchups }),
    },
    away: opponent,
  };
}

/**
 * Runs one unscored practice game with the supplied plan and returns only the
 * observations the War Room shows. It does not use the health system, commit a
 * checkpoint, write a score, or emit a tape, so it cannot touch the season,
 * playoffs, achievements, or a saved Gamecast.
 */
export function simulateFullCourtTrainingCamp(
  season: FullCourtRegularSeason,
  input: FullCourtTrainingCampInput,
  context: EngineContext,
): FullCourtPracticeReport {
  const result = simulateFullCourtGame(practiceGameInput(season, input), context);
  const user = result.home;
  const benchPlayers = user.players.filter((player) => !player.startedGame);
  const usedBench = benchPlayers.filter((player) => player.seconds > 0);
  const played = user.players.filter((player) => player.seconds > 0);
  return {
    schemaVersion: FULL_COURT_PRACTICE_REPORT_SCHEMA_VERSION,
    seed: input.seed,
    userTeamId: user.teamId,
    userTeamName: user.displayName,
    opponentTeamId: result.away.teamId,
    opponentTeamName: result.away.displayName,
    totalSeconds: result.totalSeconds,
    overtimePeriods: result.overtimePeriods,
    score: { user: user.box.points, opponent: result.away.box.points },
    rotation: user.players.map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      kind: 'roster',
      starter: player.startedGame,
      minutes: oneDecimal(player.minutes),
      plannedMinutes: oneDecimal(player.plannedSeconds / 60),
      points: player.points,
      stints: player.stints,
      energyRemaining: threeDecimals(player.energyRemaining),
      fatigueLevel: player.fatigueLevel,
    })),
    bench: {
      playersUsed: usedBench.length,
      minutes: oneDecimal(usedBench.reduce((total, player) => total + player.seconds, 0) / 60),
      points: usedBench.reduce((total, player) => total + player.points, 0),
    },
    fatigue: {
      tiredPlayers: played.filter((player) => player.energyRemaining <= FULL_COURT_TIRED_ENERGY)
        .length,
      lowestEnergy: threeDecimals(
        played.length === 0 ? 1 : Math.min(...played.map((player) => player.energyRemaining)),
      ),
    },
  };
}
