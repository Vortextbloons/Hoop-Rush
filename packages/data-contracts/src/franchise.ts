import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema, teamExternalIdSchema } from './ids.js';

/**
 * Franchise lineage is the authoritative identity spine. One franchiseId spans
 * relocations and renames (e.g. Minneapolis Lakers -> Los Angeles Lakers) and
 * is separate from display names and logos.
 */

export const franchiseNameSchema = z.object({
  name: z.string().min(1).max(64),
  fromSeasonKey: seasonKeySchema.nullable(),
  toSeasonKey: seasonKeySchema.nullable(),
});
export type FranchiseName = z.infer<typeof franchiseNameSchema>;

export const franchiseLineageEntrySchema = z.object({
  franchiseId: franchiseIdSchema,
  /** Current display name for the franchise. */
  displayName: z.string().min(1).max(64),
  /** NBA API team ID used to resolve logos and external records. */
  teamExternalId: teamExternalIdSchema,
  /** First NBA season of this franchise; earlier eras are unavailable. */
  firstNbaSeasonKey: seasonKeySchema.optional(),
  /** Known franchise identity history, oldest first. Ranges may leave gaps. */
  names: z.array(franchiseNameSchema).min(1),
});
export type FranchiseLineageEntry = z.infer<typeof franchiseLineageEntrySchema>;

export const franchiseLineageSchema = z.array(franchiseLineageEntrySchema);
export type FranchiseLineage = z.infer<typeof franchiseLineageSchema>;

/**
 * Standard three-letter NBA abbreviations for the current franchise IDs.
 * These are presentation labels; franchiseId remains the identity used by
 * data, persistence, and simulation contracts.
 */
const FRANCHISE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  hawks: 'ATL',
  celtics: 'BOS',
  nets: 'BKN',
  hornets: 'CHA',
  bulls: 'CHI',
  cavaliers: 'CLE',
  mavericks: 'DAL',
  nuggets: 'DEN',
  pistons: 'DET',
  warriors: 'GSW',
  rockets: 'HOU',
  pacers: 'IND',
  clippers: 'LAC',
  lakers: 'LAL',
  grizzlies: 'MEM',
  heat: 'MIA',
  bucks: 'MIL',
  timberwolves: 'MIN',
  pelicans: 'NOP',
  knicks: 'NYK',
  thunder: 'OKC',
  magic: 'ORL',
  sixers: 'PHI',
  suns: 'PHX',
  blazers: 'POR',
  kings: 'SAC',
  spurs: 'SAS',
  raptors: 'TOR',
  jazz: 'UTA',
  wizards: 'WAS',
};

/** Return the standard three-letter abbreviation for a franchise ID. */
export function franchiseAbbreviation(franchiseId: string): string {
  return FRANCHISE_ABBREVIATIONS[franchiseId] ?? franchiseId.slice(0, 3).toUpperCase();
}
