import { z } from 'zod';
import { franchiseIdSchema, commandIdSchema } from './ids.ts';
import {
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_EVOLUTION_TARGETS_VERSION,
  SEASON_FRONT_OFFICE_VERSION,
} from './season-versions.ts';
import {
  seasonDuplicateCommandRejectionSchema,
  seasonRunCommandBaseSchema,
  seasonRunMismatchRejectionSchema,
  seasonStaleStateRejectionSchema,
} from './season-command-base.ts';
import {
  seasonCampaignFamilySchema,
  seasonCampaignOpportunityIdSchema,
} from './season-campaign.ts';

export const seasonFrontOfficeIdSchema = z.enum(['morgan-vale', 'alex-chen', 'jordan-ellis']);
export type SeasonFrontOfficeId = z.infer<typeof seasonFrontOfficeIdSchema>;

export const seasonFrontOfficeCatalogEntrySchema = z.object({
  id: seasonFrontOfficeIdSchema,
  displayName: z.string().min(1).max(96),
  title: z.string().min(1).max(96),
  version: z.literal(SEASON_FRONT_OFFICE_VERSION),
  ability: z.string().min(1).max(512),
  drawback: z.string().min(1).max(512),
  baseInquiryAllowance: z.number().int().min(3).max(4),
  purchasedInquiryCost: z.number().int().min(1).max(2),
  rehabDelta: z.number().int().min(-1).max(1),
  campaignBonus: z.number().int().min(0).max(1),
});
export type SeasonFrontOfficeCatalogEntry = z.infer<typeof seasonFrontOfficeCatalogEntrySchema>;

export const SEASON_FRONT_OFFICE_CATALOG: readonly SeasonFrontOfficeCatalogEntry[] = [
  {
    id: 'morgan-vale',
    displayName: 'Morgan Vale',
    title: 'Deal Maker',
    version: SEASON_FRONT_OFFICE_VERSION,
    ability: '4 base Trade Board inquiries per window.',
    drawback: 'Risky rehab costs 1 extra Influence.',
    baseInquiryAllowance: 4,
    purchasedInquiryCost: 1,
    rehabDelta: 1,
    campaignBonus: 0,
  },
  {
    id: 'alex-chen',
    displayName: 'Alex Chen',
    title: 'Recovery Director',
    version: SEASON_FRONT_OFFICE_VERSION,
    ability: 'Risky rehab costs 1 less Influence, minimum 1.',
    drawback: 'Extra Trade Board inquiries cost 2 Influence each.',
    baseInquiryAllowance: 3,
    purchasedInquiryCost: 2,
    rehabDelta: -1,
    campaignBonus: 0,
  },
  {
    id: 'jordan-ellis',
    displayName: 'Jordan Ellis',
    title: 'Campaign Director',
    version: SEASON_FRONT_OFFICE_VERSION,
    ability: '1 extra Influence for each Campaign payout that grants Influence.',
    drawback: 'Risky rehab costs 1 extra Influence.',
    baseInquiryAllowance: 3,
    purchasedInquiryCost: 1,
    rehabDelta: 1,
    campaignBonus: 1,
  },
];

