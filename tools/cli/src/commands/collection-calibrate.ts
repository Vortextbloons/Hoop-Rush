import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_PACK_TARGETS_VERSION,
  COLLECTION_RARITY_ORDER,
  collectionCommandSchema,
  collectionLedgerEntrySchema,
  collectionPullRecordSchema,
  collectionStateSchema,
  type CollectionCatalog,
  type CollectionCommand,
  type CollectionLedgerEntry,
  type CollectionPackDefinition,
  type CollectionPullRecord,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  applyCollectionCommand,
  auditCollectionState,
  collectionStateDigest,
  describeCollectionPackOdds,
  drawCollectionPackSlots,
  generateCollectionStarter,
  slotRarityDistribution,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { collectionPackCalibrateReportSchema } from '../report-schemas.ts';
import { validateTargetsArtifact } from '../artifact.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';

export const COLLECTION_PACK_CALIBRATE_OPTIONS: Record<string, boolean> = {
  samples: true,
  'starter-seeds': true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_COLLECTION_TARGETS = resolve(
  dirname(DEFAULT_MANIFEST),
  'collection/pack-targets.json',
);

const SIX_SIGMA = 6;
const AT_ISO = '2026-01-01T00:00:00.000Z';

function calibrationSeed(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function frequencyGate(
  key: string,
  observed: number,
  expected: number,
  samples: number,
): { pass: boolean; detail: string } {
  if (samples === 0) return { pass: false, detail: `${key}: no samples` };
  const variance = (expected * (1 - expected)) / samples;
  const allowed = SIX_SIGMA * Math.sqrt(Math.max(0, variance)) + 1 / samples;
  const gap = Math.abs(observed - expected);
  return {
    pass: gap <= allowed,
    detail: `${key}: observed ${observed.toFixed(6)} expected ${expected.toFixed(6)} allowed ±${allowed.toFixed(6)} n=${String(samples)}`,
  };
}

export const collectionPackTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(COLLECTION_PACK_TARGETS_VERSION),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  overlayVersion: z.literal(COLLECTION_OVERLAY_VERSION),
  economyVersion: z.literal(COLLECTION_ECONOMY_VERSION),
  packRulesVersion: z.literal(COLLECTION_PACK_RULES_VERSION),
  engineVersion: z.string().min(1).max(64),
  ordinarySamples: z.number().int().nonnegative(),
  starterSeeds: z.number().int().nonnegative(),
  heldOutSamples: z.number().int().nonnegative(),
  gates: z.record(z.string(), z.boolean()),
  measured: z.record(z.string(), z.number()),
});
export type CollectionPackTargets = z.infer<typeof collectionPackTargetsSchema>;

interface DrawCohort {
  ordinarySamples: number;
  guaranteeFailures: number;
  guaranteeSamples: number;
  tallies: Map<string, { observed: number; samples: number }>;
  failures: string[];
}

function runDrawCohort(
  catalog: CollectionCatalog,
  packs: CollectionPackDefinition[],
  seedOffset: number,
  ordinaryTarget: number,
  spotlightDraws: number,
): DrawCohort {
  const tallies = new Map<string, { observed: number; samples: number }>();
  let ordinarySamples = 0;
  let guaranteeFailures = 0;
  let guaranteeSamples = 0;
  const failures: string[] = [];
  let n = 0;
  while (ordinarySamples < ordinaryTarget) {
    const pack = packs[n % packs.length];
    if (pack === undefined) break;
    const rootSeed = calibrationSeed(seedOffset + n);
    const { draws } = drawCollectionPackSlots(catalog, pack, rootSeed, 0);
    for (const [slotIndex, draw] of draws.entries()) {
      const slot = pack.slots[slotIndex];
      if (slot === undefined) continue;
      if (slot.kind !== 'ordinary') {
        guaranteeSamples += 1;
        continue;
      }
      ordinarySamples += 1;
      for (const rarity of COLLECTION_RARITY_ORDER) {
        const key = `${pack.packId}/${String(slotIndex)}/${rarity}`;
        const entry = tallies.get(key) ?? { observed: 0, samples: 0 };
        entry.samples += 1;
        if (rarity === draw.rarity) entry.observed += 1;
        tallies.set(key, entry);
      }
    }
    n += 1;
    if (n > ordinaryTarget * 2 + 1000) break;
  }
  const spotlight = catalog.packs.find((entry) => entry.packId === 'spotlight');
  if (spotlight !== undefined) {
    for (let i = 0; i < spotlightDraws; i += 1) {
      const { draws } = drawCollectionPackSlots(
        catalog,
        spotlight,
        calibrationSeed(seedOffset + 1_000_000 + i),
        0,
      );
      for (const draw of draws) {
        guaranteeSamples += 1;
        const floorIndex = COLLECTION_RARITY_ORDER.indexOf('Apex');
        if (COLLECTION_RARITY_ORDER.indexOf(draw.rarity) < floorIndex) {
          guaranteeFailures += 1;
          failures.push(`spotlight drew ${draw.rarity} below Apex`);
        }
      }
    }
  }
  return { ordinarySamples, guaranteeFailures, guaranteeSamples, tallies, failures };
}

