import type { ContentHash } from '@hoop-rush/data-contracts';
import { contentHashSchema, seasonDigestHex } from '@hoop-rush/data-contracts';

export function gameDigest64(namespace: string, material: string): ContentHash {
  return contentHashSchema.parse(
    `${seasonDigestHex(`${namespace}-v1:${material}`)}${seasonDigestHex(`${namespace}-v2:${material}`)}`,
  );
}
