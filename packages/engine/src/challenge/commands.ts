import type {
  ChallengeRun,
  ClassicCompletedDraft,
  ClassicVariant,
  DifficultyProfile,
  EraSimulationProfile,
  GameResult,
  GameSimulationInput,
  Lineup,
  OpponentBracket,
  RunAggregates,
  Seed,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  RUN_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSION,
  classicCompletedDraftSchema,
  seedSchema,
  type RunPlayerSelection,
} from '@hoop-rush/data-contracts';
import { validateLineup } from '../domain/lineup.js';
import type { EngineContext } from '../sim/context.js';
import { simulateGame } from '../sim/game.js';
import { checkGameResult } from '../sim/invariants.js';
import { addGameToAggregates, zeroRunAggregates } from './aggregates.js';
import { SEED_DERIVATION_VERSION, deriveGameSeed } from './seeds.js';

/**
 * Challenge commands (spec/10 authoritative commands): the single path from a
 * validated lineup and frozen bracket to an accepted run. `createChallenge`
 * freezes every version and snapshots the bracket; `createNextGameInput`
 * derives the next seed and opponent; `acceptGameResult` verifies game
 * number, opponent, derived seed, and all frozen versions before returning a
 * new accepted state. Runs are immutable: every command returns a new state.
 */

export interface ChallengeCreationBase {
  runId: string;
  franchiseId: string | null;
  eraId: string;
  homeDisplayName: string;
  /** Legal G,G,F,F,C assignment validated by this command. */
  lineup: Lineup;
  /** Five distinct pool players matching the lineup assignments, in slot order. */
  players: SimulationPlayer[];
  /** Per-player pool provenance in slot order (always exactly five). */
  selections: RunPlayerSelection[];
  runSeed: Seed;
  dataVersion: string;
  ratingVersion: string;
  positionNormalizationVersion: string;
  engineVersion: string;
  /** Era simulation profile whose version is frozen into the run. */
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}

export interface SandboxChallengeCreation extends ChallengeCreationBase {
  mode: 'sandbox';
  /** Sandbox runs reject Classic fields. */
  variant?: undefined;
  classicDraft?: undefined;
}

export interface ClassicChallengeCreation extends ChallengeCreationBase {
  mode: 'classic';
  variant: ClassicVariant;
  classicDraft: ClassicCompletedDraft;
}

export type ChallengeCreation = SandboxChallengeCreation | ClassicChallengeCreation;

/** Validates a complete bracket artifact: content, legality, and schedule. */
export function validateBracketContent(bracket: OpponentBracket): string[] {
  const failures: string[] = [];
  const opponentIds = new Set<string>();
  const teamIds = new Set<string>();
  const players = new Set<string>();

  if (bracket.opponents.length !== 30) {
    failures.push(`bracket must contain 30 opponents (got ${String(bracket.opponents.length)})`);
  }
  for (const opponent of bracket.opponents) {
    if (opponentIds.has(opponent.opponentId)) {
      failures.push(`duplicate opponentId ${opponent.opponentId}`);
    }
    opponentIds.add(opponent.opponentId);
    if (teamIds.has(opponent.teamId)) {
      failures.push(`duplicate franchise identity ${opponent.teamId}`);
    }
    teamIds.add(opponent.teamId);
    const lineupValidation = validateLineup(opponent.lineup);
    if (!lineupValidation.ok) {
      failures.push(
        `opponent ${opponent.opponentId} lineup is not legal: ${lineupValidation.issues
          .map((i) => i.message)
          .join('; ')}`,
      );
    }
    const assignmentIds = opponent.lineup.assignments.map((a) => a.playerId);
    const playerIds = opponent.players.map((p) => p.playerId);
    if (new Set(assignmentIds).size !== 5 || assignmentIds.length !== 5) {
      failures.push(`opponent ${opponent.opponentId} lineup must assign five distinct players`);
    }
    for (const id of assignmentIds) {
      if (!playerIds.includes(id)) {
        failures.push(
          `opponent ${opponent.opponentId} lineup references ${id} missing from players`,
        );
      }
    }
    if (new Set(playerIds).size !== 5) {
      failures.push(`opponent ${opponent.opponentId} must carry five distinct players`);
    }
    for (const player of opponent.players) {
      if (players.has(player.playerId)) {
        failures.push(`player ${player.playerId} appears on multiple opponents`);
      }
      players.add(player.playerId);
    }
    if (
      opponent.strength.winRate < 0 ||
      opponent.strength.winRate > 1 ||
      opponent.strength.percentile < 0 ||
      opponent.strength.percentile > 1
    ) {
      failures.push(`opponent ${opponent.opponentId} strength outside 0..1`);
    }
  }

  const scheduleFailures = validateSchedule(bracket);
  failures.push(...scheduleFailures);
  return failures;
}

