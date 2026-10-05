import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  collectionCatalogSchema,
  collectionPullRecordSchema,
  seedSchema,
  type CollectionCatalog,
  type CollectionPackDefinition,
  type CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  describeCollectionPackOdds,
  reproduceCollectionPull,
  validateCollectionPackDef,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import {
  collectionPackAuditReportSchema,
  collectionPullReproduceReportSchema,
} from '../report-schemas.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';

export const COLLECTION_PACK_AUDIT_OPTIONS: Record<string, boolean> = {
  manifest: true,
  format: true,
};

export const COLLECTION_PULL_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

export function loadCollectionCatalog(
  manifestPath: string = DEFAULT_MANIFEST,
  catalogPath?: string,
): { catalog: CollectionCatalog; catalogHash: string } {
  const manifest = readJsonFile(manifestPath) as {
    collection?: {
      catalog?: { url?: string; contentHash?: string };
    };
  };
  const ref = manifest.collection?.catalog;
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error('manifest is missing collection.catalog; run gen-collection-catalog first');
  }
  const resolved = catalogPath ?? resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `collection catalog content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = collectionCatalogSchema.safeParse(JSON.parse(content.toString('utf8')) as unknown);
  if (!parsed.success) {
    throw new Error(
      `collection catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { catalog: parsed.data, catalogHash: actual };
}

function expectedFullDuplicateExchange(
  pack: CollectionPackDefinition,
  odds: ReturnType<typeof describeCollectionPackOdds>,
): number {
  let total = 0;
  for (const slot of odds.perSlot) {
    for (const rarity of COLLECTION_RARITY_ORDER) {
      total += slot.distribution[rarity] * pack.duplicateExchange[rarity];
    }
  }
  return total;
}

function maxDuplicatePayout(pack: CollectionPackDefinition, catalog: CollectionCatalog): number {
  const eligible = catalog.cards.filter((card) =>
    pack.eligibleScope === 'specials-only' ? card.family !== 'Base' : true,
  );
  const bySlot = pack.slots.map((slot) => {
    const floor = slot.kind === 'guaranteed' ? (slot.floorRarity ?? 'Ember') : 'Ember';
    const floorIndex = COLLECTION_RARITY_ORDER.indexOf(floor);
    let best = 0;
    for (const card of eligible) {
      if (COLLECTION_RARITY_ORDER.indexOf(card.rarity) < floorIndex) continue;
      best = Math.max(best, pack.duplicateExchange[card.rarity]);
    }
    return best;
  });
  return bySlot.reduce((sum, value) => sum + value, 0);
}

export function collectionPackAudit(args: { manifest: string | null }): CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection pack-audit',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { catalog, catalogHash } = loaded;
  const failures: string[] = [];
  const details: string[] = [];
  const packs: Array<{
    packId: string;
    priceCurrency: string;
    priceAmount: number;
    cardCount: number;
    atLeastOne: Record<CollectionRarity, number>;
    expectedExchangeFullDuplicate: number;
    maxDuplicatePayout: number;
  }> = [];
  for (const pack of catalog.packs) {
    try {
      validateCollectionPackDef(pack, catalog);
    } catch (error) {
      failures.push(`pack ${pack.packId}: ${(error as Error).message}`);
      continue;
    }
    const odds = describeCollectionPackOdds(catalog, pack);
    const expected = expectedFullDuplicateExchange(pack, odds);
    const max = maxDuplicatePayout(pack, catalog);
    packs.push({
      packId: pack.packId,
      priceCurrency: pack.priceCurrency,
      priceAmount: pack.priceAmount,
      cardCount: pack.slots.length,
      atLeastOne: odds.atLeastOne,
      expectedExchangeFullDuplicate: expected,
      maxDuplicatePayout: max,
    });
    details.push(
      `pack ${pack.packId}: ${String(pack.slots.length)} cards for ${String(pack.priceAmount)} ${pack.priceCurrency} · full-duplicate expected Exchange ${expected.toFixed(2)} · max payout ${String(max)}`,
    );
    if (pack.packId === 'spotlight' && max >= pack.priceAmount) {
      failures.push(
        `pack spotlight: fully-duplicate max payout ${String(max)} must stay below price ${String(pack.priceAmount)}`,
      );
    }
  }
  const payload = collectionPackAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'collection pack-audit',
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    economyVersion: COLLECTION_ECONOMY_VERSION,
    packRulesVersion: COLLECTION_PACK_RULES_VERSION,
    packs,
  });
  return makeReport(
    'collection pack-audit',
    { manifest: manifestPath },
    {
      details,
      failures,
      payload,
    },
  );
}

export const collectionPullReproduceInputSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection pull-reproduce'),
  rootSeed: seedSchema,
  pull: collectionPullRecordSchema,
});
export type CollectionPullReproduceInput = z.infer<typeof collectionPullReproduceInputSchema>;

export function collectionPullReproduce(args: {
  input: string | null;
  manifest: string | null;
}): CliReport {
  if (args.input === null) {
    return makeReport(
      'collection pull-reproduce',
      {},
      {
        failures: ['collection pull-reproduce requires --input <pull.json>'],
        exitCode: 2,
      },
    );
  }
  const parsedInput = collectionPullReproduceInputSchema.safeParse(readJsonFile(args.input));
  if (!parsedInput.success) {
    return makeReport(
      'collection pull-reproduce',
      { input: args.input },
      {
        failures: [
          `pull input fails the schema: ${parsedInput.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection pull-reproduce',
      { input: args.input },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { pull, rootSeed } = parsedInput.data;
  const { ok, failures } = reproduceCollectionPull(loaded.catalog, pull, rootSeed);
  const payload = collectionPullReproduceReportSchema.parse({
    schemaVersion: 1,
    command: 'collection pull-reproduce',
    pullSequence: pull.pullSequence,
    kind: pull.kind,
    ok,
    failures,
  });
  return makeReport(
    'collection pull-reproduce',
    { input: args.input },
    {
      details: ok ? [`pull ${String(pull.pullSequence)} reproduces byte-identically`] : [],
      failures,
      payload,
    },
  );
}
