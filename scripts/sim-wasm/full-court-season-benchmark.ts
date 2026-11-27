import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import {
  FULL_COURT_DEFAULT_MONEY,
  canonicalJson,
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtHealthProfileSetSchema,
  idSchema,
  seasonDraftCatalogIdentityHash,
  seasonDigestHex,
  seedSchema,
  type SeasonDraftCatalog,
} from '../../packages/data-contracts/src/index.ts';
import {
  applyFullCourtCommand,
  buildFullCourtRegularSeason,
  capRushLeagueFieldOf,
  createEngineContext,
  createFullCourtDraftState,
  createFullCourtSeasonCheckpoint,
  fullCourtDraftIndexOf,
  lockFullCourtRegularSeason,
  simulateFullCourtSeasonSlot,
  type FullCourtSeasonLock,
} from '../../packages/engine/src/index.ts';
import {
  loadPackagedData,
  PackagedData,
  REPO_ROOT,
} from '../../tools/cli/src/commands/data-loader.ts';

/**
 * Warm, reproducible Full Court regular-season benchmark on the packaged
 * historical catalog with injury profiles enabled.
 *
 * Scope: desktop Bun, one worker-shaped engine task per slot, including the
 * locked-season fixture lookups, health preparation, game simulation,
 * accounting, compact score parsing, and checkpoint construction. It excludes
 * browser worker structured cloning, IndexedDB commits, and UI publication, so
 * the numbers are not desktop or mobile browser measurements.
 */

interface BenchmarkSample {
  readonly totalMs: number;
  readonly slotMs: readonly number[];
  readonly forfeits: number;
}

interface SizeReport {
  readonly players: number;
  readonly samples: number;
  readonly averageForfeits: number;
  readonly medianSlotMs: number;
  readonly p95SlotMs: number;
  readonly maxSlotMs: number;
  readonly medianTotalMs: number;
  readonly seasonDigest: string;
}

