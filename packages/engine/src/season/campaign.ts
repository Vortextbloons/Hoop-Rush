import {
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  blockRoundRange,
  buildEmptyCampaignState,
  seasonNamespaceSeed,
  type SeasonCampaignCondition,
  type SeasonCampaignEvaluation,
  type SeasonCampaignEvolutionOffer,
  type SeasonCampaignFamily,
  type SeasonCampaignFocus,
  type SeasonCampaignGmIdentity,
  type SeasonCampaignOpportunity,
  type SeasonCampaignReward,
  type SeasonCampaignState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { seasonPlayerAvailable } from './injuries.ts';
import { deriveSeasonInfluenceEntryId, seasonTransactionEntry } from './transactions.ts';
export { buildEmptyCampaignState, SEASON_CAMPAIGN_VERSION, SEASON_CAMPAIGN_TARGETS_VERSION };
export class SeasonCampaignGenerationError extends Error {
  readonly code = 'campaign-generation-failed' as const;
  readonly audit: readonly string[];
  readonly blockIndex: number;
  constructor(message: string, blockIndex: number, audit: readonly string[]) {
    super(message);
    this.name = 'SeasonCampaignGenerationError';
    this.blockIndex = blockIndex;
    this.audit = audit;
  }
}
export class SeasonCampaignEvaluationError extends Error {
  readonly code = 'campaign-evaluation-failed' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SeasonCampaignEvaluationError';
  }
}
interface CampaignTemplate {
  templateId: string;
  branchId: string;
  family: SeasonCampaignFamily;
  identity: SeasonCampaignGmIdentity;
  target: SeasonCampaignCondition;
  breakthrough: SeasonCampaignCondition | null;
  completedReward: SeasonCampaignReward;
  breakthroughReward: SeasonCampaignReward | null;
  requires: 'always' | 'schedule' | 'player' | 'transaction';
}
function hexId(prefix: string, seed: string): string {
  return `${prefix}-${seed.slice(0, 8)}`;
}
function rewardId(seedRoot: string, templateId: string, kind: string): string {
  return hexId('rew', seasonNamespaceSeed(seedRoot, 'campaign', 'reward', templateId, kind));
}
function opportunityId(
  seedRoot: string,
  blockIndex: number,
  slot: number,
  templateId: string,
): string {
  return hexId(
    'copp',
    seasonNamespaceSeed(
      seedRoot,
      'campaign',
      String(blockIndex),
      'offers',
      String(slot),
      templateId,
    ),
  );
}
const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = [
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'results-block-wins-6'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'results-a')),
    family: 'results',
    identity: 'win-now',
    target: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 6, window: 'block' },
    breakthrough: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 8, window: 'block' },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-block-wins-6', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-block-wins-6', 'breakthrough'),
      type: 'trade-inquiry-credit',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'results-winning-block'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'results-a')),
    family: 'results',
    identity: 'win-now',
    target: { kind: 'winning-block', comparisonOperator: 'gte', threshold: 1, window: 'block' },
    breakthrough: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 7, window: 'block' },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-winning-block', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-winning-block', 'breakthrough'),
      type: 'influence',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'results-top-six'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'results-b')),
    family: 'results',
    identity: 'win-now',
    target: { kind: 'top-six', comparisonOperator: 'gte', threshold: 1, window: 'post-block' },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-top-six', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'results-play-in'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'results-b')),
    family: 'results',
    identity: 'win-now',
    target: { kind: 'play-in', comparisonOperator: 'gte', threshold: 1, window: 'post-block' },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'results-play-in', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'marquee-win-over-higher'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'marquee-a')),
    family: 'marquee',
    identity: 'win-now',
    target: { kind: 'win-over-higher', comparisonOperator: 'gte', threshold: 1, window: 'block' },
    breakthrough: {
      kind: 'sweep-opponent',
      comparisonOperator: 'gte',
      threshold: 2,
      window: 'block',
      opponentFranchiseId: 'celtics',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-win-over-higher', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-win-over-higher', 'breakthrough'),
      type: 'follow-up-unlock',
      amount: 1,
    },
    requires: 'schedule',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'marquee-beat-leader'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'marquee-a')),
    family: 'marquee',
    identity: 'win-now',
    target: {
      kind: 'beat-conference-leader',
      comparisonOperator: 'gte',
      threshold: 1,
      window: 'block',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-beat-leader', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'schedule',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'marquee-sweep'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'marquee-b')),
    family: 'marquee',
    identity: 'win-now',
    target: {
      kind: 'sweep-opponent',
      comparisonOperator: 'gte',
      threshold: 1,
      window: 'block',
      opponentFranchiseId: 'celtics',
    },
    breakthrough: {
      kind: 'sweep-opponent',
      comparisonOperator: 'gte',
      threshold: 2,
      window: 'block',
      opponentFranchiseId: 'celtics',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-sweep', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-sweep', 'breakthrough'),
      type: 'trade-inquiry-credit',
      amount: 1,
    },
    requires: 'schedule',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'marquee-sweep-2'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'marquee-b')),
    family: 'marquee',
    identity: 'win-now',
    target: {
      kind: 'beat-conference-leader',
      comparisonOperator: 'gte',
      threshold: 1,
      window: 'block',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'marquee-sweep-2', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'schedule',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-defensive'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-a')),
    family: 'style',
    identity: 'team-identity',
    target: {
      kind: 'defensive-efficiency',
      comparisonOperator: 'lte',
      threshold: 110,
      window: 'block',
    },
    breakthrough: {
      kind: 'defensive-efficiency',
      comparisonOperator: 'lte',
      threshold: 105,
      window: 'block',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-defensive', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-defensive', 'breakthrough'),
      type: 'influence',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-three'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-a')),
    family: 'style',
    identity: 'team-identity',
    target: {
      kind: 'three-point-volume',
      comparisonOperator: 'gte',
      threshold: 90,
      window: 'block',
    },
    breakthrough: {
      kind: 'three-point-volume',
      comparisonOperator: 'gte',
      threshold: 110,
      window: 'block',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-three', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-three', 'breakthrough'),
      type: 'follow-up-unlock',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-assists'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-b')),
    family: 'style',
    identity: 'team-identity',
    target: { kind: 'assists', comparisonOperator: 'gte', threshold: 220, window: 'block' },
    breakthrough: { kind: 'assists', comparisonOperator: 'gte', threshold: 250, window: 'block' },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-assists', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-assists', 'breakthrough'),
      type: 'influence',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-turnover'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-b')),
    family: 'style',
    identity: 'team-identity',
    target: {
      kind: 'turnover-control',
      comparisonOperator: 'lte',
      threshold: 130,
      window: 'block',
    },
    breakthrough: {
      kind: 'turnover-control',
      comparisonOperator: 'lte',
      threshold: 110,
      window: 'block',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-turnover', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-rebound'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-c')),
    family: 'style',
    identity: 'team-identity',
    target: { kind: 'rebound-margin', comparisonOperator: 'gte', threshold: 20, window: 'block' },
    breakthrough: {
      kind: 'rebound-margin',
      comparisonOperator: 'gte',
      threshold: 40,
      window: 'block',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-rebound', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-rebound', 'breakthrough'),
      type: 'trade-inquiry-credit',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'style-bench'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'style-c')),
    family: 'style',
    identity: 'team-identity',
    target: {
      kind: 'bench-contribution',
      comparisonOperator: 'gte',
      threshold: 320,
      window: 'block',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'style-bench', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'player-minutes'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'player-a')),
    family: 'player-role',
    identity: 'player-development',
    target: {
      kind: 'player-minutes',
      comparisonOperator: 'gte',
      threshold: 160,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: {
      kind: 'player-minutes',
      comparisonOperator: 'gte',
      threshold: 220,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-minutes', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-minutes', 'breakthrough'),
      type: 'follow-up-unlock',
      amount: 1,
    },
    requires: 'player',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'player-points'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'player-a')),
    family: 'player-role',
    identity: 'player-development',
    target: {
      kind: 'player-points',
      comparisonOperator: 'gte',
      threshold: 120,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: {
      kind: 'player-points',
      comparisonOperator: 'gte',
      threshold: 160,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-points', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-points', 'breakthrough'),
      type: 'influence',
      amount: 1,
    },
    requires: 'player',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'player-availability'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'player-b')),
    family: 'player-role',
    identity: 'player-development',
    target: {
      kind: 'player-availability',
      comparisonOperator: 'gte',
      threshold: 8,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: {
      kind: 'player-availability',
      comparisonOperator: 'gte',
      threshold: 10,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-availability', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'player',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'player-rebounds'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'player-b')),
    family: 'player-role',
    identity: 'player-development',
    target: {
      kind: 'player-rebounds',
      comparisonOperator: 'gte',
      threshold: 70,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'player-rebounds', 'completed'),
      type: 'trade-inquiry-credit',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'player',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'roster-new-minutes'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'roster-a')),
    family: 'roster-response',
    identity: 'player-development',
    target: {
      kind: 'roster-new-player-minutes',
      comparisonOperator: 'gte',
      threshold: 100,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: {
      kind: 'roster-new-player-minutes',
      comparisonOperator: 'gte',
      threshold: 160,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-new-minutes', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-new-minutes', 'breakthrough'),
      type: 'influence',
      amount: 1,
    },
    requires: 'transaction',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'roster-replace'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'roster-a')),
    family: 'roster-response',
    identity: 'team-identity',
    target: {
      kind: 'roster-replace-unavailable',
      comparisonOperator: 'gte',
      threshold: 1,
      window: 'block',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-replace', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'transaction',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'roster-depth'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'roster-b')),
    family: 'roster-response',
    identity: 'team-identity',
    target: {
      kind: 'roster-depth-coverage',
      comparisonOperator: 'gte',
      threshold: 1,
      window: 'block',
    },
    breakthrough: {
      kind: 'roster-depth-coverage',
      comparisonOperator: 'gte',
      threshold: 2,
      window: 'block',
    },
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-depth', 'completed'),
      type: 'influence',
      amount: 1,
    },
    breakthroughReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-depth', 'breakthrough'),
      type: 'trade-inquiry-credit',
      amount: 1,
    },
    requires: 'always',
  },
  {
    templateId: hexId(
      'ctpl',
      seasonNamespaceSeed('campaign-catalog-v1', 'template', 'roster-depth-2'),
    ),
    branchId: hexId('cbr', seasonNamespaceSeed('campaign-catalog-v1', 'branch', 'roster-b')),
    family: 'roster-response',
    identity: 'team-identity',
    target: {
      kind: 'roster-new-player-minutes',
      comparisonOperator: 'gte',
      threshold: 80,
      window: 'block',
      playerVersionId: 'pv-00000000000000000000000000000000',
    },
    breakthrough: null,
    completedReward: {
      rewardId: rewardId('campaign-catalog-v1', 'roster-depth-2', 'completed'),
      type: 'trade-board-information',
      amount: 1,
    },
    breakthroughReward: null,
    requires: 'transaction',
  },
] as const;
export function campaignCatalog(): readonly CampaignTemplate[] {
  return CAMPAIGN_TEMPLATES;
}
function branches(): Map<string, CampaignTemplate[]> {
  const map = new Map<string, CampaignTemplate[]>();
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const arr = map.get(tpl.branchId) ?? [];
    arr.push(tpl);
    map.set(tpl.branchId, arr);
  }
  for (const [branchId, list] of map) {
    list.sort((a, b) => (a.templateId < b.templateId ? -1 : 1));
    map.set(branchId, list);
  }
  return map;
}
function effectiveIdentity(campaignState: SeasonCampaignState): SeasonCampaignGmIdentity | null {
  if (campaignState.evolutionSelection !== null) {
    return campaignState.evolutionSelection.resultingIdentity;
  }
  return campaignState.startingIdentity;
}
function effectiveFocus(campaignState: SeasonCampaignState): SeasonCampaignFocus | null {
  if (campaignState.evolutionSelection !== null) {
    return campaignState.evolutionSelection.resultingFocus;
  }
  return campaignState.startingFocus;
}
function focusFamily(focus: SeasonCampaignFocus | null): SeasonCampaignFamily | null {
  switch (focus) {
    case 'defense':
      return 'style';
    case 'shooting':
      return 'style';
    case 'ball-movement':
      return 'style';
    case 'depth':
      return 'roster-response';
    default:
      return null;
  }
}
export function normalizeCampaignState(state: unknown): SeasonCampaignState {
  if (state === undefined || state === null) return buildEmptyCampaignState();
  const maybe = state as SeasonCampaignState;
  if (maybe.campaignVersion === SEASON_CAMPAIGN_VERSION && maybe.schemaVersion === 1) {
    return maybe;
  }
  return buildEmptyCampaignState();
}
export interface SeasonCampaignGenerationInput {
  rootSeed: string;
  blockIndex: number;
  humanFranchiseId: string | null;
  schedule: SeasonSchedule;
  standings: SeasonStandings;
  health: SeasonHealthState;
  rotations: readonly SeasonRotation[];
  rosters: readonly SeasonRoster[];
  transactions: readonly SeasonTransactionEntry[];
  summaries: readonly SeasonGameSummary[];
  campaignState: SeasonCampaignState;
}
interface FeasibilityCandidate {
  template: CampaignTemplate;
  playerVersionId: string | null;
  opponentFranchiseId: string | null;
  feasibilityFacts: Record<string, unknown>;
  auditNote: string | null;
}
function resolvePlayerForTemplate(
  template: CampaignTemplate,
  input: SeasonCampaignGenerationInput,
): {
  playerVersionId: string | null;
  feasible: boolean;
  facts: Record<string, unknown>;
  audit: string | null;
} {
  if (template.requires !== 'player')
    return { playerVersionId: null, feasible: true, facts: {}, audit: null };
  const humanFranchiseId = input.humanFranchiseId;
  if (humanFranchiseId === null) {
    return {
      playerVersionId: null,
      feasible: false,
      facts: {},
      audit: 'player template requires human franchise',
    };
  }
  const roster = input.rosters.find((r) => r.franchiseId === humanFranchiseId);
  const rotation = input.rotations.find((r) => r.franchiseId === humanFranchiseId);
  if (!roster || !rotation) {
    return {
      playerVersionId: null,
      feasible: false,
      facts: {},
      audit: 'missing roster or rotation for human',
    };
  }
  const candidates = roster.players
    .filter((p) => seasonPlayerAvailable(input.health, p.playerVersionId))
    .filter(
      (p) =>
        rotation.targetMinutes.some(
          (tm) => tm.playerVersionId === p.playerVersionId && tm.minutes > 0,
        ) || rotation.starters.includes(p.playerVersionId),
    )
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  if (candidates.length === 0) {
    return {
      playerVersionId: null,
      feasible: false,
      facts: {},
      audit: `no available rotation player for ${template.templateId}`,
    };
  }
  const seed = seasonNamespaceSeed(
    input.rootSeed,
    'campaign',
    String(input.blockIndex),
    'offers',
    'candidate',
    template.templateId,
  );
  const rng = createRng(seed);
  const pick = rng.pick(candidates);
  return {
    playerVersionId: pick.playerVersionId,
    feasible: true,
    facts: {
      playerVersionId: pick.playerVersionId,
      availableRotationCandidates: candidates.length,
    },
    audit: null,
  };
}
function scheduleFactsForTemplate(
  template: CampaignTemplate,
  input: SeasonCampaignGenerationInput,
): {
  opponentFranchiseId: string | null;
  feasible: boolean;
  facts: Record<string, unknown>;
  audit: string | null;
} {
  if (template.requires !== 'schedule')
    return { opponentFranchiseId: null, feasible: true, facts: {}, audit: null };
  const humanFranchiseId = input.humanFranchiseId;
  if (humanFranchiseId === null) {
    return {
      opponentFranchiseId: null,
      feasible: false,
      facts: {},
      audit: 'schedule template requires human franchise',
    };
  }
  const { fromRound, toRound } = blockRoundRange(input.blockIndex);
  const blockGames = input.schedule.games.filter((g) => g.round >= fromRound && g.round <= toRound);
  const humanGames = blockGames.filter(
    (g) => g.homeFranchiseId === humanFranchiseId || g.awayFranchiseId === humanFranchiseId,
  );
  if (humanGames.length === 0) {
    return {
      opponentFranchiseId: null,
      feasible: false,
      facts: {},
      audit: `no human games in block ${String(input.blockIndex)} for schedule template ${template.templateId}`,
    };
  }
  const opponents = [
    ...new Set(
      humanGames.map((g) =>
        g.homeFranchiseId === humanFranchiseId ? g.awayFranchiseId : g.homeFranchiseId,
      ),
    ),
  ].sort();
  const templateOpponent =
    (
      template.target as {
        opponentFranchiseId?: string;
      }
    ).opponentFranchiseId ??
    (
      template.breakthrough as {
        opponentFranchiseId?: string;
      } | null
    )?.opponentFranchiseId;
  if (templateOpponent !== undefined) {
    if (!opponents.includes(templateOpponent)) {
      return {
        opponentFranchiseId: null,
        feasible: false,
        facts: { opponents, blockGames: humanGames.map((g) => g.gameId) },
        audit: `required opponent ${templateOpponent} not in block ${String(input.blockIndex)} schedule`,
      };
    }
    return {
      opponentFranchiseId: templateOpponent,
      feasible: true,
      facts: {
        opponentFranchiseId: templateOpponent,
        scheduleGameIds: humanGames
          .filter(
            (g) => g.homeFranchiseId === templateOpponent || g.awayFranchiseId === templateOpponent,
          )
          .map((g) => g.gameId),
        blockGames: humanGames.map((g) => g.gameId),
      },
      audit: null,
    };
  }
  const seed = seasonNamespaceSeed(
    input.rootSeed,
    'campaign',
    String(input.blockIndex),
    'offers',
    'candidate',
    template.templateId,
    'opponent',
  );
  const rng = createRng(seed);
  const opponent = rng.pick(opponents);
  return {
    opponentFranchiseId: opponent,
    feasible: true,
    facts: {
      opponentFranchiseId: opponent,
      opponents,
      blockGames: humanGames.map((g) => g.gameId),
    },
    audit: null,
  };
}
function transactionFactsForTemplate(
  template: CampaignTemplate,
  input: SeasonCampaignGenerationInput,
): {
  feasible: boolean;
  facts: Record<string, unknown>;
  audit: string | null;
} {
  if (template.requires !== 'transaction') return { feasible: true, facts: {}, audit: null };
  const humanFranchiseId = input.humanFranchiseId;
  if (humanFranchiseId === null) {
    return { feasible: false, facts: {}, audit: 'transaction template requires human franchise' };
  }
  const relevant = input.transactions.filter(
    (t) =>
      t.franchiseId === humanFranchiseId &&
      (t.type === 'trade' || t.type === 'free-agent-signing' || t.type === 'campaign-reward'),
  );
  const roster = input.rosters.find((r) => r.franchiseId === humanFranchiseId);
  const hasExpandedRoster = roster !== undefined && roster.players.length > 10;
  if (relevant.length === 0 && !hasExpandedRoster) {
    return {
      feasible: false,
      facts: { transactionCount: input.transactions.length, hasExpandedRoster },
      audit: `no recent transaction for ${humanFranchiseId} for template ${template.templateId}`,
    };
  }
  const facts: Record<string, unknown> = {
    transactionIds: relevant.map((t) => t.transactionId),
    hasExpandedRoster,
  };
  if (relevant.length > 0) {
    const sorted = [...relevant].sort((a, b) => (a.transactionId < b.transactionId ? -1 : 1));
    const seed = seasonNamespaceSeed(
      input.rootSeed,
      'campaign',
      String(input.blockIndex),
      'offers',
      'candidate',
      template.templateId,
      'txn',
    );
    const rng = createRng(seed);
    const pick = rng.pick(sorted);
    facts['selectedTransactionId'] = pick.transactionId;
  }
  return { feasible: true, facts, audit: null };
}
function isBranchOpen(
  template: CampaignTemplate,
  campaignState: SeasonCampaignState,
): {
  open: boolean;
  prerequisiteId: string | null;
  audit: string | null;
} {
  const branchTemplates = branches().get(template.branchId) ?? [];
  const idx = branchTemplates.findIndex((t) => t.templateId === template.templateId);
  if (idx < 0) return { open: true, prerequisiteId: null, audit: null };
  if (idx === 0) {
    const state = campaignState.branchState[template.branchId];
    if (state === 'missed' || state === 'locked') {
      return {
        open: false,
        prerequisiteId: null,
        audit: `branch ${template.branchId} is ${state}`,
      };
    }
    return { open: true, prerequisiteId: null, audit: null };
  }
  const prev = branchTemplates[idx - 1];
  if (!prev) return { open: false, prerequisiteId: null, audit: 'no previous in branch' };
  const state = campaignState.branchState[template.branchId];
  if (state === 'missed' || state === 'locked') {
    return {
      open: false,
      prerequisiteId: null,
      audit: `branch ${template.branchId} missed/locked`,
    };
  }
  if (state === 'open') {
    return { open: true, prerequisiteId: prev.templateId, audit: null };
  }
  return {
    open: false,
    prerequisiteId: null,
    audit: `follow-up ${template.templateId} requires previous completed`,
  };
}
function weightForCandidate(
  template: CampaignTemplate,
  input: SeasonCampaignGenerationInput,
  isFollowUp: boolean,
): number {
  let weight = 1;
  const identity = effectiveIdentity(input.campaignState);
  const focus = effectiveFocus(input.campaignState);
  const famFocus = focusFamily(focus);
  if (identity !== null && template.identity === identity) weight += 1.5;
  if (famFocus !== null && template.family === famFocus) weight += 1;
  if (isFollowUp) weight += 2;
  return weight;
}
function canonicalSort(candidates: FeasibilityCandidate[]): FeasibilityCandidate[] {
  return [...candidates].sort((a, b) => {
    const aKey = `${a.template.templateId}|${a.playerVersionId ?? ''}|${a.opponentFranchiseId ?? ''}|${String(a.template.target.threshold)}`;
    const bKey = `${b.template.templateId}|${b.playerVersionId ?? ''}|${b.opponentFranchiseId ?? ''}|${String(b.template.target.threshold)}`;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    return 0;
  });
}
export function generateSeasonCampaignOffers(
  input: SeasonCampaignGenerationInput,
): SeasonCampaignOpportunity[] {
  if (input.blockIndex < 0 || input.blockIndex > 7) {
    throw new SeasonCampaignGenerationError(
      `blockIndex ${String(input.blockIndex)} has no campaign opportunity (blocks 0-7 only, block 8 no opportunity)`,
      input.blockIndex,
      [`block ${String(input.blockIndex)} out of range`],
    );
  }
  if (input.humanFranchiseId === null) {
    throw new SeasonCampaignGenerationError(
      'human franchise required for campaign',
      input.blockIndex,
      ['no human franchise'],
    );
  }
  const auditDropped: string[] = [];
  const feasible: FeasibilityCandidate[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const playerRes = resolvePlayerForTemplate(tpl, input);
    const scheduleRes = scheduleFactsForTemplate(tpl, input);
    const txnRes = transactionFactsForTemplate(tpl, input);
    const branchRes = isBranchOpen(tpl, input.campaignState);
    if (!playerRes.feasible) {
      auditDropped.push(`drop ${tpl.templateId}: ${playerRes.audit ?? 'player infeasible'}`);
      continue;
    }
    if (!scheduleRes.feasible) {
      auditDropped.push(`drop ${tpl.templateId}: ${scheduleRes.audit ?? 'schedule infeasible'}`);
      continue;
    }
    if (!txnRes.feasible) {
      auditDropped.push(`drop ${tpl.templateId}: ${txnRes.audit ?? 'transaction infeasible'}`);
      continue;
    }
    if (!branchRes.open) {
      auditDropped.push(`drop ${tpl.templateId}: ${branchRes.audit ?? 'branch closed'}`);
      continue;
    }
    const feasibilityFacts: Record<string, unknown> = {
      blockIndex: input.blockIndex,
      family: tpl.family,
      identity: tpl.identity,
      requires: tpl.requires,
      branchId: tpl.branchId,
      standingRows: input.standings.rows.length,
      healthInjuries: input.health.injuries.length,
      scheduleGamesInBlock: scheduleRes.facts['blockGames'] ?? null,
      ...playerRes.facts,
      ...scheduleRes.facts,
      ...txnRes.facts,
    };
    feasible.push({
      template: tpl,
      playerVersionId: playerRes.playerVersionId,
      opponentFranchiseId: scheduleRes.opponentFranchiseId,
      feasibilityFacts,
      auditNote: null,
    });
  }
  if (feasible.length < 2) {
    throw new SeasonCampaignGenerationError(
      `not enough feasible campaign candidates for block ${String(input.blockIndex)} (found ${String(feasible.length)}, need 2)`,
      input.blockIndex,
      auditDropped,
    );
  }
  const canonical = canonicalSort(feasible);
  const branchHasPrior = (branchId: string): boolean => {
    const state = input.campaignState.branchState[branchId];
    return state === 'open';
  };
  const weighted = canonical.map((c) => ({
    candidate: c,
    weight: weightForCandidate(c.template, input, branchHasPrior(c.template.branchId)),
  }));
  const selected: FeasibilityCandidate[] = [];
  const remaining = [...weighted];
  for (let slot = 0; slot < 2; slot += 1) {
    const seed = seasonNamespaceSeed(
      input.rootSeed,
      'campaign',
      String(input.blockIndex),
      'offers',
      String(slot),
    );
    const rng = createRng(seed);
    const items = remaining.map((r) => r.candidate);
    const weights = remaining.map((r) => r.weight);
    const pick = rng.weightedPick(items, weights);
    const pickIdx = remaining.findIndex(
      (r) =>
        r.candidate.template.templateId === pick.template.templateId &&
        r.candidate.playerVersionId === pick.playerVersionId,
    );
    const chosen = remaining.splice(pickIdx, 1)[0]?.candidate;
    if (chosen) selected.push(chosen);
  }
  const opportunities: SeasonCampaignOpportunity[] = selected.map((candidate, slot) => {
    const tpl = candidate.template;
    let target: SeasonCampaignCondition = tpl.target;
    let breakthrough: SeasonCampaignCondition | null = tpl.breakthrough;
    if (candidate.playerVersionId !== null) {
      if ('playerVersionId' in target) {
        target = {
          ...target,
          playerVersionId: candidate.playerVersionId,
        };
      } else if (tpl.requires === 'player') {
        target = {
          ...target,
          playerVersionId: candidate.playerVersionId,
        } as SeasonCampaignCondition;
      }
      if (breakthrough !== null && 'playerVersionId' in breakthrough) {
        breakthrough = {
          ...breakthrough,
          playerVersionId: candidate.playerVersionId,
        };
      }
    }
    if (candidate.opponentFranchiseId !== null) {
      if ('opponentFranchiseId' in target) {
        target = {
          ...target,
          opponentFranchiseId: candidate.opponentFranchiseId,
        };
      }
      if (breakthrough !== null && 'opponentFranchiseId' in breakthrough) {
        breakthrough = {
          ...breakthrough,
          opponentFranchiseId: candidate.opponentFranchiseId,
        };
      }
    }
    let prerequisiteId: string | null = null;
    const branchTemplates = branches().get(tpl.branchId) ?? [];
    const idx = branchTemplates.findIndex((t) => t.templateId === tpl.templateId);
    if (idx > 0) {
      const prevTpl = branchTemplates[idx - 1];
      for (const offers of Object.values(input.campaignState.offers)) {
        for (const off of offers) {
          if (off.templateId === prevTpl?.templateId && off.branchId === tpl.branchId) {
            prerequisiteId = off.opportunityId;
          }
        }
      }
      if (prerequisiteId === null && prevTpl) {
        prerequisiteId = null;
      }
    }
    const seedPath = ['campaign', String(input.blockIndex), 'offers', String(slot), tpl.templateId];
    return {
      opportunityId: opportunityId(input.rootSeed, input.blockIndex, slot, tpl.templateId),
      branchId: tpl.branchId,
      templateId: tpl.templateId,
      blockIndex: input.blockIndex,
      identity: tpl.identity,
      family: tpl.family,
      prerequisiteId: prerequisiteId,
      target,
      breakthrough,
      completedReward: tpl.completedReward,
      breakthroughReward: tpl.breakthroughReward,
      feasibilityFacts: candidate.feasibilityFacts,
      seedPath,
    };
  });
  if (opportunities[0]?.opportunityId === opportunities[1]?.opportunityId) {
    throw new SeasonCampaignGenerationError(
      'generated duplicate opportunity ids',
      input.blockIndex,
      auditDropped,
    );
  }
  if (opportunities[0]?.templateId === opportunities[1]?.templateId) {
  }
  return opportunities;
}
export interface SeasonCampaignEvaluationInput {
  opportunity: SeasonCampaignOpportunity;
  blockIndex: number;
  humanFranchiseId: string | null;
  summaries: readonly SeasonGameSummary[];
  standings: SeasonStandings;
  rotations: readonly SeasonRotation[];
  transactions: readonly SeasonTransactionEntry[];
  health: SeasonHealthState;
}
function compare(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}
function humanBlockSummaries(input: SeasonCampaignEvaluationInput): SeasonGameSummary[] {
  const human = input.humanFranchiseId;
  if (human === null) return [];
  return input.summaries.filter((s) => s.homeFranchiseId === human || s.awayFranchiseId === human);
}
function evaluateCondition(
  condition: SeasonCampaignCondition,
  input: SeasonCampaignEvaluationInput,
): {
  met: boolean;
  factValue: number;
  facts: Record<string, unknown>;
} {
  const human = input.humanFranchiseId;
  const summaries = humanBlockSummaries(input);
  const humanWins = summaries.filter((s) => {
    if (s.status === 'forfeit') return s.forfeitLoserFranchiseId !== human;
    const winner = s.homeScore > s.awayScore ? s.homeFranchiseId : s.awayFranchiseId;
    return winner === human;
  }).length;
  const humanLosses = summaries.length - humanWins;
  switch (condition.kind) {
    case 'block-wins': {
      const met = compare(humanWins, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: humanWins,
        facts: { wins: humanWins, losses: humanLosses, games: summaries.length },
      };
    }
    case 'winning-block': {
      const isWinning = humanWins > humanLosses ? 1 : 0;
      const met = compare(isWinning, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: isWinning,
        facts: { wins: humanWins, losses: humanLosses, isWinning: isWinning === 1 },
      };
    }
    case 'top-six': {
      if (human === null) return { met: false, factValue: 99, facts: { position: 99 } };
      const order = [...input.standings.rows]
        .sort(
          (a, b) =>
            b.wins - a.wins ||
            b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
            (a.franchiseId < b.franchiseId ? -1 : 1),
        )
        .map((r) => r.franchiseId);
      const pos = order.indexOf(human) + 1;
      const isTopSix = pos <= 6 ? 1 : 0;
      const metTopSix = compare(isTopSix, condition.comparisonOperator, condition.threshold);
      return { met: metTopSix, factValue: pos, facts: { position: pos, topSix: pos <= 6 } };
    }
    case 'play-in': {
      if (human === null) return { met: false, factValue: 99, facts: {} };
      const order = [...input.standings.rows]
        .sort(
          (a, b) =>
            b.wins - a.wins ||
            b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
            (a.franchiseId < b.franchiseId ? -1 : 1),
        )
        .map((r) => r.franchiseId);
      const pos = order.indexOf(human) + 1;
      const inPlayIn = pos >= 7 && pos <= 10;
      const metPlayIn = compare(
        inPlayIn ? 1 : 0,
        condition.comparisonOperator,
        condition.threshold,
      );
      return { met: metPlayIn, factValue: pos, facts: { position: pos, inPlayIn } };
    }
    case 'win-over-higher': {
      if (human === null || summaries.length === 0)
        return { met: false, factValue: 0, facts: { winsOverHigher: 0 } };
      const winsOverHigher = summaries.filter((s) => {
        const winner =
          s.status === 'forfeit'
            ? s.forfeitLoserFranchiseId !== human
              ? human
              : ''
            : s.homeScore > s.awayScore
              ? s.homeFranchiseId
              : s.awayFranchiseId;
        if (winner !== human) return false;
        const opponent = s.homeFranchiseId === human ? s.awayFranchiseId : s.homeFranchiseId;
        const humanRow = input.standings.rows.find((r) => r.franchiseId === human);
        const oppRow = input.standings.rows.find((r) => r.franchiseId === opponent);
        if (!humanRow || !oppRow) return false;
        return oppRow.wins > humanRow.wins;
      }).length;
      const met = compare(winsOverHigher, condition.comparisonOperator, condition.threshold);
      return {
        met: met,
        factValue: winsOverHigher,
        facts: { winsOverHigher, humanWins },
      };
    }
    case 'beat-conference-leader': {
      const opponentId = (
        condition as {
          opponentFranchiseId?: string;
        }
      ).opponentFranchiseId;
      const wins = summaries.filter((s) => {
        const winner =
          s.status === 'forfeit'
            ? s.forfeitLoserFranchiseId !== human
              ? human
              : ''
            : s.homeScore > s.awayScore
              ? s.homeFranchiseId
              : s.awayFranchiseId;
        if (winner !== human) return false;
        const opponent = s.homeFranchiseId === human ? s.awayFranchiseId : s.homeFranchiseId;
        if (opponentId) return opponent === opponentId;
        return false;
      }).length;
      const met = compare(wins, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: wins,
        facts: { winsVsTarget: wins, opponentFranchiseId: opponentId },
      };
    }
    case 'sweep-opponent': {
      const opponentId = (
        condition as {
          opponentFranchiseId: string;
        }
      ).opponentFranchiseId;
      const gamesVsOpp = summaries.filter(
        (s) => s.homeFranchiseId === opponentId || s.awayFranchiseId === opponentId,
      );
      if (gamesVsOpp.length === 0)
        return {
          met: false,
          factValue: 0,
          facts: { gamesVsOpponent: 0, winsVsOpponent: 0, opponentFranchiseId: opponentId },
        };
      const winsVsOpp = gamesVsOpp.filter((s) => {
        if (s.status === 'forfeit')
          return s.forfeitLoserFranchiseId !== opponentId &&
            s.forfeitLoserFranchiseId === opponentId
            ? false
            : s.forfeitLoserFranchiseId !== human;
        const winner = s.homeScore > s.awayScore ? s.homeFranchiseId : s.awayFranchiseId;
        return winner === human;
      }).length;
      const isSweep = winsVsOpp === gamesVsOpp.length && gamesVsOpp.length >= condition.threshold;
      const met =
        condition.comparisonOperator === 'gte'
          ? isSweep
          : compare(winsVsOpp, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: winsVsOpp,
        facts: {
          gamesVsOpponent: gamesVsOpp.length,
          winsVsOpponent: winsVsOpp,
          opponentFranchiseId: opponentId,
        },
      };
    }
    case 'defensive-efficiency': {
      let pointsAllowed = 0;
      for (const s of summaries) {
        const opponentBox = s.homeFranchiseId === human ? s.awayBox : s.homeBox;
        pointsAllowed += opponentBox.points;
      }
      const avgAllowed = summaries.length > 0 ? pointsAllowed / summaries.length : 0;
      const met = compare(avgAllowed, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: avgAllowed,
        facts: { pointsAllowed, games: summaries.length, avgAllowed: Math.round(avgAllowed) },
      };
    }
    case 'three-point-volume': {
      let made = 0;
      for (const s of summaries) {
        const box = s.homeFranchiseId === human ? s.homeBox : s.awayBox;
        made += box.threePointersMade;
      }
      const met = compare(made, condition.comparisonOperator, condition.threshold);
      return { met, factValue: made, facts: { threePointersMade: made } };
    }
    case 'assists': {
      let assists = 0;
      for (const s of summaries) {
        const box = s.homeFranchiseId === human ? s.homeBox : s.awayBox;
        assists += box.assists;
      }
      const met = compare(assists, condition.comparisonOperator, condition.threshold);
      return { met, factValue: assists, facts: { assists } };
    }
    case 'turnover-control': {
      let turnovers = 0;
      for (const s of summaries) {
        const box = s.homeFranchiseId === human ? s.homeBox : s.awayBox;
        turnovers += box.turnovers;
      }
      const met = compare(turnovers, condition.comparisonOperator, condition.threshold);
      return { met, factValue: turnovers, facts: { turnovers } };
    }
    case 'rebound-margin': {
      let margin = 0;
      for (const s of summaries) {
        const humanBox = s.homeFranchiseId === human ? s.homeBox : s.awayBox;
        const oppBox = s.homeFranchiseId === human ? s.awayBox : s.homeBox;
        margin +=
          humanBox.offensiveRebounds +
          humanBox.defensiveRebounds -
          (oppBox.offensiveRebounds + oppBox.defensiveRebounds);
      }
      const met = compare(margin, condition.comparisonOperator, condition.threshold);
      return { met, factValue: margin, facts: { reboundMargin: margin } };
    }
    case 'bench-contribution': {
      let benchPoints = 0;
      const rotation = human !== null ? input.rotations.find((r) => r.franchiseId === human) : null;
      const starters = new Set(rotation?.starters ?? []);
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        for (const line of lines) {
          if (!starters.has(line.playerVersionId)) benchPoints += line.points;
        }
      }
      if (benchPoints === 0 && summaries.length > 0) {
        benchPoints = summaries.reduce(
          (sum, s) => sum + (s.homeFranchiseId === human ? s.homeBox.points : s.awayBox.points),
          0,
        );
      }
      const met = compare(benchPoints, condition.comparisonOperator, condition.threshold);
      return { met, factValue: benchPoints, facts: { benchPoints } };
    }
    case 'player-minutes': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let seconds = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line) seconds += line.seconds;
      }
      const minutes = Math.floor(seconds / 60);
      const met = compare(minutes, condition.comparisonOperator, condition.threshold);
      return { met, factValue: minutes, facts: { playerVersionId: pid, minutes, seconds } };
    }
    case 'player-starts': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let starts = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line?.started) starts += 1;
      }
      const met = compare(starts, condition.comparisonOperator, condition.threshold);
      return { met, factValue: starts, facts: { playerVersionId: pid, starts } };
    }
    case 'player-availability': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let avail = 0;
      for (const s of summaries) {
        if (s.status === 'forfeit') continue;
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line && line.seconds > 0) avail += 1;
        else if (seasonPlayerAvailable(input.health, pid)) avail += 1;
      }
      if (summaries.length === 0) avail = seasonPlayerAvailable(input.health, pid) ? 10 : 0;
      const met = compare(avail, condition.comparisonOperator, condition.threshold);
      return { met, factValue: avail, facts: { playerVersionId: pid, availableGames: avail } };
    }
    case 'player-points': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let points = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line) points += line.points;
      }
      const met = compare(points, condition.comparisonOperator, condition.threshold);
      return { met, factValue: points, facts: { playerVersionId: pid, points } };
    }
    case 'player-assists': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let assists = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line) assists += line.assists;
      }
      const met = compare(assists, condition.comparisonOperator, condition.threshold);
      return { met, factValue: assists, facts: { playerVersionId: pid, assists } };
    }
    case 'player-rebounds': {
      const pid = (
        condition as {
          playerVersionId: string;
        }
      ).playerVersionId;
      let rebounds = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        const line = lines.find((l) => l.playerVersionId === pid);
        if (line) rebounds += line.offensiveRebounds + line.defensiveRebounds;
      }
      const met = compare(rebounds, condition.comparisonOperator, condition.threshold);
      return { met, factValue: rebounds, facts: { playerVersionId: pid, rebounds } };
    }
    case 'roster-new-player-minutes': {
      const pid = (
        condition as {
          playerVersionId?: string;
        }
      ).playerVersionId;
      const newIds = new Set<string>();
      for (const t of input.transactions) {
        if (t.type === 'trade' || t.type === 'free-agent-signing') {
          const payload = t.payload;
          const added =
            (payload['incomingPlayerVersionIds'] as string[] | undefined) ??
            ((payload['playerVersionId'] as string) ? [payload['playerVersionId'] as string] : []);
          for (const id of added) if (typeof id === 'string') newIds.add(id);
        }
      }
      let minutes = 0;
      const targetIds = pid ? [pid] : [...newIds];
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        for (const id of targetIds) {
          const line = lines.find((l) => l.playerVersionId === id);
          if (line) minutes += Math.floor(line.seconds / 60);
        }
      }
      const met = compare(minutes, condition.comparisonOperator, condition.threshold);
      return { met, factValue: minutes, facts: { newPlayerIds: targetIds, minutes } };
    }
    case 'roster-new-player-starts': {
      const pid = (
        condition as {
          playerVersionId?: string;
        }
      ).playerVersionId;
      const newIds = new Set<string>();
      for (const t of input.transactions) {
        if (t.type === 'trade' || t.type === 'free-agent-signing') {
          const payload = t.payload;
          const added = (payload['incomingPlayerVersionIds'] as string[] | undefined) ?? [];
          for (const id of added) if (typeof id === 'string') newIds.add(id);
        }
      }
      const targetIds = pid ? [pid] : [...newIds];
      let starts = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        for (const id of targetIds) {
          const line = lines.find((l) => l.playerVersionId === id);
          if (line?.started) starts += 1;
        }
      }
      const met = compare(starts, condition.comparisonOperator, condition.threshold);
      return { met, factValue: starts, facts: { newPlayerIds: targetIds, starts } };
    }
    case 'roster-replace-unavailable': {
      const unavailable = input.health.injuries
        .filter((inj) => inj.missedGamesRemaining > 0)
        .map((inj) => inj.playerVersionId);
      const newIds = new Set<string>();
      for (const t of input.transactions) {
        const payload = t.payload;
        const added = (payload['incomingPlayerVersionIds'] as string[] | undefined) ?? [];
        for (const id of added) if (typeof id === 'string') newIds.add(id);
      }
      let replacedMinutes = 0;
      for (const s of summaries) {
        const lines = s.homeFranchiseId === human ? s.homePlayers : s.awayPlayers;
        for (const id of newIds) {
          const line = lines.find((l) => l.playerVersionId === id);
          if (line) replacedMinutes += Math.floor(line.seconds / 60);
        }
      }
      const met =
        unavailable.length > 0 &&
        replacedMinutes > 0 &&
        compare(1, condition.comparisonOperator, condition.threshold);
      return {
        met,
        factValue: replacedMinutes,
        facts: { unavailablePlayerVersionIds: unavailable, newPlayerMinutes: replacedMinutes },
      };
    }
    case 'roster-depth-coverage': {
      const rotation = human !== null ? input.rotations.find((r) => r.franchiseId === human) : null;
      const bench = rotation?.benchOrder.length ?? 0;
      const met = compare(bench, condition.comparisonOperator, condition.threshold);
      return { met, factValue: bench, facts: { benchSize: bench } };
    }
    default:
      return { met: false, factValue: 0, facts: {} };
  }
}
export function evaluateSeasonCampaignOpportunity(
  input: SeasonCampaignEvaluationInput,
): SeasonCampaignEvaluation {
  const { opportunity } = input;
  if (input.blockIndex < 0 || input.blockIndex > 7) {
    throw new SeasonCampaignEvaluationError(
      `blockIndex ${String(input.blockIndex)} out of range for evaluation`,
    );
  }
  if (opportunity.blockIndex !== input.blockIndex) {
    throw new SeasonCampaignEvaluationError(
      `opportunity block ${String(opportunity.blockIndex)} mismatches evaluation block ${String(input.blockIndex)}`,
    );
  }
  const targetRes = evaluateCondition(opportunity.target, input);
  const breakthroughRes = opportunity.breakthrough
    ? evaluateCondition(opportunity.breakthrough, input)
    : null;
  let outcome: 'missed' | 'completed' | 'breakthrough' = 'missed';
  let appliedRewardIds: string[] = [];
  if (breakthroughRes?.met) {
    outcome = 'breakthrough';
    appliedRewardIds = [
      opportunity.completedReward.rewardId,
      opportunity.breakthroughReward?.rewardId,
    ].filter(Boolean) as string[];
  } else if (targetRes.met) {
    outcome = 'completed';
    appliedRewardIds = [opportunity.completedReward.rewardId];
  } else {
    outcome = 'missed';
    appliedRewardIds = [];
  }
  const facts: Record<string, unknown> = {
    target: {
      kind: opportunity.target.kind,
      threshold: opportunity.target.threshold,
      operator: opportunity.target.comparisonOperator,
      met: targetRes.met,
      value: targetRes.factValue,
      ...targetRes.facts,
    },
    breakthrough: breakthroughRes
      ? {
          kind: opportunity.breakthrough?.kind,
          threshold: (opportunity.breakthrough as SeasonCampaignCondition).threshold,
          met: breakthroughRes.met,
          value: breakthroughRes.factValue,
          ...breakthroughRes.facts,
        }
      : null,
    blockGames: humanBlockSummaries(input).length,
    humanFranchiseId: input.humanFranchiseId,
  };
  const breakthroughThreshold = opportunity.breakthrough ? opportunity.breakthrough.threshold : 0;
  const explanation =
    outcome === 'breakthrough'
      ? `${opportunity.target.kind} ${String(targetRes.factValue)} meets ${String(opportunity.target.threshold)} and breakthrough ${String(breakthroughRes?.factValue)} meets ${String(breakthroughThreshold)}`
      : outcome === 'completed'
        ? `${opportunity.target.kind} ${String(targetRes.factValue)} meets ${String(opportunity.target.threshold)}`
        : `${opportunity.target.kind} ${String(targetRes.factValue)} misses ${String(opportunity.target.threshold)}`;
  return {
    opportunityId: opportunity.opportunityId,
    blockIndex: input.blockIndex,
    outcome,
    facts,
    appliedRewardIds,
    explanation: explanation.slice(0, 1024),
  };
}
export interface SeasonCampaignRewardApplicationInput {
  evaluation: SeasonCampaignEvaluation;
  opportunity: SeasonCampaignOpportunity;
  influence: SeasonInfluenceState;
  campaignState: SeasonCampaignState;
  humanFranchiseId: string | null;
  blockIndex: number;
  commandId?: string | null;
}
export interface SeasonCampaignRewardApplicationResult {
  influence: SeasonInfluenceState;
  campaignState: SeasonCampaignState;
  transactions: SeasonTransactionEntry[];
  ledgerEntries: SeasonInfluenceState['ledger'];
}
function applyInfluenceReward(
  influence: SeasonInfluenceState,
  franchiseId: string,
  requestedDelta: number,
  blockIndex: number,
  commandId: string | null,
  explanation: string,
  rewardId: string,
): {
  influence: SeasonInfluenceState;
  entry: SeasonInfluenceState['ledger'][number];
} {
  const balanceBefore = influence.balances[franchiseId] ?? 0;
  let appliedDelta = requestedDelta;
  if (balanceBefore + requestedDelta > SEASON_INFLUENCE_CAP) {
    appliedDelta = Math.max(0, SEASON_INFLUENCE_CAP - balanceBefore);
  }
  if (balanceBefore + requestedDelta < SEASON_INFLUENCE_FLOOR) {
    appliedDelta = SEASON_INFLUENCE_FLOOR - balanceBefore;
  }
  const balanceAfter = balanceBefore + appliedDelta;
  const entry = {
    entryId: deriveSeasonInfluenceEntryId(
      `influence-campaign-${String(blockIndex)}-${franchiseId}-${rewardId}`,
    ),
    franchiseId,
    source: 'campaign-reward' as const,
    blockIndex,
    commandId,
    requestedDelta,
    appliedDelta,
    balanceAfter,
    explanation,
  };
  const balances = { ...influence.balances, [franchiseId]: balanceAfter };
  const ledger = [...influence.ledger, entry];
  return { influence: { ...influence, balances, ledger }, entry };
}
export function applySeasonCampaignReward(
  input: SeasonCampaignRewardApplicationInput,
): SeasonCampaignRewardApplicationResult {
  const { evaluation, opportunity, humanFranchiseId, blockIndex } = input;
  let influence = input.influence;
  let campaignState = input.campaignState;
  const transactions: SeasonTransactionEntry[] = [];
  const ledgerEntries: SeasonInfluenceState['ledger'] = [];
  if (evaluation.outcome === 'missed') {
    const branchState = { ...campaignState.branchState, [opportunity.branchId]: 'missed' as const };
    campaignState = {
      ...campaignState,
      branchState,
      evaluations: [...campaignState.evaluations, evaluation],
    };
    return { influence, campaignState, transactions, ledgerEntries };
  }
  const rewardsToApply: SeasonCampaignReward[] = [];
  if (evaluation.outcome === 'completed' || evaluation.outcome === 'breakthrough') {
    rewardsToApply.push(opportunity.completedReward);
  }
  if (evaluation.outcome === 'breakthrough' && opportunity.breakthroughReward) {
    rewardsToApply.push(opportunity.breakthroughReward);
  }
  let rewardEntitlements = { ...campaignState.rewardEntitlements };
  const appliedRewardIds = [...campaignState.appliedRewardIds];
  let newBranchState = { ...campaignState.branchState };
  for (const reward of rewardsToApply) {
    if (appliedRewardIds.includes(reward.rewardId)) continue;
    appliedRewardIds.push(reward.rewardId);
    switch (reward.type) {
      case 'influence': {
        if (humanFranchiseId === null) break;
        const requested = reward.amount;
        const res = applyInfluenceReward(
          influence,
          humanFranchiseId,
          requested,
          blockIndex,
          input.commandId ?? null,
          `Campaign reward ${reward.rewardId} (+${String(requested)} Influence)`,
          reward.rewardId,
        );
        influence = res.influence;
        ledgerEntries.push(res.entry);
        rewardEntitlements = {
          ...rewardEntitlements,
          influenceEarned: rewardEntitlements.influenceEarned + res.entry.appliedDelta,
        };
        transactions.push(
          seasonTransactionEntry({
            transactionId: `txn-campaign-${reward.rewardId}`,
            commandId: input.commandId ?? null,
            franchiseId: humanFranchiseId,
            type: 'campaign-reward',
            blockIndex,
            appliedAtStateRevision: 0,
            payload: {
              rewardId: reward.rewardId,
              type: reward.type,
              requestedDelta: requested,
              appliedDelta: res.entry.appliedDelta,
            },
            explanation: res.entry.explanation,
          }),
        );
        break;
      }
      case 'trade-board-information':
        rewardEntitlements = {
          ...rewardEntitlements,
          informationBenefits: rewardEntitlements.informationBenefits + reward.amount,
        };
        break;
      case 'trade-inquiry-credit':
        rewardEntitlements = {
          ...rewardEntitlements,
          inquiryCredits: rewardEntitlements.inquiryCredits + reward.amount,
        };
        break;
      case 'follow-up-unlock':
        rewardEntitlements = {
          ...rewardEntitlements,
          followUpUnlocks: [...rewardEntitlements.followUpUnlocks, reward.rewardId],
        };
        newBranchState = { ...newBranchState, [opportunity.branchId]: 'open' as const };
        break;
    }
  }
  if (evaluation.outcome === 'completed') {
    newBranchState = { ...newBranchState, [opportunity.branchId]: 'open' as const };
  } else if (evaluation.outcome === 'breakthrough') {
    newBranchState = { ...newBranchState, [opportunity.branchId]: 'completed' as const };
  }
  campaignState = {
    ...campaignState,
    evaluations: [...campaignState.evaluations, evaluation],
    branchState: newBranchState,
    rewardEntitlements,
    appliedRewardIds,
  };
  return { influence, campaignState, transactions, ledgerEntries };
}
export interface SeasonCampaignEvolutionGenerationInput {
  rootSeed: string;
  blockIndex: number;
  humanFranchiseId: string | null;
  campaignState: SeasonCampaignState;
  standings: SeasonStandings;
  rosters: readonly SeasonRoster[];
  health: SeasonHealthState;
  transactions: readonly SeasonTransactionEntry[];
  summaries: readonly SeasonGameSummary[];
}
export function generateSeasonCampaignEvolutionOffers(
  input: SeasonCampaignEvolutionGenerationInput,
): SeasonCampaignEvolutionOffer[] {
  if (input.blockIndex !== 4) {
    throw new SeasonCampaignGenerationError('evolution only after block 4', input.blockIndex, [
      'evolution requires block 4',
    ]);
  }
  if (input.campaignState.evolutionOffers !== null) {
    return input.campaignState.evolutionOffers;
  }
  const identity = effectiveIdentity(input.campaignState);
  if (identity === null) {
    throw new SeasonCampaignGenerationError(
      'evolution requires starting identity',
      input.blockIndex,
      ['no starting identity'],
    );
  }
  const offers: SeasonCampaignEvolutionOffer[] = [];
  const doubleSeed = seasonNamespaceSeed(input.rootSeed, 'campaign', 'evolution', 'double-down');
  offers.push({
    offerId: hexId('evo', doubleSeed),
    kind: 'double-down',
    evidence: `Stay ${identity}, build on branch progress ${String(Object.keys(input.campaignState.branchState).length)} branches`,
    resultingIdentity: identity,
    resultingFocus: effectiveFocus(input.campaignState),
  });
  const hasNewPlayer = input.transactions.some(
    (t) => t.type === 'trade' || t.type === 'free-agent-signing',
  );
  const injuredCount = input.health.injuries.filter((i) => i.missedGamesRemaining > 0).length;
  const humanRow = input.humanFranchiseId
    ? input.standings.rows.find((r) => r.franchiseId === input.humanFranchiseId)
    : null;
  const highStanding = humanRow ? humanRow.wins >= 5 : false;
  if (hasNewPlayer || injuredCount > 2) {
    const adaptSeed = seasonNamespaceSeed(input.rootSeed, 'campaign', 'evolution', 'adapt');
    const focus: SeasonCampaignFocus = hasNewPlayer ? 'depth' : 'defense';
    offers.push({
      offerId: hexId('evo', adaptSeed),
      kind: 'adapt',
      evidence: hasNewPlayer
        ? `Roster added ${String(input.transactions.length)} transactions, deepen depth focus`
        : `Injuries ${String(injuredCount)} active, adapt defense focus`,
      resultingIdentity: identity,
      resultingFocus: focus,
    });
  } else if (highStanding) {
    const adaptSeed = seasonNamespaceSeed(input.rootSeed, 'campaign', 'evolution', 'adapt-alt');
    offers.push({
      offerId: hexId('evo', adaptSeed),
      kind: 'adapt',
      evidence: `Strong record ${String(humanRow?.wins ?? 0)}-${String(humanRow?.losses ?? 0)}, add shooting focus`,
      resultingIdentity: identity,
      resultingFocus: 'shooting',
    });
  }
  if (offers.length < 3) {
    const pivotIdentities: SeasonCampaignGmIdentity[] = (
      ['win-now', 'player-development', 'team-identity'] as const
    ).filter((id) => id !== identity);
    const seed = seasonNamespaceSeed(input.rootSeed, 'campaign', 'evolution', 'pivot');
    const rng = createRng(seed);
    const pivotIdentity = rng.pick(pivotIdentities);
    const pivotSeed = seasonNamespaceSeed(
      input.rootSeed,
      'campaign',
      'evolution',
      'pivot',
      pivotIdentity,
    );
    const focusForPivot: SeasonCampaignFocus | null =
      pivotIdentity === 'team-identity' ? 'ball-movement' : null;
    offers.push({
      offerId: hexId('evo', pivotSeed),
      kind: 'pivot',
      evidence: `Pivot from ${identity} to ${pivotIdentity} based on roster evolution`,
      resultingIdentity: pivotIdentity,
      resultingFocus: focusForPivot,
    });
  }
  const canonical = [...offers].sort((a, b) => (a.offerId < b.offerId ? -1 : 1));
  canonical.sort((a, b) => {
    if (a.kind === 'double-down' && b.kind !== 'double-down') return -1;
    if (b.kind === 'double-down' && a.kind !== 'double-down') return 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.offerId < b.offerId ? -1 : 1;
  });
  return canonical.slice(0, 3);
}
export interface SeasonCampaignEvolutionSelectionInput {
  campaignState: SeasonCampaignState;
  offerId: string;
  commandId: string;
}
export function applySeasonCampaignEvolutionSelection(
  input: SeasonCampaignEvolutionSelectionInput,
): SeasonCampaignState {
  if (input.campaignState.evolutionOffers === null) {
    throw new SeasonCampaignGenerationError('no evolution offers to select', 4, [
      'evolutionOffers null',
    ]);
  }
  if (input.campaignState.evolutionSelection !== null) {
    throw new SeasonCampaignGenerationError('evolution already selected', 4, ['already selected']);
  }
  const offer = input.campaignState.evolutionOffers.find((o) => o.offerId === input.offerId);
  if (!offer)
    throw new SeasonCampaignGenerationError(`evolution offer ${input.offerId} not found`, 4, [
      'not offered',
    ]);
  return {
    ...input.campaignState,
    evolutionSelection: {
      selectedOfferId: offer.offerId,
      kind: offer.kind,
      resultingIdentity: offer.resultingIdentity,
      resultingFocus: offer.resultingFocus,
      selectedByCommandId: input.commandId,
    },
  };
}
export function auditCampaignOpportunity(opportunity: SeasonCampaignOpportunity): string[] {
  const failures: string[] = [];
  if (opportunity.blockIndex < 0 || opportunity.blockIndex > 7)
    failures.push('blockIndex out of range');
  if (opportunity.seedPath[0] !== 'campaign') failures.push('seedPath must start with campaign');
  if (Object.keys(opportunity.feasibilityFacts).length === 0)
    failures.push('feasibilityFacts empty');
  return failures;
}
export function isCampaignAvailableForBlock(blockIndex: number): boolean {
  return blockIndex >= 0 && blockIndex <= 7;
}