function gateCohortFrequencies(
  catalog: CollectionCatalog,
  packs: CollectionPackDefinition[],
  cohort: DrawCohort,
  label: string,
  guaranteePacks: CollectionPackDefinition[],
): { gates: Record<string, boolean>; details: string[]; failures: string[] } {
  const gates: Record<string, boolean> = {};
  const details: string[] = [];
  const failures: string[] = [...cohort.failures];
  for (const pack of packs) {
    for (const [slotIndex, slot] of pack.slots.entries()) {
      if (slot.kind !== 'ordinary') continue;
      const distribution = slotRarityDistribution(pack, slotIndex, catalog);
      for (const rarity of COLLECTION_RARITY_ORDER) {
        const key = `${pack.packId}/${String(slotIndex)}/${rarity}`;
        const tally = cohort.tallies.get(key);
        if (tally === undefined || tally.samples === 0) continue;
        const gate = frequencyGate(
          `${label} ${key}`,
          tally.observed / tally.samples,
          distribution[rarity],
          tally.samples,
        );
        gates[`${label}:${key}`] = gate.pass;
        details.push(gate.detail);
        if (!gate.pass) failures.push(gate.detail);
      }
    }
  }
  let guaranteeFailures = cohort.guaranteeFailures;
  let guaranteeSamples = cohort.guaranteeSamples;
  for (const pack of guaranteePacks) {
    for (const [slotIndex, slot] of pack.slots.entries()) {
      if (slot.kind !== 'guaranteed') continue;
      const floor = slot.floorRarity ?? 'Ember';
      const floorIndex = COLLECTION_RARITY_ORDER.indexOf(floor);
      for (let i = 0; i < 200; i += 1) {
        const { draws } = drawCollectionPackSlots(
          catalog,
          pack,
          calibrationSeed(9_000_000 + slotIndex * 1000 + i),
          0,
        );
        const draw = draws[slotIndex];
        guaranteeSamples += 1;
        if (draw === undefined || COLLECTION_RARITY_ORDER.indexOf(draw.rarity) < floorIndex) {
          guaranteeFailures += 1;
          failures.push(`${label} guarantee violated: ${pack.packId} slot ${String(slotIndex)}`);
        }
      }
    }
  }
  const guaranteeGate = guaranteeFailures === 0 && guaranteeSamples > 0;
  gates[`${label}:guarantees`] = guaranteeGate;
  details.push(
    `${label}: guarantees ${String(guaranteeSamples - guaranteeFailures)}/${String(guaranteeSamples)} exact`,
  );
  if (!guaranteeGate) failures.push(`${label}: guarantee failures present`);
  return { gates, details, failures };
}

function runStarterCohort(
  catalog: CollectionCatalog,
  seeds: number,
  offset: number,
): { failures: number; samples: number } {
  let failures = 0;
  for (let i = 0; i < seeds; i += 1) {
    try {
      const starter = generateCollectionStarter(catalog, calibrationSeed(offset + i));
      if (starter.cardIds.length !== 5 || new Set(starter.cardIds).size !== 5) failures += 1;
    } catch {
      failures += 1;
    }
  }
  return { failures, samples: seeds };
}