function assetSetup() {
  const { manifest, dir } = loadPackagedData();
  const data = new PackagedData(manifest, dir);
  const catalog = data.draftCatalogWithPlayoffs();
  const profile = data.eraProfile();
  const field = capRushLeagueFieldOf(data.bracket());
  const catalogEntry = manifest.draftCatalog;
  const healthEntry = manifest.fullCourtHealthProfiles;
  if (catalogEntry === undefined || healthEntry === undefined) {
    throw new Error('The packaged Full Court benchmark assets are incomplete');
  }
  const catalogSource = {
    catalogVersion: catalog.catalogVersion,
    catalogHash: seasonDraftCatalogIdentityHash(catalogEntry),
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
  const index = fullCourtDraftIndexOf(catalog as SeasonDraftCatalog, catalogSource);
  const profiles = fullCourtHealthProfileSetSchema.parse(
    JSON.parse(readFileSync(resolve(dir, healthEntry.url), 'utf8')) as unknown,
  );
  return {
    catalog,
    profile,
    field,
    catalogSource,
    index,
    profiles,
    catalogAssetHash: catalogEntry.contentHash,
  };
}

type Assets = ReturnType<typeof assetSetup>;

function buildSeason(assets: Assets, players: number): FullCourtSeasonLock {
  const seedTag = `full-court-season-benchmark-v1:${String(players)}`;
  const runSeed = seedSchema.parse(seasonDigestHex(seedTag));
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse(`bench-create-${String(players)}`),
      runId: idSchema.parse(`bench-full-court-${String(players)}`),
      runSeed,
      variant: 'standard',
      catalog: assets.catalogSource,
      money: FULL_COURT_DEFAULT_MONEY,
    }),
    assets.index,
  );
  const candidates = [...assets.catalog.candidates].sort(
    (left, right) =>
      left.summaryRatings.overallRating - right.summaryRatings.overallRating ||
      left.playerVersionId.localeCompare(right.playerVersionId),
  );
  let picked = 0;
  for (const candidate of candidates) {
    if (picked >= players) break;
    const applied = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`bench-pick-${String(picked)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index: assets.index },
    );
    if (applied.result.status !== 'accepted') continue;
    draft = applied.state;
    picked += 1;
  }
  if (picked !== players) {
    throw new Error(`Full Court benchmark drafted ${String(picked)}/${String(players)} players`);
  }
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('bench-finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index: assets.index },
  ).state;
  return lockFullCourtRegularSeason(
    buildFullCourtRegularSeason({
      draft,
      field: assets.field,
      catalog: assets.catalog,
      profile: assets.profile,
      catalogSource: assets.catalogSource,
    }),
    { profiles: assets.profiles, catalogAssetHash: assets.catalogAssetHash },
  );
}

function runSeason(lock: FullCourtSeasonLock): {
  sample: BenchmarkSample;
  scores: readonly string[];
} {
  const context = createEngineContext();
  let checkpoint = createFullCourtSeasonCheckpoint(lock);
  const slotMs: number[] = [];
  const scores: string[] = [];
  let forfeits = 0;
  const started = performance.now();
  for (let slot = 1; slot <= 82; slot += 1) {
    const slotStart = performance.now();
    const outcome = simulateFullCourtSeasonSlot(lock, checkpoint, context, {
      acceptForfeit: true,
    });
    if (outcome.kind !== 'simulated') {
      throw new Error(`Full Court benchmark slot ${String(slot)} returned ${outcome.kind}`);
    }
    slotMs.push(performance.now() - slotStart);
    if (outcome.userGame.kind === 'forfeit') forfeits += 1;
    for (const score of outcome.scores) {
      scores.push(
        `${score.gameId}:${score.outcome.kind}:${
          score.outcome.kind === 'played'
            ? `${String(score.outcome.homePoints)}-${String(score.outcome.awayPoints)}`
            : score.outcome.losingSides.join(',')
        }`,
      );
    }
    checkpoint = outcome.checkpoint;
  }
  return { sample: { totalMs: performance.now() - started, slotMs, forfeits }, scores };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function round(value: number): number {
  return Math.round(value);
}

function benchmark(assets: Assets, players: number, samples: number): SizeReport {
  const lock = buildSeason(assets, players);
  runSeason(lock);
  const measured: BenchmarkSample[] = [];
  let seasonDigest = '';
  for (let sample = 0; sample < samples; sample += 1) {
    const result = runSeason(lock);
    measured.push(result.sample);
    seasonDigest = seasonDigestHex(canonicalJson(result.scores));
  }
  const slotMs = measured.flatMap((sample) => sample.slotMs);
  return {
    players,
    samples,
    averageForfeits:
      measured.reduce((total, sample) => total + sample.forfeits, 0) / measured.length,
    medianSlotMs: round(median(slotMs)),
    p95SlotMs: round(percentile(slotMs, 0.95)),
    maxSlotMs: round(Math.max(...slotMs)),
    medianTotalMs: round(median(measured.map((sample) => sample.totalMs))),
    seasonDigest,
  };
}

const samples = Number(process.env.HOOP_BENCH_SAMPLES ?? 3);
if (!Number.isInteger(samples) || samples < 1) {
  throw new Error('HOOP_BENCH_SAMPLES must be an integer >= 1');
}
const assets = assetSetup();
const sizes = (process.env.HOOP_BENCH_SIZES ?? '6,12')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
if (sizes.length === 0) throw new Error('HOOP_BENCH_SIZES must list positive roster sizes');
const reports = sizes.map((players) => benchmark(assets, players, samples));
const report = {
  note: [
    'Warm 82-slot, 1,230-fixture Full Court regular season on the packaged historical catalog.',
    'Injury profiles are enabled and batch forfeits are auto-accepted.',
    'Each sample starts from an empty checkpoint after one untimed warm season.',
    'Includes locked-season fixture lookups, health preparation, simulation, accounting, compact score parsing, and checkpoint construction.',
    'Excludes browser worker structured cloning, IndexedDB writes, UI publication, and browser or mobile execution.',
  ].join(' '),
  capturedAt: new Date().toISOString(),
  bun: Bun.version,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model ?? 'unknown',
  repoRoot: REPO_ROOT,
  sizes: reports,
};
console.log(JSON.stringify(report, null, 2));
