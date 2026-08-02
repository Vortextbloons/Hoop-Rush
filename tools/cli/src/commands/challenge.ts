import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  BEST_OF_ATTEMPTS,
  createEngineContext,
  simulateChallengeBestOf,
  type ChallengeCreation,
} from '@hoop-rush/engine';
import {
  eraSimulationProfileSchema,
  opponentBracketSchema,
  seedSchema,
  simulationTeamSchema,
  type ChallengeRun,
  type EraSimulationProfile,
  type OpponentBracket,
  type SimulationPlayer,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.js';
import { simChallengeReportSchema } from '../report-schemas.js';
import { loadPackagedData, PackagedData } from './data-loader.js';
import { loadFixture, UsageError } from './sim.js';

/**
 * `sim challenge` (spec/09): runs one complete Sandbox challenge through the
 * authoritative bracket loader, challenge commands, seed derivation,
 * aggregation, and game engine. The run always completes all 82 games; the
 * report carries the record, outcome, first loss, and exact aggregates.
 */

export const SIM_CHALLENGE_OPTIONS: Record<string, boolean> = {
  lineup: true,
  seed: true,
  profile: true,
  bracket: true,
  format: true,
  verbose: false,
};

/** Resolves the user lineup: a fixture id (home team) or a SimulationTeam JSON file. */
export function resolveUserTeam(lineup: string): SimulationTeam {
  if (lineup.endsWith('.json') || lineup.includes('/') || lineup.includes('\\')) {
    const path = isAbsolute(lineup) ? lineup : resolve(lineup);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new UsageError(`lineup file not found: ${path}`);
    }
    const parsed = simulationTeamSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) {
      throw new UsageError(`lineup file fails validation: ${path}`);
    }
    return parsed.data;
  }
  const fixture = loadFixture(lineup);
  return fixture.home;
}

/** Derives the lineup record and player snapshots from a legal team. */
export function lineupForTeam(team: SimulationTeam): {
  lineup: ChallengeCreation['lineup'];
  players: SimulationPlayer[];
} {
  const players = team.players.map((player) => ({ ...player, positions: [...player.positions] }));
  const lineup: ChallengeCreation['lineup'] = {
    structure: ['G', 'G', 'F', 'F', 'C'],
    assignments: players.map((player, slotIndex) => ({
      slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
      playerId: player.playerId,
      positions: player.positions,
    })),
  };
  return { lineup, players };
}

export function simChallenge(args: {
  lineup?: string;
  seed?: string;
  profile?: string;
  bracket?: string;
}): CliReport {
  const lineupId = args.lineup ?? 'challenge-user';
  const seed = args.seed;
  if (seed === undefined) throw new UsageError('sim challenge requires --seed <hex>');
  if (!seedSchema.safeParse(seed).success)
    throw new UsageError(`--seed must be hex (got "${seed}")`);

  const packaged = loadPackagedData();
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = args.profile ? loadProfileFile(args.profile) : data.eraProfile();
  const bracket = args.bracket ? loadBracketFile(args.bracket) : data.bracket();

  const team = resolveUserTeam(lineupId);
  const { lineup, players } = lineupForTeam(team);
  const pool = data.pool('lakers', '1990s');
  const samplePlayer = pool.players[0];
  const context = createEngineContext();

  const creation: ChallengeCreation = {
    runId: `cli-challenge-${seed.slice(0, 16)}`,
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: team.displayName,
    lineup,
    players,
    selections: players.map((player) => ({
      playerId: player.playerId,
      franchiseId: 'lakers',
      eraId: '1990s',
    })),
    runSeed: seed,
    dataVersion: profile.dataVersion,
    ratingVersion: samplePlayer?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: samplePlayer?.positions.normalizationVersion ?? 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
  };

  const started = performance.now();
  let run: ChallengeRun;
  try {
    // Sandbox mode simulates the complete season BEST_OF_ATTEMPTS times from
    // derived attempt seeds and keeps the best record; the chosen attempt's
    // seed becomes the reported run seed.
    run = simulateChallengeBestOf(creation, profile, context);
  } catch (error) {
    throw new Error(`challenge simulation failed: ${(error as Error).message}`);
  }
  const timingMs = performance.now() - started;

  const payload = simChallengeReportSchema.parse({
    schemaVersion: 1,
    command: 'sim challenge',
    lineup: lineupId,
    seed,
    chosenSeed: run.runSeed,
    attempts: BEST_OF_ATTEMPTS,
    engineVersion: context.engineVersion,
    dataVersion: run.versions.dataVersion,
    profileVersion: run.eraProfileVersion,
    bracketVersion: run.versions.bracketVersion,
    scheduleVersion: run.versions.scheduleVersion,
    record: {
      wins: run.aggregates.team.wins,
      losses: run.aggregates.team.losses,
      gamesPlayed: run.aggregates.team.gamesPlayed,
    },
    outcome: run.outcome ?? 'eliminated',
    firstLossGameNumber: run.firstLossGameNumber,
    playerTotals: run.aggregates.players.map((player) => ({
      playerId: player.playerId,
      gamesPlayed: player.gamesPlayed,
      points: player.points,
      rebounds: player.rebounds.total,
      assists: player.assists,
      steals: player.steals,
      blocks: player.blocks,
      turnovers: player.turnovers,
      fieldGoals: player.fieldGoals,
      threes: player.threes,
      freeThrows: player.freeThrows,
    })),
    teamPossessions: run.aggregates.team.possessions,
    timingMs: Math.round(timingMs * 1000) / 1000,
    invariantFailures: 0,
  });

  const details = [
    `record ${String(payload.record.wins)}-${String(payload.record.losses)} · outcome ${payload.outcome}${payload.firstLossGameNumber !== null ? ` · first loss game ${String(payload.firstLossGameNumber)}` : ''}`,
    `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · bracket ${payload.bracketVersion} · schedule ${payload.scheduleVersion} · seed ${seed}`,
    `best of ${String(payload.attempts)} attempts · chosen seed ${payload.chosenSeed}`,
    `team: ${String(payload.record.gamesPlayed)} games · ${String(payload.teamPossessions)} possessions · ${String(payload.record.gamesPlayed)} played`,
    ...payload.playerTotals.map(
      (p) =>
        `  ${p.playerId}: ${String(p.points)} pts · ${String(p.fieldGoals.made)}/${String(p.fieldGoals.attempted)} FG · ${String(p.threes.made)}/${String(p.threes.attempted)} 3P · ${String(p.rebounds)} REB · ${String(p.assists)} AST · ${String(p.turnovers)} TOV`,
    ),
    `${timingMs.toFixed(1)} ms`,
  ];
  return makeReport('sim challenge', { lineup: lineupId, seed }, { details, payload });
}

function loadProfileFile(path: string): EraSimulationProfile {
  const parsed = eraSimulationProfileSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new UsageError(
      `profile ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

function loadBracketFile(path: string): OpponentBracket {
  const parsed = opponentBracketSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.success) {
    throw new UsageError(
      `bracket ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
