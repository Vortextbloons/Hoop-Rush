import type {
  ChallengeRun,
  ClassicCompletedDraft,
  ClassicVariant,
  EraSimulationProfile,
  GameResult,
  GameSimulationInput,
  LeagueRecord,
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
  eraIdSchema,
  franchiseIdSchema,
  leagueRecordDigest,
  leagueRecordSchema,
  seedSchema,
  type RunPlayerSelection,
} from '@hoop-rush/data-contracts';
import { validateLineup } from '../domain/lineup.ts';
import { auditScheduleEntries } from '../bracket/schedule.ts';
import type { EngineContext } from '../sim/kernel.ts';
import { createGameBatchSimulator } from '../sim/game.ts';
import { checkGameResult } from '../sim/invariants.ts';
import { addGameToAggregates, zeroRunAggregates } from './aggregates.ts';
import { leagueGamesSimulated, leagueQuotas } from './league.ts';
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
  league?: LeagueRecord;
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
function validateLeagueContent(input: ChallengeCreation): string[] {
  const league = input.league;
  if (!league) return [];
  const failures: string[] = [];
  const parsed = leagueRecordSchema.safeParse(league);
  if (!parsed.success) {
    failures.push('league record is invalid');
    return failures;
  }
  if (league.seed !== input.runSeed) {
    failures.push('league seed must match the run seed');
  }
  if (league.bracketVersion !== input.bracket.bracketVersion) {
    failures.push('league bracket version must match the bracket');
  }
  if (league.dataVersion !== input.dataVersion) {
    failures.push('league data version must match the run data version');
  }
  if (league.eraProfileVersion !== input.profile.profileVersion) {
    failures.push('league profile version must match the era profile');
  }
  let quotas: number[] = [];
  let expectedGames = 0;
  try {
    quotas = leagueQuotas(input.bracket);
    expectedGames = leagueGamesSimulated(input.bracket);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return failures;
  }
  if (league.gamesSimulated !== expectedGames) {
    failures.push(
      `league must simulate ${String(expectedGames)} games (got ${String(league.gamesSimulated)})`,
    );
  }
  for (const [index, opponent] of input.bracket.opponents.entries()) {
    const team = league.teams[index];
    if (team === undefined) continue;
    if (team.teamId !== opponent.teamId) {
      failures.push(`league team ${String(index)} does not match the bracket`);
    }
    const quota = quotas[index] ?? 0;
    if (team.gamesPlayed !== quota) {
      failures.push(
        `league team ${team.teamId} must play ${String(quota)} opponent games (got ${String(team.gamesPlayed)})`,
      );
    }
    if (team.wins + team.losses !== team.gamesPlayed) {
      failures.push(`league team ${team.teamId} wins and losses must sum to games played`);
    }
  }
  const seenKeys = new Set<string>();
  for (const player of league.players) {
    const index = input.bracket.opponents.findIndex(
      (opponent) => opponent.teamId === player.teamId,
    );
    if (index < 0) {
      failures.push(`league player ${player.playerId} references unknown team ${player.teamId}`);
      continue;
    }
    const opponent = input.bracket.opponents[index];
    const known = opponent?.players.some((entry) => entry.playerId === player.playerId) ?? false;
    if (!known) {
      failures.push(`league player ${player.playerId} is not on team ${player.teamId}`);
      continue;
    }
    const key = `${String(index)}|${player.playerId}`;
    if (seenKeys.has(key)) {
      failures.push(`league player ${player.playerId} appears twice in the league record`);
    }
    seenKeys.add(key);
    const quota = quotas[index] ?? 0;
    if (player.games !== quota) {
      failures.push(
        `league player ${player.playerId} must play ${String(quota)} opponent games (got ${String(player.games)})`,
      );
    }
  }
  const expectedPlayers = input.bracket.opponents.reduce(
    (sum, opponent) => sum + opponent.players.length,
    0,
  );
  if (seenKeys.size !== expectedPlayers) {
    failures.push(
      `league player totals must cover every bracket player (got ${String(seenKeys.size)} of ${String(expectedPlayers)})`,
    );
  }
  if (leagueRecordDigest(league) !== league.digest) {
    failures.push('league digest does not match its contents');
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
  failures.push(...validateLeagueContent(input));
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
    franchiseId: input.franchiseId === null ? null : franchiseIdSchema.parse(input.franchiseId),
    eraId: eraIdSchema.parse(input.eraId),
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
    ...(input.league ? { league: input.league } : {}),
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
  if (profile.dataVersion !== run.versions.dataVersion) {
    throw new Error(
      `era profile data version ${profile.dataVersion} does not match run data version ${run.versions.dataVersion}`,
    );
  }
  if (profile.profileVersion !== run.eraProfileVersion) {
    throw new Error(
      `era profile version ${profile.profileVersion} does not match run era profile version ${run.eraProfileVersion}`,
    );
  }
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
  const identityMismatch = (
    side: 'home' | 'away',
    actual: readonly string[],
    scheduled: readonly string[],
  ): string | null => {
    if (
      actual.length !== scheduled.length ||
      actual.some((playerId, index) => playerId !== scheduled[index])
    ) {
      return `game ${String(result.gameNumber)} ${side} player identities ${actual.join(',')} do not match scheduled ${scheduled.join(',')}`;
    }
    return null;
  };
  const homeIdentity = identityMismatch(
    'home',
    result.home.players.map((player) => player.playerId),
    run.players.map((player) => player.playerId),
  );
  if (homeIdentity !== null) failures.push(homeIdentity);
  const awayIdentity = identityMismatch(
    'away',
    result.away.players.map((player) => player.playerId),
    opponent.players.map((player) => player.playerId),
  );
  if (awayIdentity !== null) failures.push(awayIdentity);
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
  const simulate = createGameBatchSimulator(context);
  let current = run;
  while (current.status === 'active') {
    const input = createNextGameInput(current, profile);
    if (!input) break;
    const result = simulate(input);
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
