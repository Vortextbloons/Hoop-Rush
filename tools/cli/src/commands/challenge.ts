import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  BEST_OF_ATTEMPTS,
  createEngineContext,
  simulateChallengeBestOf,
  toSimulationPlayer,
  type ChallengeCreation,
} from '@hoop-rush/engine';
import {
  FIXED_SANDBOX_ERA,
  LINEUP_STRUCTURE,
  playerIdSchema,
  seedSchema,
  simulationTeamSchema,
  type ChallengeRun,
  type PeakPlayerSeason,
  type PlayersIndex,
  type PlayersIndexEntry,
  type SimulationPlayer,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import { parseCount, UsageError } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import { simChallengeReportSchema } from '../report-schemas.ts';
import { loadPackagedData, PackagedData, loadBracketFile, loadProfileFile } from './data-loader.ts';
import { loadFixture } from './sim.ts';

export { FIXED_SANDBOX_ERA };

export const SIM_CHALLENGE_OPTIONS: Record<string, boolean> = {
  lineup: true,
  seed: true,
  reruns: true,
  era: true,
  profile: true,
  bracket: true,
  format: true,
  verbose: false,
};

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

interface PoolRef {
  playerId: string;
  franchiseId: string;
  eraId: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function franchiseDisplayName(data: PackagedData, franchiseId: string): string {
  return (
    data.manifest.modernFranchiseSlots.find((franchise) => franchise.franchiseId === franchiseId)
      ?.displayName ?? franchiseId
  );
}

function resolveFranchiseQualifier(data: PackagedData, value: string): string | null {
  const normalized = normalizeName(value);
  for (const franchise of data.manifest.modernFranchiseSlots) {
    if (
      franchise.franchiseId === normalized ||
      normalizeName(franchise.displayName) === normalized
    ) {
      return franchise.franchiseId;
    }
  }
  return null;
}

function nameMatches(row: PlayersIndexEntry, name: string): boolean {
  const normalized = normalizeName(name);
  return (
    normalizeName(row.displayName) === normalized ||
    normalizeName(`${row.firstName} ${row.lastName}`) === normalized
  );
}

export function bestRow(rows: PlayersIndexEntry[]): PlayersIndexEntry {
  const sorted = [...rows].sort((a, b) => {
    if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
    if (a.seasonKey !== b.seasonKey) return a.seasonKey < b.seasonKey ? -1 : 1;
    return 0;
  });
  const best = sorted[0];
  if (!best) throw new UsageError('--lineup: no matching players');
  return best;
}

const CANDIDATE_CAP = 12;

function resolveName(
  name: string,
  franchiseId: string | undefined,
  eraId: string | undefined,
  index: PlayersIndex,
  data: PackagedData,
): PoolRef {
  const rows = index.players.filter(
    (row) =>
      nameMatches(row, name) &&
      (franchiseId === undefined || row.franchiseId === franchiseId) &&
      (eraId === undefined || row.eraId === eraId),
  );
  if (rows.length === 0) {
    const where = franchiseId
      ? ` in ${franchiseDisplayName(data, franchiseId)}${eraId ? ` (${eraId})` : ''}`
      : '';
    throw new UsageError(`--lineup: no player named "${name}"${where}`);
  }
  if (franchiseId === undefined && rows.length > 1) {
    const candidates = rows
      .slice(0, CANDIDATE_CAP)
      .map(
        (row) => `${row.displayName}@${franchiseDisplayName(data, row.franchiseId)}/${row.eraId}`,
      )
      .join(', ');
    const suffix =
      rows.length > CANDIDATE_CAP ? `, and ${String(rows.length - CANDIDATE_CAP)} more` : '';
    throw new UsageError(
      `--lineup: "${name}" matches multiple peaks; qualify it: ${candidates}${suffix}`,
    );
  }
  if (franchiseId === undefined) {
    const row = rows[0];
    if (!row) throw new UsageError(`--lineup: no player named "${name}"`);
    return { playerId: row.playerId, franchiseId: row.franchiseId, eraId: row.eraId };
  }
  return bestRow(rows);
}

function resolveQualifiedId(
  playerId: string,
  qualifier: string,
  token: string,
  index: PlayersIndex,
): PoolRef {
  const slash = qualifier.indexOf('/');
  if (slash === -1 || qualifier.indexOf('/', slash + 1) !== -1) {
    throw new UsageError(
      `--lineup: "${token}" must be a playerId, playerId@franchiseId/eraId, a player name, or name@franchise/era`,
    );
  }
  const franchiseId = qualifier.slice(0, slash);
  const eraId = qualifier.slice(slash + 1);
  const row = index.players.find(
    (candidate) =>
      candidate.playerId === playerId &&
      candidate.franchiseId === franchiseId &&
      candidate.eraId === eraId,
  );
  if (!row) {
    throw new UsageError(`--lineup: no peak for ${playerId} in ${franchiseId}/${eraId}`);
  }
  return { playerId, franchiseId, eraId };
}

function resolveQualifiedName(
  name: string,
  qualifier: string,
  token: string,
  index: PlayersIndex,
  data: PackagedData,
): PoolRef {
  const slash = qualifier.indexOf('/');
  if (slash === -1) {
    const franchiseId = resolveFranchiseQualifier(data, qualifier);
    if (!franchiseId) throw new UsageError(`--lineup: unknown franchise "${qualifier}"`);
    return resolveName(name, franchiseId, undefined, index, data);
  }
  const franchisePart = qualifier.slice(0, slash);
  const eraPart = qualifier.slice(slash + 1);
  if (eraPart.includes('/')) {
    throw new UsageError(
      `--lineup: "${token}" must be a playerId, playerId@franchiseId/eraId, a player name, or name@franchise/era`,
    );
  }
  const franchiseId = resolveFranchiseQualifier(data, franchisePart);
  if (!franchiseId) throw new UsageError(`--lineup: unknown franchise "${franchisePart}"`);
  const era = data.manifest.eras.find((entry) => entry.eraId === normalizeName(eraPart));
  if (!era) throw new UsageError(`--lineup: unknown era "${eraPart}"`);
  return resolveName(name, franchiseId, era.eraId, index, data);
}

function parsePoolRef(token: string, index: PlayersIndex, data: PackagedData): PoolRef {
  const at = token.indexOf('@');
  if (at === -1) {
    if (playerIdSchema.safeParse(token).success) {
      const matches = index.players.filter((row) => row.playerId === token);
      if (matches.length === 0) {
        throw new UsageError(`--lineup: unknown player id "${token}"`);
      }
      if (matches.length > 1) {
        const candidates = matches
          .map((row) => `${row.playerId}@${row.franchiseId}/${row.eraId}`)
          .join(', ');
        throw new UsageError(
          `--lineup: player id "${token}" matches multiple peaks; qualify it: ${candidates}`,
        );
      }
      const row = matches[0];
      if (!row) throw new UsageError(`--lineup: unknown player id "${token}"`);
      return { playerId: row.playerId, franchiseId: row.franchiseId, eraId: row.eraId };
    }
    return resolveName(token, undefined, undefined, index, data);
  }
  const left = token.slice(0, at);
  const qualifier = token.slice(at + 1);
  if (left.length === 0) {
    throw new UsageError(
      `--lineup: "${token}" must be a playerId, playerId@franchiseId/eraId, a player name, or name@franchise/era`,
    );
  }
  if (playerIdSchema.safeParse(left).success) {
    return resolveQualifiedId(left, qualifier, token, index);
  }
  return resolveQualifiedName(left, qualifier, token, index, data);
}

export function resolvePoolLineup(spec: string, data: PackagedData): PeakPlayerSeason[] {
  const tokens = spec
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length !== 5) {
    throw new UsageError(`--lineup requires exactly five players (got ${String(tokens.length)})`);
  }
  const index = data.playersIndex();
  const refs = tokens.map((token) => parsePoolRef(token, index, data));
  if (new Set(refs.map((ref) => ref.playerId)).size !== 5) {
    throw new UsageError('--lineup requires five distinct players');
  }
  const byPool = new Map<string, Map<string, PeakPlayerSeason>>();
  for (const key of new Set(refs.map((ref) => `${ref.franchiseId}/${ref.eraId}`))) {
    const slash = key.indexOf('/');
    const pool = data.pool(key.slice(0, slash), key.slice(slash + 1));
    byPool.set(key, new Map(pool.players.map((player) => [player.playerId, player])));
  }
  return refs.map((ref) => {
    const player = byPool.get(`${ref.franchiseId}/${ref.eraId}`)?.get(ref.playerId);
    if (!player) {
      throw new UsageError(
        `--lineup: ${ref.playerId} is missing from the ${ref.franchiseId}/${ref.eraId} pool`,
      );
    }
    return player;
  });
}

export function simChallenge(args: {
  lineup?: string;
  seed?: string;
  reruns?: string;
  era?: string;
  profile?: string;
  bracket?: string;
}): CliReport {
  const lineupSpec = args.lineup;
  if (lineupSpec === undefined) {
    throw new UsageError(
      'sim challenge requires --lineup <playerId[,playerId@franchise/era] or Name[,Name@Franchise/era]>',
    );
  }
  const seed = args.seed;
  if (seed === undefined) throw new UsageError('sim challenge requires --seed <hex>');
  if (!seedSchema.safeParse(seed).success)
    throw new UsageError(`--seed must be hex (got "${seed}")`);
  const reruns = parseCount(args.reruns, '--reruns', BEST_OF_ATTEMPTS);
  if (reruns < 1) throw new UsageError('--reruns must be >= 1');
  const eraId = args.era ?? FIXED_SANDBOX_ERA;

  const packaged = loadPackagedData();
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = args.profile ? loadProfileFile(args.profile) : data.eraProfile(eraId);
  const bracket = args.bracket ? loadBracketFile(args.bracket) : data.bracket();

  const resolved = resolvePoolLineup(lineupSpec, data);
  const players = resolved.map((player) => toSimulationPlayer(player));
  const sample = resolved[0];
  const context = createEngineContext();

  const creation: ChallengeCreation = {
    runId: `cli-challenge-${seed.slice(0, 16)}`,
    mode: 'sandbox',
    franchiseId: null,
    eraId,
    homeDisplayName: resolved
      .map((player) => player.displayName)
      .join(' · ')
      .slice(0, 96),
    lineup: {
      structure: [...LINEUP_STRUCTURE],
      assignments: resolved.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.playable,
      })),
    },
    players,
    selections: resolved.map((player) => ({
      playerId: player.playerId,
      franchiseId: player.franchiseId,
      eraId: player.eraId,
    })),
    runSeed: seed,
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
  };

  const started = performance.now();
  let run: ChallengeRun;
  try {
    run = simulateChallengeBestOf(creation, profile, context, reruns);
  } catch (error) {
    throw new Error(`challenge simulation failed: ${(error as Error).message}`);
  }
  const timingMs = performance.now() - started;

  const payload = simChallengeReportSchema.parse({
    schemaVersion: 1,
    command: 'sim challenge',
    lineup: lineupSpec,
    seed,
    eraId,
    chosenSeed: run.runSeed,
    attempts: reruns,
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
      minutes: player.minutes,
      points: player.points,
      rebounds: player.rebounds.total,
      assists: player.assists,
      steals: player.steals,
      blocks: player.blocks,
      turnovers: player.turnovers,
      fouls: player.fouls,
      fieldGoals: player.fieldGoals,
      threes: player.threes,
      freeThrows: player.freeThrows,
    })),
    teamPossessions: run.aggregates.team.possessions,
    timingMs: Math.round(timingMs * 1000) / 1000,
    invariantFailures: 0,
  });

  const displayName = new Map(run.players.map((player) => [player.playerId, player.displayName]));
  const nameWidth = Math.max(
    6,
    ...payload.playerTotals.map((p) => (displayName.get(p.playerId) ?? p.playerId).length),
  );
  const padName = (value: string) => value.padEnd(nameWidth);
  const padNum = (value: number | string, width: number) => String(value).padStart(width);
  const padAvg = (value: number, width: number) => value.toFixed(1).padStart(width);
  const shots = (made: number, attempted: number, width: number) =>
    `${String(made)}/${String(attempted)}`.padStart(width);
  const avg = (value: number, games: number) => (games > 0 ? value / games : 0);
  const pct = (made: number, attempted: number) =>
    attempted > 0 ? `${((made / attempted) * 100).toFixed(1)}%` : '-';
  const padPct = (made: number, attempted: number, width: number) =>
    pct(made, attempted).padStart(width);
  const totals = payload.playerTotals.reduce(
    (acc, p) => {
      acc.gamesPlayed += p.gamesPlayed;
      acc.minutes += p.minutes;
      acc.points += p.points;
      acc.rebounds += p.rebounds;
      acc.assists += p.assists;
      acc.steals += p.steals;
      acc.blocks += p.blocks;
      acc.turnovers += p.turnovers;
      acc.fouls += p.fouls;
      acc.fieldGoals.made += p.fieldGoals.made;
      acc.fieldGoals.attempted += p.fieldGoals.attempted;
      acc.threes.made += p.threes.made;
      acc.threes.attempted += p.threes.attempted;
      acc.freeThrows.made += p.freeThrows.made;
      acc.freeThrows.attempted += p.freeThrows.attempted;
      return acc;
    },
    {
      gamesPlayed: 0,
      minutes: 0,
      points: 0,
      rebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      fieldGoals: { made: 0, attempted: 0 },
      threes: { made: 0, attempted: 0 },
      freeThrows: { made: 0, attempted: 0 },
    },
  );
  const header = [
    padName('Player'),
    padNum('GP', 3),
    padNum('MPG', 5),
    padNum('PPG', 5),
    padNum('RPG', 5),
    padNum('APG', 5),
    padNum('SPG', 5),
    padNum('BPG', 5),
    padNum('TPG', 5),
    padNum('FPG', 5),
    'FG'.padStart(8),
    'FG%'.padStart(6),
    '3P'.padStart(7),
    '3P%'.padStart(6),
    'FT'.padStart(8),
    'FT%'.padStart(6),
  ].join('  ');
  const playerLines = payload.playerTotals.map((p) =>
    [
      padName(displayName.get(p.playerId) ?? p.playerId),
      padNum(p.gamesPlayed, 3),
      padAvg(avg(p.minutes, p.gamesPlayed), 5),
      padAvg(avg(p.points, p.gamesPlayed), 5),
      padAvg(avg(p.rebounds, p.gamesPlayed), 5),
      padAvg(avg(p.assists, p.gamesPlayed), 5),
      padAvg(avg(p.steals, p.gamesPlayed), 5),
      padAvg(avg(p.blocks, p.gamesPlayed), 5),
      padAvg(avg(p.turnovers, p.gamesPlayed), 5),
      padAvg(avg(p.fouls, p.gamesPlayed), 5),
      shots(p.fieldGoals.made, p.fieldGoals.attempted, 8),
      padPct(p.fieldGoals.made, p.fieldGoals.attempted, 6),
      shots(p.threes.made, p.threes.attempted, 7),
      padPct(p.threes.made, p.threes.attempted, 6),
      shots(p.freeThrows.made, p.freeThrows.attempted, 8),
      padPct(p.freeThrows.made, p.freeThrows.attempted, 6),
    ].join('  '),
  );
  const totalsLine = [
    padName('Totals'),
    padNum(totals.gamesPlayed, 3),
    padNum(totals.minutes, 5),
    padNum(totals.points, 5),
    padNum(totals.rebounds, 5),
    padNum(totals.assists, 5),
    padNum(totals.steals, 5),
    padNum(totals.blocks, 5),
    padNum(totals.turnovers, 5),
    padNum(totals.fouls, 5),
    shots(totals.fieldGoals.made, totals.fieldGoals.attempted, 8),
    padPct(totals.fieldGoals.made, totals.fieldGoals.attempted, 6),
    shots(totals.threes.made, totals.threes.attempted, 7),
    padPct(totals.threes.made, totals.threes.attempted, 6),
    shots(totals.freeThrows.made, totals.freeThrows.attempted, 8),
    padPct(totals.freeThrows.made, totals.freeThrows.attempted, 6),
  ].join('  ');
  const details = [
    `record ${String(payload.record.wins)}-${String(payload.record.losses)} · outcome ${payload.outcome}${payload.firstLossGameNumber !== null ? ` · first loss game ${String(payload.firstLossGameNumber)}` : ''}`,
    `best of ${String(payload.attempts)} attempts · chosen seed ${payload.chosenSeed}`,
    `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · bracket ${payload.bracketVersion} · schedule ${payload.scheduleVersion} · era ${eraId} · seed ${seed}`,
    `team: ${String(payload.record.gamesPlayed)} games · ${String(payload.teamPossessions)} possessions`,
    header,
    ...playerLines,
    totalsLine,
    `${timingMs.toFixed(1)} ms`,
  ];
  return makeReport('sim challenge', { lineup: lineupSpec, seed }, { details, payload });
}
