import { z } from 'zod';

/**
 * Stable identity strings for every entity in the Hoop Rush domain.
 * IDs are opaque, lowercase, URL-safe strings. They never encode display
 * meaning; lineage, names, and labels come from validated data records.
 * Distinct type aliases document intent; the schemas enforce shape at runtime.
 */

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

/** The base id shape every opaque lowercase URL-safe id reuses. */
export const idSchema = id;
export type Id = z.infer<typeof idSchema>;

/** Stable typed command id (system-generated or human); same base shape. */
export const commandIdSchema = id;
export type CommandId = z.infer<typeof commandIdSchema>;

/** Stable game id from the committed Season Run schedule artifact, e.g. "s000042". */
export const seasonGameIdSchema = z.string().regex(/^s[0-9]{6}$/);
export type SeasonGameId = z.infer<typeof seasonGameIdSchema>;

export const playerIdSchema = id;
export type PlayerId = z.infer<typeof playerIdSchema>;

export const franchiseIdSchema = id;
export type FranchiseId = z.infer<typeof franchiseIdSchema>;

export const eraIdSchema = id;
export type EraId = z.infer<typeof eraIdSchema>;

/** NBA season key in "2024-25" style, including the 1998-99 and 2011-12 shortened seasons. */
export const seasonKeySchema = z.string().regex(/^(19|20)\d{2}-\d{2}$/);
export type SeasonKey = z.infer<typeof seasonKeySchema>;

/** Stable external NBA player ID as published by the source API. */
export const playerExternalIdSchema = z.string().regex(/^\d{1,12}$/);
export type PlayerExternalId = z.infer<typeof playerExternalIdSchema>;

/** Stable external NBA team ID as published by the source API. */
export const teamExternalIdSchema = z.string().regex(/^\d{1,12}$/);
export type TeamExternalId = z.infer<typeof teamExternalIdSchema>;

/** Basketball-Reference player ID (e.g. "jordami01"), used for fallback headshots. */
export const bbrefIdSchema = z.string().regex(/^[a-z0-9]{6,12}$/);
export type BbrefId = z.infer<typeof bbrefIdSchema>;

/** Hex-encoded run seed. Derived game seeds come from this value. */
export const seedSchema = z.string().regex(/^[0-9a-f]{16,64}$/);
export type Seed = z.infer<typeof seedSchema>;

/** Hex-encoded SHA-256 content hash used by manifest pool references. */
export const contentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export type ContentHash = z.infer<typeof contentHashSchema>;