const GRANT_STRATEGIES: Array<{
  name: string;
  packs: Array<'tip-off' | 'fast-break' | 'full-court' | 'main-event'>;
}> = [
  { name: 'all-tip-off', packs: Array.from({ length: 30 }, () => 'tip-off' as const) },
  { name: 'all-fast-break', packs: Array.from({ length: 10 }, () => 'fast-break' as const) },
  { name: 'all-full-court', packs: Array.from({ length: 6 }, () => 'full-court' as const) },
  { name: 'all-main-event', packs: Array.from({ length: 3 }, () => 'main-event' as const) },
];

const OWNERSHIP_SCENARIOS = [0, 0.25, 0.75, 1] as const;

function genesisRecords(
  catalog: CollectionCatalog,
  catalogHash: string,
  rootSeed: string,
  ownedIds: ReadonlySet<string>,
): {
  state: CollectionState;
  pulls: CollectionPullRecord[];
  ledger: CollectionLedgerEntry[];
  commands: CollectionCommand[];
} {
  const sorted = [...ownedIds].sort();
  const pulls: CollectionPullRecord[] = [];
  const owned: CollectionState['owned'] = [];
  const CHUNK = 10;
  for (let chunk = 0; chunk * CHUNK < sorted.length; chunk += 1) {
    const members = sorted.slice(chunk * CHUNK, chunk * CHUNK + CHUNK);
    const slots = members.map((cardId, slotIndex) => {
      const card = catalog.cards.find((entry) => entry.cardId === cardId);
      if (card === undefined) throw new Error(`genesis references unknown ${cardId}`);
      owned.push({
        cardId: card.cardId,
        acquiredPullSequence: chunk,
        acquiredSlotIndex: slotIndex,
        acquiredAtIso: AT_ISO,
      });
      return {
        slotIndex,
        cardId: card.cardId,
        rarity: card.rarity,
        kept: true,
        conversionAmount: 0,
      };
    });
    pulls.push(
      collectionPullRecordSchema.parse({
        pullSequence: chunk,
        kind: 'pack',
        packId: 'tip-off',
        packRulesVersion: COLLECTION_PACK_RULES_VERSION,
        economyVersion: 'collection-economy-v1',
        catalogVersion: 'collection-catalog-v1',
        catalogHash,
        commandId: 'calibration-genesis',
        seedPath: ['collection', 'calibration', 'genesis', String(chunk)],
        slots,
      }),
    );
  }
  const grant = collectionLedgerEntrySchema.parse({
    transactionId: `txn-${'0'.repeat(32)}`,
    commandId: 'calibration-genesis',
    pullSequence: 0,
    currency: 'Coins',
    amount: 3000,
    reason: 'welcome-grant',
  });
  const chunks = pulls.length;
  const state = collectionStateSchema.parse({
    schemaVersion: 1,
    collectionVersion: 'collection-v1',
    catalogVersion: 'collection-catalog-v1',
    economyVersion: 'collection-economy-v1',
    collectionId: 'calibration',
    rootSeed,
    revision: chunks,
    digest: '0'.repeat(32),
    claimedWelcome: true,
    owned,
    balances: { Coins: 3000, Exchange: 0 },
    nextPullSequence: chunks,
  });
  const digest = collectionStateDigest({
    collectionId: state.collectionId,
    revision: state.revision,
    claimedWelcome: state.claimedWelcome,
    ownedCardIds: state.owned.map((entry) => entry.cardId),
    balances: state.balances,
    nextPullSequence: state.nextPullSequence,
    catalogVersion: state.catalogVersion,
    economyVersion: state.economyVersion,
  });
  return { state: { ...state, digest }, pulls, ledger: [grant], commands: [] };
}