/** Validates the fixed schedule: 82 unique games, counts, and references. */
export function validateSchedule(bracket: OpponentBracket): string[] {
  const failures: string[] = [];
  const opponentIds = new Set(bracket.opponents.map((o) => o.opponentId));
  if (bracket.schedule.length !== 82) {
    failures.push(`schedule must contain 82 games (got ${String(bracket.schedule.length)})`);
    return failures;
  }
  const counts = new Map<string, number>();
  const seenNumbers = new Set<number>();
  for (const entry of bracket.schedule) {
    if (seenNumbers.has(entry.gameNumber)) {
      failures.push(`schedule repeats gameNumber ${String(entry.gameNumber)}`);
    }
    seenNumbers.add(entry.gameNumber);
    if (entry.gameNumber < 1 || entry.gameNumber > 82) {
      failures.push(`schedule gameNumber out of range: ${String(entry.gameNumber)}`);
    }
    if (!opponentIds.has(entry.opponentId)) {
      failures.push(`schedule references unknown opponentId ${entry.opponentId}`);
    }
    counts.set(entry.opponentId, (counts.get(entry.opponentId) ?? 0) + 1);
    if (
      entry.gameNumber > 1 &&
      entry.opponentId === bracket.schedule[entry.gameNumber - 2]?.opponentId
    ) {
      failures.push(
        `schedule repeats opponent ${entry.opponentId} at games ${String(entry.gameNumber - 1)} and ${String(entry.gameNumber)}`,
      );
    }
  }
  for (let n = 1; n <= 82; n += 1) {
    if (!seenNumbers.has(n)) {
      failures.push(`schedule is missing gameNumber ${String(n)}`);
    }
  }
  const threeCount = [...counts.values()].filter((c) => c === 3).length;
  const twoCount = [...counts.values()].filter((c) => c === 2).length;
  if (threeCount !== 22 || twoCount !== 8) {
    failures.push(
      `schedule counts must be 22 opponents x3 and 8 opponents x2 (got ${String(threeCount)}x3, ${String(twoCount)}x2)`,
    );
  }
  return failures;
}

/** Validates draft inputs shared by creation and replay helpers. */
function validateCreationInput(input: ChallengeCreation): string[] {
  const failures: string[] = [];

  if (!input.eraId || input.eraId.trim() === '') {
    failures.push('challenge requires a simulation decade');
  }
  if (input.profile.eraId !== input.eraId) {
    failures.push('eraId must match the era profile era');
  }
  const lineupValidation = validateLineup(input.lineup);
  if (!lineupValidation.ok) {
    failures.push(
      `lineup is not legal: ${lineupValidation.issues.map((i) => i.message).join('; ')}`,
    );
  }
  if (input.players.length !== 5) {
    failures.push('challenge requires exactly five player snapshots');
  }
  if (input.selections.length !== 5) {
    failures.push('challenge requires exactly five selections');
  }
  const snapshotIds = input.players.map((p) => p.playerId);
  if (new Set(snapshotIds).size !== snapshotIds.length) {
    failures.push('player snapshots must be distinct');
  }
  const assignmentIds = input.lineup.assignments.map((a) => a.playerId);
  for (const id of assignmentIds) {
    if (!snapshotIds.includes(id)) {
      failures.push(`lineup assignment ${id} has no matching player snapshot`);
    }
  }
  if (!seedSchema.safeParse(input.runSeed).success) {
    failures.push('run seed must be hex');
  }
  if (input.profile.dataVersion !== input.dataVersion) {
    failures.push('dataVersion must match the era profile dataVersion');
  }
  const band = input.bracket.difficulty;
  if (band.name !== 'medium') {
    failures.push(`bracket difficulty must be medium (got ${band.name})`);
  }
  failures.push(...validateBracketContent(input.bracket));
  if (input.mode === 'sandbox') {
    if (input.variant !== undefined) {
      failures.push('sandbox runs reject a classic variant');
    }
    if (input.classicDraft !== undefined) {
      failures.push('sandbox runs reject classic draft metadata');
    }
  } else {
    if (input.variant === undefined) {
      failures.push('classic runs require a variant');
    }
    if (input.classicDraft === undefined) {
      failures.push('classic runs require classic draft metadata');
    } else {
      const parsedDraft = classicCompletedDraftSchema.safeParse(input.classicDraft);
      if (!parsedDraft.success) {
        failures.push('classic draft metadata is invalid');
      } else {
        if (input.variant !== undefined && input.variant !== parsedDraft.data.variant) {
          failures.push('variant must match the classic draft variant');
        }
        const picks = parsedDraft.data.picks;
        if (picks.length !== 5) {
          failures.push('classic draft must contain exactly five picks');
        }
        const pickIds = picks.map((p) => p.playerId);
        if (new Set(pickIds).size !== pickIds.length) {
          failures.push('classic draft picks must reference distinct players');
        }
        const pickSlots = picks.map((p) => p.slotIndex);
        if (new Set(pickSlots).size !== pickSlots.length) {
          failures.push('classic draft picks must fill distinct slots');
        }
        if (!seedSchema.safeParse(input.classicDraft.seed).success) {
          failures.push('classic draft seed must be hex');
        }
        for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
          const pick = picks.find((p) => p.slotIndex === slotIndex);
          if (!pick) continue;
          if (input.lineup.assignments[slotIndex]?.playerId !== pick.playerId) {
            failures.push(
              `classic draft pick for slot ${String(slotIndex)} does not match the lineup`,
            );
          }
          if (input.selections[slotIndex]?.playerId !== pick.playerId) {
            failures.push(
              `classic draft pick for slot ${String(slotIndex)} does not match the selections`,
            );
          }
          if (input.players[slotIndex]?.playerId !== pick.playerId) {
            failures.push(
              `classic draft pick for slot ${String(slotIndex)} does not match the player snapshot`,
            );
          }
          const selection = input.selections[slotIndex];
          if (
            selection &&
            (selection.franchiseId !== pick.franchiseId || selection.eraId !== pick.eraId)
          ) {
            failures.push(
              `classic draft pick for slot ${String(slotIndex)} does not match selection provenance`,
            );
          }
        }
      }
    }
  }
  return failures;
}

