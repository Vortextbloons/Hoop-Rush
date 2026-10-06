import {
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  buildEmptyCampaignState,
  seasonCampaignStateSchema,
  type SeasonCampaignState,
} from '@hoop-rush/data-contracts';
export { buildEmptyCampaignState, SEASON_CAMPAIGN_VERSION, SEASON_CAMPAIGN_TARGETS_VERSION };
export function normalizeCampaignState(state: unknown): SeasonCampaignState {
  if (state === undefined || state === null) return buildEmptyCampaignState();
  const parsed = seasonCampaignStateSchema.safeParse(state);
  if (!parsed.success) return buildEmptyCampaignState();
  return parsed.data;
}