function runOwnershipCohort(
  catalog: CollectionCatalog,
  catalogHash: string,
  scenarioSeeds: number,
): {
  details: string[];
  failures: string[];
  measured: Record<string, number>;
  gates: Record<string, boolean>;
} {
  const details: string[] = [];
  const failures: string[] = [];
  const measured: Record<string, number> = {};
  const gates: Record<string, boolean> = {};
  const sortedIds = catalog.cards.map((card) => card.cardId).sort();
  OWNERSHIP_SCENARIOS.forEach((share, shareIndex) => {
    const ownedCount = Math.floor(sortedIds.length * share);
    GRANT_STRATEGIES.forEach((strategy, strategyIndex) => {
      let newCards = 0;
      let duplicates = 0;
      let exchange = 0;
      let divergence = 0;
      let accepted = 0;
      let attempts = 0;
      for (let s = 0; s < scenarioSeeds; s += 1) {
        const rootSeed = calibrationSeed(
          2_000_000 + shareIndex * 100_000 + strategyIndex * 10_000 + s,
        );
        const starter = generateCollectionStarter(catalog, rootSeed);
        const ownedIds = new Set(sortedIds.slice(0, ownedCount));
        for (const cardId of starter.cardIds) ownedIds.add(cardId);
        const genesis = genesisRecords(catalog, catalogHash, rootSeed, ownedIds);
        let state = genesis.state;
        const pulls = [...genesis.pulls];
        const ledger = [...genesis.ledger];
        const commands = [...genesis.commands];
        for (const [packIndex, packId] of strategy.packs.entries()) {
          attempts += 1;
          const command = collectionCommandSchema.parse({
            schemaVersion: 1,
            commandVersion: 'collection-command-v1',
            commandId: `cal-${String(shareIndex)}-${strategy.name}-${String(s)}-${String(packIndex)}`,
            collectionId: 'calibration',
            expectedRevision: state.revision,
            expectedDigest: state.digest,
            command: 'open-pack',
            packId,
            acquiredAtIso: AT_ISO,
          });
          const outcome = applyCollectionCommand(
            state,
            command,
            catalog,
            pulls,
            ledger,
            commands,
            catalogHash,
          );
          if (outcome.status !== 'accepted') {
            failures.push(`ownership ${String(share)}/${strategy.name}: ${outcome.rejection.code}`);
            break;
          }
          accepted += 1;
          for (const slot of outcome.pull.slots) {
            if (slot.kept) newCards += 1;
            else duplicates += 1;
          }
          exchange += outcome.ledgerEntries
            .filter((entry) => entry.reason === 'duplicate-conversion')
            .reduce((sum, entry) => sum + entry.amount, 0);
          state = outcome.state;
          pulls.push(outcome.pull);
          ledger.push(...outcome.ledgerEntries);
          commands.push(command);
        }
        divergence += auditCollectionState(state, pulls, ledger).length;
      }
      const runs = scenarioSeeds;
      const prefix = `ownership/${String(share)}/${strategy.name}`;
      measured[`${prefix}/new-per-run`] = newCards / runs;
      measured[`${prefix}/duplicates-per-run`] = duplicates / runs;
      measured[`${prefix}/exchange-per-run`] = exchange / runs;
      details.push(
        `${prefix}: ${(newCards / runs).toFixed(1)} new, ${(duplicates / runs).toFixed(1)} dupes, ${(exchange / runs).toFixed(1)} Exchange per grant`,
      );
      gates[`${prefix}:no-divergence`] = divergence === 0;
      if (divergence !== 0)
        failures.push(`${prefix}: ${String(divergence)} accounting divergences`);
      gates[`${prefix}:all-accepted`] = accepted === attempts;
    });
  });
  return { details, failures, measured, gates };
}

function writeTargetsArtifact(outPath: string, manifestPath: string, content: unknown): void {
  const target = resolve(outPath);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`);
  renameSync(tmp, target);
  if (resolve(outPath) === resolve(DEFAULT_COLLECTION_TARGETS)) {
    const manifest = readJsonFile(manifestPath) as {
      collection?: Record<string, { url?: string; contentHash?: string }>;
    };
    if (manifest.collection !== undefined) {
      manifest.collection.packTargets = {
        url: 'collection/pack-targets.json',
        contentHash: sha256Hex(JSON.stringify(content)),
      };
      const manifestTarget = resolve(manifestPath);
      const manifestTmp = `${manifestTarget}.tmp-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
      writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
      renameSync(manifestTmp, manifestTarget);
    }
  }
}