/** Creates the authoritative accepted run state (spec/10 CreateChallenge). */
export function createChallenge(input: ChallengeCreation): ChallengeRun {
  const failures = validateCreationInput(input);
  if (failures.length > 0) {
    throw new Error(`createChallenge rejected: ${failures.join('; ')}`);
  }

  const aggregates: RunAggregates = zeroRunAggregates(input.players);
  const run: ChallengeRun = {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: input.runId,
    mode: input.mode,
    variant: input.variant,
    classicDraft: input.classicDraft,
    franchiseId: input.franchiseId,
    eraId: input.eraId,
    homeDisplayName: input.homeDisplayName,
    playerIds: input.players.map((p) => p.playerId),
    selections: input.selections,
    lineup: input.lineup,
    players: input.players,
    runSeed: input.runSeed,
    versions: {
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      dataVersion: input.dataVersion,
      ratingVersion: input.ratingVersion,
      positionNormalizationVersion: input.positionNormalizationVersion,
      engineVersion: input.engineVersion,
      bracketVersion: input.bracket.bracketVersion,
      scheduleVersion: input.bracket.scheduleVersion,
      seedDerivationVersion: SEED_DERIVATION_VERSION,
    },
    eraProfileVersion: input.profile.profileVersion,
    difficulty: input.bracket.difficulty,
    bracket: {
      bracketVersion: input.bracket.bracketVersion,
      scheduleVersion: input.bracket.scheduleVersion,
      opponents: input.bracket.opponents,
      schedule: input.bracket.schedule,
    },
    status: 'active',
    firstLossGameNumber: null,
    games: [],
    aggregates,
  };
  return run;
}

/** Resolves the opponent for a game number against the frozen schedule. */
export function opponentForGame(
  run: ChallengeRun,
  gameNumber: number,
): ChallengeRun['bracket']['opponents'][number] {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  const entry = run.bracket.schedule[gameNumber - 1];
  const opponent = run.bracket.opponents.find((o) => o.opponentId === entry?.opponentId);
  if (!opponent) {
    throw new Error(
      `game ${String(gameNumber)} references unknown opponent ${String(entry?.opponentId)}`,
    );
  }
  return opponent;
}

