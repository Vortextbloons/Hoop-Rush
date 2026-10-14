import { z } from 'zod';
import { SEASON_COURT_INNOVATION_VERSION } from './season-versions.ts';

export const seasonCourtInnovationIdSchema = z.enum([
  'deep-four',
  'twenty-second-clock',
  'first-to-seven-overtime',
]);
export type SeasonCourtInnovationId = z.infer<typeof seasonCourtInnovationIdSchema>;

export const seasonGameRuleSchema = z.enum([
  'standard',
  'deep-four',
  'twenty-second-clock',
  'first-to-seven-overtime',
]);
export type SeasonGameRule = z.infer<typeof seasonGameRuleSchema>;

export const seasonCourtInnovationCatalogEntrySchema = z.object({
  id: seasonCourtInnovationIdSchema,
  displayName: z.string().min(1).max(96),
  version: z.literal(SEASON_COURT_INNOVATION_VERSION),
  rule: seasonGameRuleSchema,
  description: z.string().min(1).max(1024),
  rosterImplication: z.string().min(1).max(1024),
});
export type SeasonCourtInnovationCatalogEntry = z.infer<
  typeof seasonCourtInnovationCatalogEntrySchema
>;

export const SEASON_COURT_INNOVATION_CATALOG: readonly SeasonCourtInnovationCatalogEntry[] = [
  {
    id: 'deep-four',
    displayName: 'Deep Four',
    version: SEASON_COURT_INNOVATION_VERSION,
    rule: 'deep-four',
    description:
      'Shots from the modeled deep zone (30+ ft arc, no corner exception) score four points.',
    rosterImplication:
      'Favors above-the-break shooting volume; deep makes count separately from threes.',
  },
  {
    id: 'twenty-second-clock',
    displayName: 'Twenty-Second Clock',
    version: SEASON_COURT_INNOVATION_VERSION,
    rule: 'twenty-second-clock',
    description: 'New possessions receive 20 seconds; offensive rebounds reset to 14.',
    rosterImplication: 'Favors quick decisions and low late-clock usage; more pace pressure.',
  },
  {
    id: 'first-to-seven-overtime',
    displayName: 'First to Seven Overtime',
    version: SEASON_COURT_INNOVATION_VERSION,
    rule: 'first-to-seven-overtime',
    description: 'Regulation ties enter one untimed race to at least seven overtime points.',
    rosterImplication: 'Favors closing units and reliable half-court scoring for the short race.',
  },
];

export function courtInnovationEntryOf(
  id: SeasonCourtInnovationId,
): SeasonCourtInnovationCatalogEntry {
  const entry = SEASON_COURT_INNOVATION_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown court innovation ${id}`);
  return entry;
}