export function frontOfficeEntryOf(id: SeasonFrontOfficeId): SeasonFrontOfficeCatalogEntry {
  const entry = SEASON_FRONT_OFFICE_CATALOG.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown front office ${id}`);
  return entry;
}

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

export const seasonFrontOfficeSelectionSchema = z.object({
  executiveId: seasonFrontOfficeIdSchema,
  version: z.literal(SEASON_FRONT_OFFICE_VERSION),
  selectedByCommandId: commandIdSchema,
  selectedAtStateRevision: z.number().int().nonnegative(),
});
export type SeasonFrontOfficeSelection = z.infer<typeof seasonFrontOfficeSelectionSchema>;

export const seasonEvolutionDiscoverySchema = z.object({
  blockIndex: z.literal(2),
  offeredInnovationIds: z.array(seasonCourtInnovationIdSchema).length(3),
  version: z.literal(SEASON_COURT_INNOVATION_VERSION),
  seed: z.string().min(1).max(64),
});
export type SeasonEvolutionDiscovery = z.infer<typeof seasonEvolutionDiscoverySchema>;

export const seasonEvolutionSelectionSchema = z.object({
  franchiseId: franchiseIdSchema,
  innovationId: seasonCourtInnovationIdSchema,
  version: z.literal(SEASON_COURT_INNOVATION_VERSION),
  selectedByCommandId: commandIdSchema.nullable(),
  aiSelected: z.boolean(),
  inputDigest: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  candidateScores: z
    .array(z.object({ innovationId: seasonCourtInnovationIdSchema, score: z.number() }))
    .optional(),
});
export type SeasonEvolutionSelection = z.infer<typeof seasonEvolutionSelectionSchema>;

export const seasonEvolutionStateSchema = z.object({
  schemaVersion: z.literal(1),
  frontOfficeVersion: z.literal(SEASON_FRONT_OFFICE_VERSION),
  courtInnovationVersion: z.literal(SEASON_COURT_INNOVATION_VERSION),
  targetsVersion: z.literal(SEASON_EVOLUTION_TARGETS_VERSION),
  frontOffice: seasonFrontOfficeSelectionSchema.nullable(),
  discovery: seasonEvolutionDiscoverySchema.nullable(),
  selections: z.record(franchiseIdSchema, seasonEvolutionSelectionSchema),
});
export type SeasonEvolutionState = z.infer<typeof seasonEvolutionStateSchema>;

export function buildEmptyEvolutionState(): SeasonEvolutionState {
  return {
    schemaVersion: 1,
    frontOfficeVersion: SEASON_FRONT_OFFICE_VERSION,
    courtInnovationVersion: SEASON_COURT_INNOVATION_VERSION,
    targetsVersion: SEASON_EVOLUTION_TARGETS_VERSION,
    frontOffice: null,
    discovery: null,
    selections: {},
  };
}

export function normalizeEvolutionState(state: unknown): SeasonEvolutionState {
  if (state === undefined || state === null) return buildEmptyEvolutionState();
  const parsed = seasonEvolutionStateSchema.safeParse(state);
  if (parsed.success) return parsed.data;
  return buildEmptyEvolutionState();
}

export const seasonSponsorIdSchema = z.enum(['baseline-supply', 'second-wind', 'cityline-sports']);
export type SeasonSponsorId = z.infer<typeof seasonSponsorIdSchema>;

export const seasonSponsorCatalogEntrySchema = z.object({
  id: seasonSponsorIdSchema,
  displayName: z.string().min(1).max(96),
  contentVersion: z.string().min(1).max(64),
  compatibleFamilies: z.array(seasonCampaignFamilySchema).min(1),
});
export type SeasonSponsorCatalogEntry = z.infer<typeof seasonSponsorCatalogEntrySchema>;

export const SEASON_SPONSOR_CATALOG: readonly SeasonSponsorCatalogEntry[] = [
  {
    id: 'baseline-supply',
    displayName: 'Baseline Supply',
    contentVersion: 'sponsor-content-v1',
    compatibleFamilies: ['style'],
  },
  {
    id: 'second-wind',
    displayName: 'Second Wind',
    contentVersion: 'sponsor-content-v1',
    compatibleFamilies: ['player-role', 'roster-response'],
  },
  {
    id: 'cityline-sports',
    displayName: 'Cityline Sports',
    contentVersion: 'sponsor-content-v1',
    compatibleFamilies: ['results', 'marquee'],
  },
];

export const seasonSponsorWrapperSchema = z.object({
  sponsorId: seasonSponsorIdSchema,
  contentVersion: z.string().min(1).max(64),
  wrappedOpportunityId: seasonCampaignOpportunityIdSchema,
  blockIndex: z.number().int().min(0).max(7),
  seedPath: z.array(z.string()).min(1),
});
export type SeasonSponsorWrapper = z.infer<typeof seasonSponsorWrapperSchema>;

export function resolveHomeGameRule(
  evolution: SeasonEvolutionState | null | undefined,
  homeFranchiseId: string,
): SeasonGameRule {
  if (!evolution) return 'standard';
  const sel = (
    evolution.selections as unknown as Record<
      string,
      { innovationId: SeasonCourtInnovationId } | undefined
    >
  )[homeFranchiseId];
  if (!sel) return 'standard';
  const entry = SEASON_COURT_INNOVATION_CATALOG.find((e) => e.id === sel.innovationId);
  return entry ? entry.rule : 'standard';
}

export const seasonSelectFrontOfficeCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('select-front-office'),
  executiveId: seasonFrontOfficeIdSchema,
});
export type SeasonSelectFrontOfficeCommand = z.infer<typeof seasonSelectFrontOfficeCommandSchema>;
export const seasonSelectCourtInnovationCommandSchema = seasonRunCommandBaseSchema.extend({
  command: z.literal('select-court-innovation'),
  innovationId: seasonCourtInnovationIdSchema,
});
export type SeasonSelectCourtInnovationCommand = z.infer<
  typeof seasonSelectCourtInnovationCommandSchema
>;
export const seasonFrontOfficeAlreadySelectedRejectionSchema = z.object({
  code: z.literal('front-office-already-selected'),
});
export type SeasonFrontOfficeAlreadySelectedRejection = z.infer<
  typeof seasonFrontOfficeAlreadySelectedRejectionSchema
>;
export const seasonFrontOfficeInvalidRejectionSchema = z.object({
  code: z.literal('front-office-invalid'),
  executiveId: z.string(),
});
export type SeasonFrontOfficeInvalidRejection = z.infer<
  typeof seasonFrontOfficeInvalidRejectionSchema
>;
export const seasonFrontOfficeTooLateRejectionSchema = z.object({
  code: z.literal('front-office-too-late'),
  completedRounds: z.number().int().min(0).max(82),
});
export type SeasonFrontOfficeTooLateRejection = z.infer<
  typeof seasonFrontOfficeTooLateRejectionSchema
>;
export const seasonInnovationNotDiscoveredRejectionSchema = z.object({
  code: z.literal('innovation-not-discovered'),
});
export type SeasonInnovationNotDiscoveredRejection = z.infer<
  typeof seasonInnovationNotDiscoveredRejectionSchema
>;
export const seasonInnovationAlreadySelectedRejectionSchema = z.object({
  code: z.literal('innovation-already-selected'),
});
export type SeasonInnovationAlreadySelectedRejection = z.infer<
  typeof seasonInnovationAlreadySelectedRejectionSchema
>;
export const seasonInnovationInvalidRejectionSchema = z.object({
  code: z.literal('innovation-invalid'),
  innovationId: z.string(),
});
export type SeasonInnovationInvalidRejection = z.infer<
  typeof seasonInnovationInvalidRejectionSchema
>;
export const seasonSelectFrontOfficeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: z.discriminatedUnion('code', [
      seasonRunMismatchRejectionSchema,
      seasonStaleStateRejectionSchema,
      seasonDuplicateCommandRejectionSchema,
      seasonFrontOfficeAlreadySelectedRejectionSchema,
      seasonFrontOfficeInvalidRejectionSchema,
      seasonFrontOfficeTooLateRejectionSchema,
    ]),
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    executiveId: seasonFrontOfficeIdSchema,
  }),
]);
export type SeasonSelectFrontOfficeResult = z.infer<typeof seasonSelectFrontOfficeResultSchema>;
export const seasonSelectCourtInnovationResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('rejected'),
    commandId: commandIdSchema,
    rejection: z.discriminatedUnion('code', [
      seasonRunMismatchRejectionSchema,
      seasonStaleStateRejectionSchema,
      seasonDuplicateCommandRejectionSchema,
      seasonInnovationNotDiscoveredRejectionSchema,
      seasonInnovationAlreadySelectedRejectionSchema,
      seasonInnovationInvalidRejectionSchema,
    ]),
  }),
  z.object({
    status: z.literal('accepted'),
    commandId: commandIdSchema,
    innovationId: seasonCourtInnovationIdSchema,
  }),
]);
export type SeasonSelectCourtInnovationResult = z.infer<
  typeof seasonSelectCourtInnovationResultSchema
>;
