import { seedSchema } from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import {
  COLLECTION_SEED_DERIVATION_VERSION,
  COLLECTION_SEED_NAMESPACES,
  type CollectionSeedNamespace,
} from '@hoop-rush/data-contracts';

export { COLLECTION_SEED_NAMESPACES, type CollectionSeedNamespace };

export function collectionNamespaceSeed(
  rootSeed: string,
  namespace: CollectionSeedNamespace,
  ...keys: string[]
): string {
  const separator = String.fromCharCode(0);
  return seedSchema.parse(
    seasonDigestHex(
      [
        COLLECTION_SEED_DERIVATION_VERSION,
        rootSeed,
        COLLECTION_SEED_NAMESPACES[namespace],
        ...keys.map((key) => key.replaceAll(separator, '')),
      ].join(separator),
    ),
  );
}

export function collectionStarterSeed(rootSeed: string): string {
  return collectionNamespaceSeed(rootSeed, 'starter');
}

export function collectionPullSeed(
  rootSeed: string,
  packId: string,
  packRulesVersion: string,
  pullSequence: number,
): string {
  return collectionNamespaceSeed(rootSeed, 'pulls', packId, packRulesVersion, String(pullSequence));
}