/** Builds the serialized input for one game number (worker + main thread share this). */
export function createGameInput(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  gameNumber: number,
): GameSimulationInput {
  const opponent = opponentForGame(run, gameNumber);
  const home: SimulationTeam = {
    teamId: 'user',
    displayName: run.homeDisplayName,
    players: run.players,
  };
  const away: SimulationTeam = {
    teamId: opponent.teamId,
    displayName: opponent.displayName,
    players: opponent.players,
  };
  return {
    schemaVersion: 2,
    seed: deriveGameSeed(run.runSeed, gameNumber),
    gameNumber,
    dataVersion: run.versions.dataVersion,
    profile,
    home,
    away,
  };
}

/** Builds the input for the next unplayed game, or null when the run is complete. */
export function createNextGameInput(
  run: ChallengeRun,
  profile: EraSimulationProfile,
): GameSimulationInput | null {
  if (run.status !== 'active') return null;
  const nextGame = run.games.length + 1;
  if (nextGame > 82) return null;
  return createGameInput(run, profile, nextGame);
}

/**
 * Verifies and accepts one game result (spec/03 outputs, spec/04 state
 * ownership). Returns a new accepted run; throws with a precise reason when
 * the result does not match the run's game number, opponent, derived seed, or
 * frozen versions. Runs never partially advance: on failure nothing changes.
 */
export function acceptGameResult(run: ChallengeRun, result: GameResult): ChallengeRun {
  const failures: string[] = [];
  if (run.status !== 'active') {
    failures.push(`run status is ${run.status}, not active`);
  }
  const expectedGame = run.games.length + 1;
  if (result.gameNumber !== expectedGame) {
    failures.push(`expected game ${String(expectedGame)}, got game ${String(result.gameNumber)}`);
  }
  const derivedSeed = deriveGameSeed(run.runSeed, result.gameNumber);
  if (result.seed !== derivedSeed) {
    failures.push(`seed for game ${String(result.gameNumber)} does not derive from the run seed`);
  }
  if (result.schemaVersion !== 1) {
    failures.push(`unsupported result schemaVersion ${String(result.schemaVersion)}`);
  }
  if (result.home.teamId !== 'user') {
    failures.push(`home team must be the user lineup (got ${result.home.teamId})`);
  }
  const opponent = opponentForGame(run, result.gameNumber);
  if (result.away.teamId !== opponent.teamId || result.away.displayName !== opponent.displayName) {
    failures.push(
      `game ${String(result.gameNumber)} opponent ${result.away.displayName} does not match scheduled ${opponent.displayName}`,
    );
  }
  if (result.engineVersion !== run.versions.engineVersion) {
    failures.push(
      `engine version mismatch: run ${run.versions.engineVersion}, result ${result.engineVersion}`,
    );
  }
  if (result.dataVersion !== run.versions.dataVersion) {
    failures.push(
      `data version mismatch: run ${run.versions.dataVersion}, result ${result.dataVersion}`,
    );
  }
  if (result.profileVersion !== run.eraProfileVersion) {
    failures.push(
      `era profile version mismatch: run ${run.eraProfileVersion}, result ${result.profileVersion}`,
    );
  }
  const invariantFailures = checkGameResult(result);
  if (invariantFailures.length > 0) {
    failures.push(`result fails exact invariants: ${invariantFailures.join('; ')}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `acceptGameResult rejected game ${String(result.gameNumber)}: ${failures.join('; ')}`,
    );
  }

  const games = [...run.games, result];
  const aggregates = addGameToAggregates(run.aggregates, result);
  const lost = result.winner === 'away';
  const firstLossGameNumber = lost
    ? (run.firstLossGameNumber ?? result.gameNumber)
    : run.firstLossGameNumber;
  const finished = games.length === 82;
  return {
    ...run,
    games,
    aggregates,
    firstLossGameNumber,
    status: finished ? 'finished' : 'active',
    ...(finished ? { outcome: firstLossGameNumber !== null ? 'eliminated' : 'perfect' } : {}),
  };
}

/** Runs the complete 82-game challenge from the next unplayed game onward. */
export function simulateChallenge(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): ChallengeRun {
  let current = run;
  while (current.status === 'active') {
    const input = createNextGameInput(current, profile);
    if (!input) break;
    // The authoritative check runs once, inside acceptGameResult below.
    const result = simulateGame(input, context);
    current = acceptGameResult(current, result);
  }
  return current;
}

/** Marks an active run abandoned (Cancel is the only way to pause). */
export function abandonChallenge(run: ChallengeRun): ChallengeRun {
  if (run.status !== 'active') {
    throw new Error(`cannot abandon a run in status ${run.status}`);
  }
  return { ...run, status: 'abandoned' };
}

export { SEED_DERIVATION_VERSION, deriveGameSeed };