export function collectionPackCalibrate(args: {
  samples?: string;
  starterSeeds?: string;
  out?: string;
  manifest?: string;
  validate?: string | null;
}): CliReport {
  if (typeof args.validate === 'string') {
    return validateTargetsArtifact({
      outPath: args.validate,
      schema: collectionPackTargetsSchema,
      command: 'collection pack-calibrate',
      extraChecks: (parsed) => {
        const details: string[] = [];
        const failures: string[] = [];
        const targetsVersion: string = parsed.targetsVersion;
        if (targetsVersion !== COLLECTION_PACK_TARGETS_VERSION) {
          failures.push(`targetsVersion ${targetsVersion} != ${COLLECTION_PACK_TARGETS_VERSION}`);
        } else {
          details.push(`targetsVersion ${targetsVersion} verified`);
        }
        return { details, failures };
      },
    });
  }
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection pack-calibrate',
      {},
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { catalog, catalogHash } = loaded;
  const ordinaryTarget = Math.max(
    1_000_000,
    Number.parseInt(args.samples ?? '1000000', 10) || 1_000_000,
  );
  const starterSeedCount = Math.max(
    10_000,
    Number.parseInt(args.starterSeeds ?? '10000', 10) || 10_000,
  );
  const startedAt = Date.now();
  const coinPacks = catalog.packs.filter((pack) => pack.priceCurrency === 'Coins');
  const cohort = runDrawCohort(catalog, coinPacks, 0, ordinaryTarget, 10_000);
  const heldOut = runDrawCohort(catalog, coinPacks, 5_000_000, 100_000, 1_000);
  const guaranteePacks = catalog.packs.filter((pack) =>
    pack.slots.some((slot) => slot.kind === 'guaranteed'),
  );
  const gated = gateCohortFrequencies(catalog, coinPacks, cohort, 'calibration', guaranteePacks);
  const heldGated = gateCohortFrequencies(catalog, coinPacks, heldOut, 'held-out', guaranteePacks);
  const starters = runStarterCohort(catalog, starterSeedCount, 10_000_000);
  const ownership = runOwnershipCohort(catalog, catalogHash, 25);
  const gates: Record<string, boolean> = {
    ...gated.gates,
    ...heldGated.gates,
    ...ownership.gates,
    'starter:no-failures': starters.failures === 0,
  };
  const details = [...gated.details, ...heldGated.details, ...ownership.details];
  details.push(
    `starters: ${String(starters.samples - starters.failures)}/${String(starters.samples)} legal across seeds`,
  );
  const failures = [...gated.failures, ...heldGated.failures, ...ownership.failures];
  if (starters.failures !== 0) failures.push(`starters: ${String(starters.failures)} failures`);
  const measured: Record<string, number> = {
    ...ownership.measured,
    ordinarySamples: cohort.ordinarySamples,
    guaranteeSamples: cohort.guaranteeSamples,
    starterSamples: starters.samples,
    starterFailures: starters.failures,
    heldOutSamples: heldOut.ordinarySamples,
  };
  for (const pack of catalog.packs) {
    const odds = describeCollectionPackOdds(catalog, pack);
    let expected = 0;
    for (const slot of odds.perSlot) {
      for (const rarity of COLLECTION_RARITY_ORDER) {
        expected += slot.distribution[rarity] * pack.duplicateExchange[rarity];
      }
    }
    measured[`${pack.packId}/expected-exchange-full-duplicate`] = expected;
  }
  const outPath = args.out ?? DEFAULT_COLLECTION_TARGETS;
  const content = collectionPackTargetsSchema.parse({
    schemaVersion: 1,
    targetsVersion: COLLECTION_PACK_TARGETS_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    packRulesVersion: COLLECTION_PACK_RULES_VERSION,
    engineVersion: ENGINE_VERSION,
    ordinarySamples: cohort.ordinarySamples,
    starterSeeds: starters.samples,
    heldOutSamples: heldOut.ordinarySamples,
    gates,
    measured,
  });
  try {
    writeTargetsArtifact(outPath, manifestPath, content);
  } catch (error) {
    failures.push(`cannot write targets: ${(error as Error).message}`);
  }
  const payload = collectionPackCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'collection pack-calibrate',
    ordinarySamples: cohort.ordinarySamples,
    starterSeeds: starters.samples,
    heldOutSamples: heldOut.ordinarySamples,
    gates,
    targetsWritten: failures.length === 0,
    targetsPath: outPath,
    durationMs: Date.now() - startedAt,
  });
  return makeReport(
    'collection pack-calibrate',
    { manifest: manifestPath },
    {
      details,
      failures,
      payload,
    },
  );
}
