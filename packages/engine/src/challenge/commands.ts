import type {
  ChallengeRun,
  ClassicCompletedDraft,
  ClassicVariant,
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
import { validateLineup } from '../domain/lineup.ts';
import { auditScheduleEntries } from '../bracket/schedule.ts';
import type { EngineContext } from '../sim/context.ts';
import { simulateGame } from '../sim/game.ts';
import { checkGameResult } from '../sim/invariants.ts';
import { addGameToAggregates, zeroRunAggregates } from './aggregates.ts';
import { SEED_DERIVATION_VERSION, deriveGameSeed } from './seeds.ts';
export interface ChallengeCreationBase {
  runId: string;
  franchiseId: string | null;
  eraId: string;
  homeDisplayName: string;
  lineup: Lineup;
  players: SimulationPlayer[];
  selections: RunPlayerSelection[];
  runSeed: Seed;
  dataVersion: string;
  ratingVersion: string;
  positionNormalizationVersion: string;
  engineVersion: string;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
}
export interface SandboxChallengeCreation extends ChallengeCreationBase {
  mode: 'sandbox';
  variant?: undefined;
  classicDraft?: undefined;
}
export interface ClassicChallengeCreation extends ChallengeCreationBase {
  mode: 'classic';
  variant: ClassicVariant;
  classicDraft: ClassicCompletedDraft;
}
export type ChallengeCreation = SandboxChallengeCreation | ClassicChallengeCreation;
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
export function validateSchedule(bracket: OpponentBracket): string[] {
  const failures: string[] = [];
  const opponentIds = new Set(bracket.opponents.map((o) => o.opponentId));
  const facts = auditScheduleEntries(bracket.schedule, opponentIds);
  if (facts.length !== 82) {
    failures.push(`schedule must contain 82 games (got ${String(facts.length)})`);
    return failures;
  }
  for (const entry of facts.entries) {
    if (entry.repeatedNumber) {
      failures.push(`schedule repeats gameNumber ${String(entry.gameNumber)}`);
    }
    if (entry.outOfRange) {
      failures.push(`schedule gameNumber out of range: ${String(entry.gameNumber)}`);
    }
    if (entry.unknownOpponent) {
      failures.push(`schedule references unknown opponentId ${entry.opponentId}`);
    }
    if (entry.repeatsPreviousByGameNumber) {
      failures.push(
        `schedule repeats opponent ${entry.opponentId} at games ${String(entry.gameNumber - 1)} and ${String(entry.gameNumber)}`,
      );
    }
  }
  for (const n of facts.missingNumbers) {
    failures.push(`schedule is missing gameNumber ${String(n)}`);
  }
  if (facts.threeCount !== 22 || facts.twoCount !== 8) {
    failures.push(
      `schedule counts must be 22 opponents x3 and 8 opponents x2 (got ${String(facts.threeCount)}x3, ${String(facts.twoCount)}x2)`,
    );
  }
  return failures;
}
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
  failures.push(...validateBracketContent(input.bracket));
  if (input.mode === 'classic') {
    const parsedDraft = classicCompletedDraftSchema.safeParse(input.classicDraft);
    if (!parsedDraft.success) {
      failures.push('classic draft metadata is invalid');
    } else {
      if (input.variant !== parsedDraft.data.variant) {
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
  return failures;
}
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
export function createNextGameInput(
  run: ChallengeRun,
  profile: EraSimulationProfile,
): GameSimulationInput | null {
  if (run.status !== 'active') return null;
  const nextGame = run.games.length + 1;
  if (nextGame > 82) return null;
  return createGameInput(run, profile, nextGame);
}
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
export function simulateChallenge(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): ChallengeRun {
  let current = run;
  while (current.status === 'active') {
    const input = createNextGameInput(current, profile);
    if (!input) break;
    const result = simulateGame(input, context);
    current = acceptGameResult(current, result);
  }
  return current;
}
export function abandonChallenge(run: ChallengeRun): ChallengeRun {
  if (run.status !== 'active') {
    throw new Error(`cannot abandon a run in status ${run.status}`);
  }
  return { ...run, status: 'abandoned' };
}
