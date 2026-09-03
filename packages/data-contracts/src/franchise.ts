import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema, teamExternalIdSchema } from './ids.ts';
export const modernFranchiseSlotSchema = z.object({
  franchiseId: franchiseIdSchema,
  displayName: z.string().min(1).max(64),
  teamExternalId: teamExternalIdSchema,
});
export type ModernFranchiseSlot = z.infer<typeof modernFranchiseSlotSchema>;
export const historicalLogoCandidateSchema = z.object({
  url: z.url(),
  source: z.string().min(1).max(64),
  attribution: z.string().min(1).max(256).optional(),
});
export type HistoricalLogoCandidate = z.infer<typeof historicalLogoCandidateSchema>;
export const franchiseLineageEntrySchema = z.object({
  modernFranchiseId: franchiseIdSchema,
  historicalTeamId: teamExternalIdSchema,
  validFromSeasonKey: seasonKeySchema,
  validThroughSeasonKey: seasonKeySchema.optional(),
  displayName: z.string().min(1).max(64),
  city: z.string().min(1).max(64),
  abbreviation: z.string().min(1).max(8).optional(),
  sourceIdentityIds: z.array(z.string().min(1).max(64)).min(1),
  lineageRuleVersion: z.string().min(1).max(64),
  logoCandidates: z.array(historicalLogoCandidateSchema).min(1).optional(),
});
export type FranchiseLineageEntry = z.infer<typeof franchiseLineageEntrySchema>;
export const franchiseLineageSchema = z.array(franchiseLineageEntrySchema);
export type FranchiseLineage = z.infer<typeof franchiseLineageSchema>;
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
export function franchiseAbbreviation(franchiseId: string): string {
  return FRANCHISE_ABBREVIATIONS[franchiseId] ?? franchiseId.slice(0, 3).toUpperCase();
}
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
export function franchiseLogoSlug(franchiseId: string): string {
  return FRANCHISE_LOGO_SLUGS[franchiseId] ?? franchiseId.slice(0, 3).toLowerCase();
}
