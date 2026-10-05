import { simulateChallengeAttempts } from '@hoop-rush/engine';
import type {
  ChallengeRun,
  PlayerSeasonAggregate,
  SimulationPlayer,
  TeamAggregate,
} from '@hoop-rush/data-contracts';
import { parseCount, UsageError } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import { simChallengeAverageReportSchema } from '../report-schemas.ts';
import { prepareChallenge } from './challenge.ts';
export const CHALLENGE_AVERAGE_ATTEMPTS = 10;
export const SIM_CHALLENGE_AVERAGE_OPTIONS: Record<string, boolean> = {
  lineup: true,
  seed: true,
  reruns: true,
  era: true,
  profile: true,
  bracket: true,
  format: true,
  verbose: false,
};
interface Spread {
  mean: number;
  min: number;
  max: number;
  stddev: number;
}
interface PlayerSpread {
  gamesPlayed: Spread;
  minutes: Spread;
  points: Spread;
  rebounds: {
    total: Spread;
    offensive: Spread;
    defensive: Spread;
  };
  assists: Spread;
  steals: Spread;
  blocks: Spread;
  turnovers: Spread;
  fouls: Spread;
  fieldGoals: {
    made: Spread;
    attempted: Spread;
  };
  threes: {
    made: Spread;
    attempted: Spread;
  };
  freeThrows: {
    made: Spread;
    attempted: Spread;
  };
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
function spread(values: readonly number[]): Spread {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, stddev: 0 };
  const first = values[0] ?? 0;
  let sum = 0;
  let min = first;
  let max = first;
  for (const value of values) {
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const mean = sum / values.length;
  let squared = 0;
  for (const value of values) squared += (value - mean) * (value - mean);
  return {
    mean: round3(mean),
    min: round3(min),
    max: round3(max),
    stddev: round3(Math.sqrt(squared / values.length)),
  };
}
function playerSpread(
  rows: readonly PlayerSeasonAggregate[],
  pick: (row: PlayerSeasonAggregate) => number,
): Spread {
  return spread(rows.map(pick));
}
function computePlayerSpread(rows: readonly PlayerSeasonAggregate[]): PlayerSpread {
  return {
    gamesPlayed: playerSpread(rows, (row) => row.gamesPlayed),
    minutes: playerSpread(rows, (row) => row.minutes),
    points: playerSpread(rows, (row) => row.points),
    rebounds: {
      total: playerSpread(rows, (row) => row.rebounds.total),
      offensive: playerSpread(rows, (row) => row.rebounds.offensive),
      defensive: playerSpread(rows, (row) => row.rebounds.defensive),
    },
    assists: playerSpread(rows, (row) => row.assists),
    steals: playerSpread(rows, (row) => row.steals),
    blocks: playerSpread(rows, (row) => row.blocks),
    turnovers: playerSpread(rows, (row) => row.turnovers),
    fouls: playerSpread(rows, (row) => row.fouls),
    fieldGoals: {
      made: playerSpread(rows, (row) => row.fieldGoals.made),
      attempted: playerSpread(rows, (row) => row.fieldGoals.attempted),
    },
    threes: {
      made: playerSpread(rows, (row) => row.threes.made),
      attempted: playerSpread(rows, (row) => row.threes.attempted),
    },
    freeThrows: {
      made: playerSpread(rows, (row) => row.freeThrows.made),
      attempted: playerSpread(rows, (row) => row.freeThrows.attempted),
    },
  };
}
function teamSpread(rows: readonly TeamAggregate[], pick: (row: TeamAggregate) => number): Spread {
  return spread(rows.map(pick));
}
export function simChallengeAverage(args: {
  lineup?: string;
  seed?: string;
  reruns?: string;
  era?: string;
  profile?: string;
  bracket?: string;
}): CliReport {
  const { lineupSpec, seed, eraId, creation, profile, context } = prepareChallenge(
    args,
    'sim challenge-average',
  );
  const reruns = parseCount(args.reruns, '--reruns', CHALLENGE_AVERAGE_ATTEMPTS);
  if (reruns < 1) throw new UsageError('--reruns must be >= 1');
  const started = performance.now();
  let runs: ChallengeRun[];
  try {
    runs = simulateChallengeAttempts(creation, profile, context, reruns);
  } catch (error) {
    throw new Error(`challenge simulation failed: ${(error as Error).message}`);
  }
  const timingMs = performance.now() - started;
  const first = runs[0];
  if (!first) throw new Error('sim challenge-average produced no attempts');
  const teamRows = runs.map((run) => run.aggregates.team);
  const playerRowsByRun = runs.map(
    (run) => new Map(run.aggregates.players.map((row) => [row.playerId, row])),
  );
  const players: SimulationPlayer[] = first.players;
  const playerSpreads = players.map((player) => ({
    player,
    stats: computePlayerSpread(
      playerRowsByRun.flatMap((rows) => {
        const row = rows.get(player.playerId);
        return row === undefined ? [] : [row];
      }),
    ),
  }));
  const outcomes = { perfect: 0, eliminated: 0 };
  for (const run of runs) {
    if (run.outcome === 'perfect') outcomes.perfect += 1;
    else if (run.outcome === 'eliminated') outcomes.eliminated += 1;
  }
  const payload = simChallengeAverageReportSchema.parse({
    schemaVersion: 1,
    command: 'sim challenge-average',
    lineup: lineupSpec,
    seed,
    eraId,
    attempts: reruns,
    engineVersion: context.engineVersion,
    dataVersion: first.versions.dataVersion,
    profileVersion: first.eraProfileVersion,
    bracketVersion: first.versions.bracketVersion,
    scheduleVersion: first.versions.scheduleVersion,
    outcomes,
    record: {
      wins: teamSpread(teamRows, (row) => row.wins),
      losses: teamSpread(teamRows, (row) => row.losses),
      gamesPlayed: teamSpread(teamRows, (row) => row.gamesPlayed),
    },
    teamPossessions: teamSpread(teamRows, (row) => row.possessions),
    playerAverages: playerSpreads.map(({ player, stats }) => ({
      playerId: player.playerId,
      gamesPlayed: stats.gamesPlayed,
      minutes: stats.minutes,
      points: stats.points,
      rebounds: stats.rebounds,
      assists: stats.assists,
      steals: stats.steals,
      blocks: stats.blocks,
      turnovers: stats.turnovers,
      fouls: stats.fouls,
      fieldGoals: stats.fieldGoals,
      threes: stats.threes,
      freeThrows: stats.freeThrows,
    })),
    timingMs: Math.round(timingMs * 1000) / 1000,
    invariantFailures: 0,
  });
  const displayName = new Map<string, string>(
    players.map((player) => [player.playerId, player.displayName]),
  );
  const nameWidth = Math.max(
    6,
    ...payload.playerAverages.map((p) => (displayName.get(p.playerId) ?? p.playerId).length),
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
  const meanGames = payload.record.gamesPlayed.mean;
  const teamPoints = teamSpread(teamRows, (row) => row.points);
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
  const playerLines = payload.playerAverages.map((p) =>
    [
      padName(displayName.get(p.playerId) ?? p.playerId),
      padNum(Math.round(p.gamesPlayed.mean), 3),
      padAvg(avg(p.minutes.mean, meanGames), 5),
      padAvg(avg(p.points.mean, meanGames), 5),
      padAvg(avg(p.rebounds.total.mean, meanGames), 5),
      padAvg(avg(p.assists.mean, meanGames), 5),
      padAvg(avg(p.steals.mean, meanGames), 5),
      padAvg(avg(p.blocks.mean, meanGames), 5),
      padAvg(avg(p.turnovers.mean, meanGames), 5),
      padAvg(avg(p.fouls.mean, meanGames), 5),
      shots(Math.round(p.fieldGoals.made.mean), Math.round(p.fieldGoals.attempted.mean), 8),
      padPct(p.fieldGoals.made.mean, p.fieldGoals.attempted.mean, 6),
      shots(Math.round(p.threes.made.mean), Math.round(p.threes.attempted.mean), 7),
      padPct(p.threes.made.mean, p.threes.attempted.mean, 6),
      shots(Math.round(p.freeThrows.made.mean), Math.round(p.freeThrows.attempted.mean), 8),
      padPct(p.freeThrows.made.mean, p.freeThrows.attempted.mean, 6),
    ].join('  '),
  );
  const totals = payload.playerAverages.reduce(
    (acc, p) => {
      acc.minutes += p.minutes.mean;
      acc.points += p.points.mean;
      acc.rebounds += p.rebounds.total.mean;
      acc.assists += p.assists.mean;
      acc.steals += p.steals.mean;
      acc.blocks += p.blocks.mean;
      acc.turnovers += p.turnovers.mean;
      acc.fouls += p.fouls.mean;
      acc.fieldGoals.made += p.fieldGoals.made.mean;
      acc.fieldGoals.attempted += p.fieldGoals.attempted.mean;
      acc.threes.made += p.threes.made.mean;
      acc.threes.attempted += p.threes.attempted.mean;
      acc.freeThrows.made += p.freeThrows.made.mean;
      acc.freeThrows.attempted += p.freeThrows.attempted.mean;
      return acc;
    },
    {
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
  const totalsLine = [
    padName('Totals'),
    padNum(Math.round(meanGames), 3),
    padNum(totals.minutes.toFixed(1), 5),
    padNum(totals.points.toFixed(1), 5),
    padNum(totals.rebounds.toFixed(1), 5),
    padNum(totals.assists.toFixed(1), 5),
    padNum(totals.steals.toFixed(1), 5),
    padNum(totals.blocks.toFixed(1), 5),
    padNum(totals.turnovers.toFixed(1), 5),
    padNum(totals.fouls.toFixed(1), 5),
    shots(Math.round(totals.fieldGoals.made), Math.round(totals.fieldGoals.attempted), 8),
    padPct(totals.fieldGoals.made, totals.fieldGoals.attempted, 6),
    shots(Math.round(totals.threes.made), Math.round(totals.threes.attempted), 7),
    padPct(totals.threes.made, totals.threes.attempted, 6),
    shots(Math.round(totals.freeThrows.made), Math.round(totals.freeThrows.attempted), 8),
    padPct(totals.freeThrows.made, totals.freeThrows.attempted, 6),
  ].join('  ');
  const fmtSpread = (s: Spread) =>
    `${s.mean.toFixed(1)} ±${s.stddev.toFixed(1)} [${s.min.toFixed(1)}–${s.max.toFixed(1)}]`;
  const spreadLines = payload.playerAverages.map((p) =>
    [
      `  ${padName(displayName.get(p.playerId) ?? p.playerId)}`,
      `PTS ${fmtSpread(p.points)}`,
      `REB ${fmtSpread(p.rebounds.total)}`,
      `AST ${fmtSpread(p.assists)}`,
      `MIN ${fmtSpread(p.minutes)}`,
    ].join('  '),
  );
  const details = [
    `average of ${String(payload.attempts)} attempts · seed ${seed}`,
    `record ${payload.record.wins.mean.toFixed(1)}-${payload.record.losses.mean.toFixed(1)} (min ${payload.record.wins.min.toFixed(0)}-${payload.record.losses.min.toFixed(0)}, max ${payload.record.wins.max.toFixed(0)}-${payload.record.losses.max.toFixed(0)}) · wins sd ${payload.record.wins.stddev.toFixed(2)} · outcomes ${String(outcomes.perfect)} perfect / ${String(outcomes.eliminated)} eliminated`,
    `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · bracket ${payload.bracketVersion} · schedule ${payload.scheduleVersion} · era ${eraId} · seed ${seed}`,
    `team: ${meanGames.toFixed(1)} games · ${payload.teamPossessions.mean.toFixed(1)} possessions (sd ${payload.teamPossessions.stddev.toFixed(1)})`,
    header,
    ...playerLines,
    totalsLine,
    `spread (season totals · mean ±sd [min–max])`,
    ...spreadLines,
    `  TEAM  W ${fmtSpread(payload.record.wins)}  PTS ${fmtSpread(teamPoints)}  POSS ${fmtSpread(payload.teamPossessions)}`,
    `${timingMs.toFixed(1)} ms`,
  ];
  return makeReport('sim challenge-average', { lineup: lineupSpec, seed }, { details, payload });
}
