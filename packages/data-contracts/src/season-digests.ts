import { z } from 'zod';
const hex32Digest = z.string().regex(/^[0-9a-f]{32}$/);
export const seasonCheckpointDigestSchema = hex32Digest;
export type SeasonCheckpointDigest = z.infer<typeof seasonCheckpointDigestSchema>;
export const seasonRotationSetDigestSchema = hex32Digest;
export type SeasonRotationSetDigest = z.infer<typeof seasonRotationSetDigestSchema>;
