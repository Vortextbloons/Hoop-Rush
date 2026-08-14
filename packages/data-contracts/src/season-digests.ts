import { z } from 'zod';

export const seasonCheckpointDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonCheckpointDigest = z.infer<typeof seasonCheckpointDigestSchema>;

export const seasonRotationSetDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export type SeasonRotationSetDigest = z.infer<typeof seasonRotationSetDigestSchema>;
