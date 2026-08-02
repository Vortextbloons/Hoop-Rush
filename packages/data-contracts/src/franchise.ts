import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema, teamExternalIdSchema } from './ids.js';

/**
 * Modern franchise slots and historical lineage (spec/12). A modern slot is
 * the selectable 30-franchise identity and the fixed opponent-bracket
 * identity. Historical lineage segments describe the real NBA teams that
 * owned player-seasons within a slot, so a Thunder pool can display
 * "Seattle SuperSonics, 1988-89".
 *
 * The lineage table, not names or abbreviations, determines ownership: each
 * player-season-team row resolves to exactly one historical identity and one
 * modern franchise slot.
 */

/** Exactly 30 stable modern franchise slots. */
export const modernFranchiseSlotSchema = z.object({
  /** Modern slot identity; selectable franchiseId (e.g. 'thunder'). */
  franchiseId: franchiseIdSchema,
  /** Current display name for the slot (e.g. "Oklahoma City Thunder"). */
  displayName: z.string().min(1).max(64),
  /** Modern NBA API team ID used to resolve logos and external records. */
  teamExternalId: teamExternalIdSchema,
});
export type ModernFranchiseSlot = z.infer<typeof modernFranchiseSlotSchema>;

/**
 * One contiguous NBA lineage segment owned by a modern franchise slot.
 * Segments are explicit: they never infer a rename or relocation from a
 * name or abbreviation.
 */
export const franchiseLineageEntrySchema = z.object({
  /** Modern slot that owns this historical identity. */
  modernFranchiseId: franchiseIdSchema,
  /** Source team identity for the segment (e.g. Seattle's NBA team ID). */
  historicalTeamId: teamExternalIdSchema,
  /** First NBA season of this identity, inclusive. */
  validFromSeasonKey: seasonKeySchema,
  /** Last NBA season of this identity, inclusive; absent when current. */
  validThroughSeasonKey: seasonKeySchema.optional(),
  /** Historical display name (e.g. "Seattle SuperSonics"). */
  displayName: z.string().min(1).max(64),
  /** Historical city (e.g. "Seattle"). */
  city: z.string().min(1).max(64),
  /** Historical source abbreviation when the source publishes one. */
  abbreviation: z.string().min(1).max(8).optional(),
  /** Source identity IDs that resolve this segment (NBA team IDs, alt ids). */
  sourceIdentityIds: z.array(z.string().min(1).max(64)).min(1),
  /** Lineage rule version that produced this segment. */
  lineageRuleVersion: z.string().min(1).max(64),
});
export type FranchiseLineageEntry = z.infer<typeof franchiseLineageEntrySchema>;

export const franchiseLineageSchema = z.array(franchiseLineageEntrySchema);
export type FranchiseLineage = z.infer<typeof franchiseLineageSchema>;

/**
 * Standard three-letter NBA abbreviations for the current franchise slots.
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

/**
 * Lowercase slugs used by secondary logo hosts (e.g. ESPN). Most franchises
 * match their three-letter abbreviation; the Pelicans and Jazz use legacy
 * host slugs (`no`, `utah`) that differ.
 */
const FRANCHISE_LOGO_SLUGS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(FRANCHISE_ABBREVIATIONS).map(([franchiseId, abbreviation]) => [
      franchiseId,
      abbreviation.toLowerCase(),
    ]),
  ),
  pelicans: 'no',
  jazz: 'utah',
};

/** Return the lowercase logo-host slug for a franchise ID. */
export function franchiseLogoSlug(franchiseId: string): string {
  return FRANCHISE_LOGO_SLUGS[franchiseId] ?? franchiseId.slice(0, 3).toLowerCase();
}
