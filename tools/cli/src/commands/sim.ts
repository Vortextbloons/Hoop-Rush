import { readFileSync } from 'node:fs';
import {
  checkGameResult,
  createEngineContext,
  fnv1a32,
  hex32,
  simulateGame,
} from '@hoop-rush/engine';
import {
  gameSimulationInputSchema,
  seedSchema,
  type EraSimulationProfile,
  type GameResult,
  type GameSimulationInput,
} from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import { simBatchReportSchema, simGameReportSchema } from '../report-schemas.ts';
import { simFixtureSchema, type SimFixture } from '../fixture-schema.ts';
import { parseCount, UsageError } from '../args.ts';
import { loadPackagedData, PackagedData, loadProfileFile } from './data-loader.ts';
export { UsageError };
export const SIM_OPTIONS: Record<string, boolean> = {
  input: true,
  seed: true,
  'seed-from': true,
  'seed-to': true,
  samples: true,
  workers: true,
  fixture: true,
  profile: true,
  format: true,
  verbose: false,
};
const FIXTURES_DIR = new URL('../fixtures/', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/%20/g, ' ');
export function loadFixture(fixtureId: string): SimFixture {
  const path = `${FIXTURES_DIR}${fixtureId}.json`;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`fixture not found: ${fixtureId} (expected ${path})`);
  }
  const parsed = simFixtureSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new UsageError(
      `fixture ${fixtureId} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
export function listFixtureIds(): string[] {
  return [
    'equal',
    'strong-medium',
    'strong-weak',
    'sens-shooting',
    'sens-creation',
    'sens-passing',
    'sens-turnovers',
    'sens-defense',
    'sens-rebounding',
    'sens-fouls',
    'sens-pace',
    'sens-shot-mix',
  ];
}
export function fixtureSeed(fixtureId: string, index: number): string {
  return hex32(fnv1a32(`${fixtureId}-${String(index)}`)).repeat(4);
}
export function chunkRange(
  from: number,
  to: number,
  workers: number,
): Array<{
  from: number;
  to: number;
}> {
  const chunkSize = Math.ceil((to - from + 1) / workers);
  const chunks: Array<{
    from: number;
    to: number;
  }> = [];
  for (let start = from; start <= to; start += chunkSize) {
    chunks.push({ from: start, to: Math.min(to, start + chunkSize - 1) });
  }
  return chunks;
}
export function buildInput(
  fixture: SimFixture,
  profile: EraSimulationProfile,
  seed: string,
  variant: boolean,
): GameSimulationInput {
  const variantProfile =
    variant && fixture.variantParameters
      ? {
          ...profile,
          profileVersion: `${profile.profileVersion}+variant`,
          parameters: { ...profile.parameters, ...fixture.variantParameters },
        }
      : profile;
  const input: GameSimulationInput = {
    schemaVersion: 2,
    seed,
    gameNumber: 1,
    dataVersion: profile.dataVersion,
    profile: variantProfile,
    home: variant && fixture.variantHome ? fixture.variantHome : fixture.home,
    away: variant && fixture.variantAway ? fixture.variantAway : fixture.away,
  };
  return gameSimulationInputSchema.parse(input);
}
export function runSingleGame(input: GameSimulationInput): {
  result: GameResult;
  timingMs: number;
} {
  const context = createEngineContext();
  const start = performance.now();
  const result = simulateGame(input, context);
  return { result, timingMs: performance.now() - start };
}
export function simGame(args: { input?: string; seed?: string; profile?: string }): CliReport {
  const fixtureId = args.input;
  if (!fixtureId) throw new UsageError('sim game requires --input <fixture-id>');
  const seed = args.seed;
  if (seed === undefined) throw new UsageError('sim game requires --seed <hex>');
  if (!seedSchema.safeParse(seed).success)
    throw new UsageError(`--seed must be hex (got "${seed}")`);
  const fixture = loadFixture(fixtureId);
  const packaged = loadPackagedData();
  const profile = args.profile
    ? loadProfileFile(args.profile)
    : new PackagedData(packaged.manifest, packaged.dir).eraProfile();
  const input = buildInput(fixture, profile, seed, false);
  const { result, timingMs } = runSingleGame(input);
  const invariants = checkGameResult(result);
  const payload = simGameReportSchema.parse({
    schemaVersion: 1,
    command: 'sim game',
    seed,
    engineVersion: result.engineVersion,
    dataVersion: result.dataVersion,
    profileVersion: result.profileVersion,
    fixture: fixtureId,
    result: JSON.parse(JSON.stringify(result)) as unknown,
    invariants,
    timingMs: Math.round(timingMs * 1000) / 1000,
  });
  const details = [
    `${fixture.home.displayName} ${String(result.home.box.points)} - ${String(result.away.box.points)} ${fixture.away.displayName} (winner: ${result.winner}${result.overtimePeriods > 0 ? `, ${String(result.overtimePeriods)} OT` : ''})`,
    `engine ${result.engineVersion} · data ${result.dataVersion} · profile ${result.profileVersion} · seed ${seed} · ${timingMs.toFixed(2)} ms`,
    ...renderBoxLines(result),
    `facts: ${result.facts.map((f) => `${f.kind}(${f.magnitude.toFixed(2)})`).join(', ') || 'none'}`,
  ];
  return makeReport(
    'sim game',
    { fixture: fixtureId, seed, engineVersion: payload.engineVersion },
    { details, failures: invariants, payload },
  );
}
export async function simBatch(args: {
  fixture?: string;
  'seed-from'?: string;
  'seed-to'?: string;
  samples?: string;
  workers?: string;
  profile?: string;
}): Promise<CliReport> {
  const fixtureId = args.fixture ?? 'equal';
  const samples = parseCount(args.samples, '--samples', 1000);
  const seedFrom = parseCount(args['seed-from'], '--seed-from', 0);
  const seedTo = parseCount(args['seed-to'], '--seed-to', seedFrom + samples - 1);
  const workers = Math.max(1, parseCount(args.workers, '--workers', 1));
  const count = seedTo - seedFrom + 1;
  if (count < 1) throw new UsageError('--seed-to must be >= --seed-from');
  const fixture = loadFixture(fixtureId);
  const packaged = loadPackagedData();
  const profile = args.profile
    ? loadProfileFile(args.profile)
    : new PackagedData(packaged.manifest, packaged.dir).eraProfile();
  const chunks = chunkRange(seedFrom, seedTo, workers);
  const aggregate = {
    games: 0,
    homeWins: 0,
    awayWins: 0,
    overtime: 0,
    points: 0,
    possessions: 0,
    margin: 0,
    invariantFailures: 0,
  };
  await Promise.all(
    chunks.map(async (chunk) => {
      for (let i = chunk.from; i <= chunk.to; i += 1) {
        const input = buildInput(fixture, profile, fixtureSeed(fixtureId, i), false);
        const { result } = runSingleGame(input);
        aggregate.games += 1;
        if (result.winner === 'home') aggregate.homeWins += 1;
        else aggregate.awayWins += 1;
        if (result.overtimePeriods > 0) aggregate.overtime += 1;
        aggregate.points += (result.home.box.points + result.away.box.points) / 2;
        aggregate.possessions += (result.home.box.possessions + result.away.box.possessions) / 2;
        aggregate.margin += Math.abs(result.home.box.points - result.away.box.points);
        aggregate.invariantFailures += checkGameResult(result).length;
        await Promise.resolve();
      }
    }),
  );
  const payload = simBatchReportSchema.parse({
    schemaVersion: 1,
    command: 'sim batch',
    fixture: fixtureId,
    seedFrom,
    seedTo,
    workers,
    engineVersion: createEngineContext().engineVersion,
    games: aggregate.games,
    homeWins: aggregate.homeWins,
    awayWins: aggregate.awayWins,
    overtimeGames: aggregate.overtime,
    homeWinRate: aggregate.games === 0 ? 0 : aggregate.homeWins / aggregate.games,
    averagePoints: aggregate.games === 0 ? 0 : aggregate.points / aggregate.games,
    averagePossessions: aggregate.games === 0 ? 0 : aggregate.possessions / aggregate.games,
    averageMargin: aggregate.games === 0 ? 0 : aggregate.margin / aggregate.games,
    invariantFailures: aggregate.invariantFailures,
  });
  const details = [
    `fixture ${fixtureId} · ${String(aggregate.games)} games · seeds ${String(seedFrom)}..${String(seedTo)} · workers ${String(workers)}`,
    `home ${String(aggregate.homeWins)} · away ${String(aggregate.awayWins)} · OT ${String(aggregate.overtime)} · home rate ${(payload.homeWinRate * 100).toFixed(1)}%`,
    `avg points ${payload.averagePoints.toFixed(1)} · possessions ${payload.averagePossessions.toFixed(1)} · margin ${payload.averageMargin.toFixed(1)}`,
    `invariant failures ${String(aggregate.invariantFailures)}`,
  ];
  const failures = aggregate.invariantFailures > 0 ? ['invariant failures observed in batch'] : [];
  return makeReport(
    'sim batch',
    { fixture: fixtureId, seedFrom, seedTo, workers },
    { details, failures, payload },
  );
}
function renderBoxLines(result: GameResult): string[] {
  const lines: string[] = [];
  for (const side of [result.home, result.away]) {
    const b = side.box;
    lines.push(
      `${side.displayName}: ${String(b.points)} pts · ${String(b.fieldGoals.made)}/${String(b.fieldGoals.attempted)} FG · ${String(b.threes.made)}/${String(b.threes.attempted)} 3P · ${String(b.freeThrows.made)}/${String(b.freeThrows.attempted)} FT · ${String(b.rebounds.offensive)}+${String(b.rebounds.defensive)}+${String(b.rebounds.team)} REB · ${String(b.assists)} AST · ${String(b.turnovers)} TOV · ${String(b.fouls)} PF · ${String(b.possessions)} POSS`,
    );
    for (const player of side.players) {
      lines.push(
        `  ${player.playerId}: ${String(player.points)} pts · ${String(player.fieldGoals.made)}/${String(player.fieldGoals.attempted)} FG · ${String(player.rebounds.total)} REB · ${String(player.assists)} AST · ${String(player.turnovers)} TOV · ${String(player.minutes)} MIN`,
      );
    }
  }
  return lines;
}
