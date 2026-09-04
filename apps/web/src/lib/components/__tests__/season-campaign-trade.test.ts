import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type {
  SeasonCampaignOpportunity,
  SeasonCampaignReward,
  SeasonCampaignState,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonRun,
  SeasonTradeBoardTeamProfile,
  SeasonTradeNegotiation,
  SeasonTradeValueTrend,
} from '@hoop-rush/data-contracts';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import CampaignPanel from '$lib/components/season/CampaignPanel.svelte';
import GmIdentityPicker from '$lib/components/season/GmIdentityPicker.svelte';
import EvolutionPicker from '$lib/components/season/EvolutionPicker.svelte';
import PackageBuilder from '$lib/components/season/PackageBuilder.svelte';
import NegotiationTranscript from '$lib/components/season/NegotiationTranscript.svelte';
import ValueTrendCell from '$lib/components/season/ValueTrendCell.svelte';
import TradeBoardWorkspace from '$lib/components/season/TradeBoardWorkspace.svelte';
import {
  campaignTimelineViewModel,
  formatCampaignCondition,
  formatCampaignReward,
  inquiryCounterLabel,
  packageConsequenceFacts,
  responseCauseLabel,
} from '$lib/season/season-presentation';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
mockSvelteKitApp();
function reward(
  type: SeasonCampaignReward['type'],
  amount: number,
  id: string,
): SeasonCampaignReward {
  return { rewardId: id, type, amount };
}
function opportunity(
  overrides: Partial<SeasonCampaignOpportunity> = {},
): SeasonCampaignOpportunity {
  const base: SeasonCampaignOpportunity = {
    opportunityId: 'copp-aaaaaaaa',
    branchId: 'cbr-bbbbbbbb',
    templateId: 'ctpl-cccccccc',
    blockIndex: 0,
    identity: 'win-now',
    family: 'results',
    prerequisiteId: null,
    target: {
      kind: 'block-wins',
      comparisonOperator: 'gte',
      threshold: 6,
      window: 'block',
    } as unknown as SeasonCampaignOpportunity['target'],
    breakthrough: {
      kind: 'block-wins',
      comparisonOperator: 'gte',
      threshold: 8,
      window: 'block',
    } as unknown as SeasonCampaignOpportunity['breakthrough'],
    completedReward: reward('influence', 1, 'rew-aaaaaaaaaaaaaaaa'),
    breakthroughReward: reward('trade-inquiry-credit', 1, 'rew-bbbbbbbbbbbbbbbb'),
    feasibilityFacts: { scheduleGamesInBlock: ['s000001'], branchId: 'cbr-bbbbbbbb' },
    seedPath: ['campaign', '0', 'offers', '0', 'ctpl-cccccccc'],
    ...overrides,
  };
  return base;
}
function campaignState(overrides: Partial<SeasonCampaignState> = {}): SeasonCampaignState {
  return {
    schemaVersion: 1,
    campaignVersion: 'season-campaign-v1',
    startingIdentity: null,
    startingFocus: null,
    offers: {},
    selections: {},
    evaluations: [],
    branchState: {},
    evolutionOffers: null,
    evolutionSelection: null,
    rewardEntitlements: {
      influenceEarned: 0,
      inquiryCredits: 0,
      informationBenefits: 0,
      followUpUnlocks: [],
    },
    appliedRewardIds: [],
    ...overrides,
  };
}
function runWithCampaign(campaign: SeasonCampaignState, completedRounds = 0): SeasonRun {
  return {
    runId: 'run-1',
    rootSeed: 'a'.repeat(32),
    cursor: { schemaVersion: 1, completedRounds },
    league: {
      teams: [{ franchiseId: 'lakers', control: 'human', conference: 'west', division: 'pacific' }],
    } as unknown as SeasonRun['league'],
    rosters: [
      {
        franchiseId: 'lakers',
        players: [
          {
            playerVersionId: 'pv-aaa',
            playerId: 'p1',
            franchiseId: 'lakers',
            eraId: '1990s',
            seasonKey: '1995-96',
            displayName: 'Player A',
          },
        ],
      },
    ],
    standings: { rows: [] } as unknown as SeasonRun['standings'],
    health: {
      schemaVersion: 1,
      healthVersion: 'season-health-v2',
      injuries: [],
    } as unknown as SeasonRun['health'],
    campaign: campaign as unknown as SeasonRun['campaign'],
  } as unknown as SeasonRun;
}
describe('season-presentation campaign helpers', () => {
  it('formats campaign conditions without leaking thresholds as odds', () => {
    expect(
      formatCampaignCondition({
        kind: 'block-wins',
        comparisonOperator: 'gte',
        threshold: 6,
        window: 'block',
      } as unknown as SeasonCampaignOpportunity['target']),
    ).toContain('6');
    expect(formatCampaignReward(reward('influence', 1, 'rew-aaaaaaaaaaaaaaaa'))).toContain('rew-');
  });
  it('campaignTimelineViewModel shows prior outcome + 2 cards, block 8 no opportunity', () => {
    const state = campaignState({
      startingIdentity: 'win-now',
      offers: {
        0: [
          opportunity({ opportunityId: 'copp-aaaaaaaa', blockIndex: 0 }),
          opportunity({
            opportunityId: 'copp-bbbbbbbb',
            blockIndex: 0,
            templateId: 'ctpl-dddddddd',
          }),
        ],
      },
      evaluations: [
        {
          opportunityId: 'copp-aaaaaaaa',
          blockIndex: 0,
          outcome: 'completed',
          facts: { wins: 7 },
          appliedRewardIds: ['rew-aaaaaaaaaaaaaaaa'],
          explanation: 'Won 7 games',
        },
      ],
      branchState: { 'cbr-bbbbbbbb': 'completed' },
    });
    const vm = campaignTimelineViewModel(runWithCampaign(state, 10), 1);
    expect(vm?.priorEvaluation?.outcome).toBe('completed');
    expect(vm?.branchEntries.length).toBe(1);
    expect(vm?.currentOffers.length).toBe(0);
    const vm0 = campaignTimelineViewModel(runWithCampaign(state, 0), 0);
    expect(vm0?.currentOffers.length).toBe(2);
    const vm8 = campaignTimelineViewModel(runWithCampaign(state, 80), 8);
    expect(vm8?.isBlock8NoOpportunity).toBe(true);
  });
});
describe('GmIdentityPicker', () => {
  it('renders three identities, explains no ratings change, requires focus for team-identity', async () => {
    const onSelect = vi.fn();
    render(GmIdentityPicker, { props: { onSelect } });
    expect(screen.getByText('Choose your GM identity')).toBeTruthy();
    expect(document.body.textContent).toContain('never');
    expect(document.body.textContent).toContain('ratings');
    expect(screen.getByRole('radio', { name: /Win now/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Player development/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Team identity/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('radio', { name: /Team identity/ }));
    expect(screen.getByText(/Pick a style focus/)).toBeTruthy();
    expect((screen.getByTestId('gm-identity-submit') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByLabelText('Defense'));
    expect((screen.getByTestId('gm-identity-submit') as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(screen.getByTestId('gm-identity-submit'));
    expect(onSelect).toHaveBeenCalledWith({ identity: 'team-identity', focus: 'defense' });
  });
  it('win-now submits without focus and mentions front-office reasoning', async () => {
    const onSelect = vi.fn();
    render(GmIdentityPicker, { props: { onSelect } });
    await fireEvent.click(screen.getByRole('radio', { name: /Win now/ }));
    await fireEvent.click(screen.getByTestId('gm-identity-submit'));
    expect(onSelect).toHaveBeenCalledWith({ identity: 'win-now', focus: null });
    expect(screen.getByText(/front office surfaces/)).toBeTruthy();
  });
});
describe('EvolutionPicker', () => {
  it('renders double-down plus up to 2 evidence-backed options', async () => {
    const onSelect = vi.fn();
    const offers = [
      {
        offerId: 'evo-aaaaaaaa',
        kind: 'double-down' as const,
        evidence: 'Won 7 of last 10 with current identity',
        resultingIdentity: 'win-now' as const,
        resultingFocus: null,
      },
      {
        offerId: 'evo-bbbbbbbb',
        kind: 'adapt' as const,
        evidence: 'Bench scored 320 pts — depth focus credible',
        resultingIdentity: 'win-now' as const,
        resultingFocus: 'depth' as const,
      },
      {
        offerId: 'evo-cccccccc',
        kind: 'pivot' as const,
        evidence: 'Roster now favors development',
        resultingIdentity: 'player-development' as const,
        resultingFocus: null,
      },
    ];
    render(EvolutionPicker, { props: { offers, onSelect } });
    expect(screen.getByText('Evolve your campaign')).toBeTruthy();
    expect(screen.getAllByText(/Double down/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Adapt/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pivot/).length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByLabelText(/Double down/));
    await fireEvent.click(screen.getByTestId('evolution-submit'));
    expect(onSelect).toHaveBeenCalledWith('evo-aaaaaaaa');
  });
});
describe('CampaignPanel', () => {
  it('shows prior outcome with evidence, reward id, branch state, and 2 cards', async () => {
    const state = campaignState({
      startingIdentity: 'win-now',
      startingFocus: null,
      offers: {
        1: [
          opportunity({
            opportunityId: 'copp-11111111',
            blockIndex: 1,
            family: 'style',
            identity: 'team-identity',
            target: {
              kind: 'three-point-volume',
              comparisonOperator: 'gte',
              threshold: 90,
              window: 'block',
            } as unknown as SeasonCampaignOpportunity['target'],
            completedReward: reward('trade-board-information', 1, 'rew-11111111'),
            feasibilityFacts: { scheduleGamesInBlock: ['s000011'] },
          }),
          opportunity({
            opportunityId: 'copp-22222222',
            blockIndex: 1,
            family: 'results',
            identity: 'win-now',
            target: {
              kind: 'block-wins',
              comparisonOperator: 'gte',
              threshold: 6,
              window: 'block',
            } as unknown as SeasonCampaignOpportunity['target'],
            completedReward: reward('influence', 1, 'rew-22222222'),
            feasibilityFacts: { standingRows: 30 },
          }),
        ],
      },
      evaluations: [
        {
          opportunityId: 'copp-aaaaaaaa',
          blockIndex: 0,
          outcome: 'breakthrough',
          facts: { wins: 8, threePointersMade: 95 },
          appliedRewardIds: ['rew-aaaaaaaaaaaaaaaa', 'rew-bbbbbbbbbbbbbbbb'],
          explanation: 'Breakthrough: 8 wins and hot shooting',
        },
      ],
      branchState: { 'cbr-bbbbbbbb': 'completed', 'cbr-aaaaaaaa': 'open' },
      rewardEntitlements: {
        influenceEarned: 2,
        inquiryCredits: 1,
        informationBenefits: 1,
        followUpUnlocks: ['cbr-bbbbbbbb'],
      },
      appliedRewardIds: ['rew-aaaaaaaaaaaaaaaa', 'rew-bbbbbbbbbbbbbbbb'],
    });
    const run = runWithCampaign(state, 10);
    const onSelectIdentity = vi.fn();
    const onSelectOpportunity = vi.fn();
    const onEvolve = vi.fn();
    render(CampaignPanel, {
      props: { run, nextBlockIndex: 1, onSelectIdentity, onSelectOpportunity, onEvolve },
    });
    expect(screen.getByText('Prior block result')).toBeTruthy();
    expect(screen.getAllByText('Breakthrough').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Breakthrough: 8 wins/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rew-aaaaaaaaaaaaaaaa/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/branch/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Choose one for block 2/)).toBeTruthy();
    const cards = screen.getAllByTestId(/select-opportunity-/);
    expect(cards.length).toBe(2);
    expect(document.body.textContent).toContain('ledger shows requested vs applied');
  });
  it('fresh run leads with SelectGmIdentity, explaining no ratings change', () => {
    const state = campaignState({ startingIdentity: null });
    const run = runWithCampaign(state, 0);
    render(CampaignPanel, {
      props: {
        run,
        nextBlockIndex: 0,
        onSelectIdentity: vi.fn(),
        onSelectOpportunity: vi.fn(),
        onEvolve: vi.fn(),
      },
    });
    expect(screen.getByText('Choose your GM identity')).toBeTruthy();
    expect(document.body.textContent).toContain('never');
    expect(document.body.textContent).toContain('ratings');
  });
  it('after block 4 shows Evolve before block-5 opportunities', () => {
    const state = campaignState({
      startingIdentity: 'win-now',
      offers: {},
      evolutionOffers: [
        {
          offerId: 'evo-aaaaaaaa',
          kind: 'double-down',
          evidence: 'Evidence for double-down',
          resultingIdentity: 'win-now',
          resultingFocus: null,
        },
        {
          offerId: 'evo-bbbbbbbb',
          kind: 'adapt',
          evidence: 'Evidence for adapt',
          resultingIdentity: 'win-now',
          resultingFocus: 'depth',
        },
      ],
      evaluations: [
        {
          opportunityId: 'copp-1',
          blockIndex: 4,
          outcome: 'completed',
          facts: {},
          appliedRewardIds: ['rew-1'],
          explanation: 'Completed',
        },
      ],
    });
    const run = runWithCampaign(state, 50);
    render(CampaignPanel, {
      props: {
        run,
        nextBlockIndex: 5,
        onSelectIdentity: vi.fn(),
        onSelectOpportunity: vi.fn(),
        onEvolve: vi.fn(),
      },
    });
    expect(screen.getByText('Evolve your campaign')).toBeTruthy();
    expect(screen.queryByText(/Choose one for block/)).toBeNull();
  });
  it('block 8 shows no opportunity', () => {
    const state = campaignState({ startingIdentity: 'win-now', offers: {} });
    const run = runWithCampaign(state, 80);
    render(CampaignPanel, {
      props: {
        run,
        nextBlockIndex: 8,
        onSelectIdentity: vi.fn(),
        onSelectOpportunity: vi.fn(),
        onEvolve: vi.fn(),
      },
    });
    expect(screen.getByText(/final block — no new opportunity/)).toBeTruthy();
    expect(screen.getByText(/does not open a new campaign opportunity/)).toBeTruthy();
  });
});
describe('PackageBuilder', () => {
  it('enforces 1-2/1-2, Influence one side never both, never Influence-only, shows consequence facts', async () => {
    const yourPlayers = [
      { playerVersionId: 'pv-you-1', displayName: 'You One', playable: ['PG'], available: true },
      { playerVersionId: 'pv-you-2', displayName: 'You Two', playable: ['PF'], available: true },
    ];
    const theirPlayers = [
      { playerVersionId: 'pv-them-1', displayName: 'Them One', playable: ['SF'], available: true },
      { playerVersionId: 'pv-them-2', displayName: 'Them Two', playable: ['C'], available: false },
    ];
    const onSubmit = vi.fn();
    render(PackageBuilder, {
      props: {
        yourPlayers,
        theirPlayers,
        yourRosterSize: 12,
        theirRosterSize: 13,
        yourBalance: 2,
        theirBalance: 1,
        humanFranchiseId: 'lakers',
        targetFranchiseId: 'celtics',
        targetFranchiseName: 'Boston Celtics',
        inquiryAllowance: 4,
        inquiriesUsed: 2,
        allowanceLabel: inquiryCounterLabel(4, 2, false, false),
        onSubmit,
      },
    });
    expect(screen.getByText(/Pick 1–2 from each side/)).toBeTruthy();
    expect(screen.getAllByText(/never alone/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Before submission/)).toBeTruthy();
    expect(screen.getByText(/45 active pairs per team/)).toBeTruthy();
    expect(screen.getByText(/Inquiry: 2\/4 used/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('option', { name: /You One/ }));
    await fireEvent.click(screen.getByRole('option', { name: /Them One/ }));
    expect((screen.getByTestId('package-submit') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Both sides send')).toBeNull();
    await fireEvent.click(screen.getByLabelText('You send 1'));
    expect(screen.getByText(/You 12 → 12/)).toBeTruthy();
    await fireEvent.click(screen.getByTestId('package-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      outgoing: ['pv-you-1'],
      incoming: ['pv-them-1'],
      influenceAmount: 1,
      influenceFromSender: 'lakers',
    });
  });
  it('shows availability risk and illegal roster', async () => {
    const yourPlayers = [
      { playerVersionId: 'pv-y1', displayName: 'Y1', playable: ['PG'], available: true },
    ];
    const theirPlayers = [
      { playerVersionId: 'pv-t1', displayName: 'T1', playable: ['C'], available: false },
    ];
    render(PackageBuilder, {
      props: {
        yourPlayers,
        theirPlayers,
        yourRosterSize: 10,
        theirRosterSize: 10,
        yourBalance: 0,
        theirBalance: 0,
        humanFranchiseId: 'lakers',
        targetFranchiseId: 'celtics',
        targetFranchiseName: 'Celtics',
        inquiryAllowance: 3,
        inquiriesUsed: 0,
        allowanceLabel: inquiryCounterLabel(3, 0, false, false),
        onSubmit: vi.fn(),
      },
    });
    await fireEvent.click(screen.getByRole('option', { name: /Y1/ }));
    await fireEvent.click(screen.getByRole('option', { name: /T1/ }));
    expect(screen.getByText(/Availability flag/)).toBeTruthy();
  });
});
describe('NegotiationTranscript', () => {
  it('shows 3 exchanges, categorical feedback, duplicate no increment note, walk-away no penalty without moving focus', async () => {
    const negotiation: SeasonTradeNegotiation = {
      inquiryId: 'inq-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      windowIndex: 0,
      fromFranchiseId: franchiseIdSchema.parse('lakers'),
      toFranchiseId: franchiseIdSchema.parse('celtics'),
      status: 'countered',
      exchangeCount: 2,
      exchanges: [
        {
          exchangeIndex: 1,
          kind: 'human-proposal',
          proposalId: 'prop-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          proposalFingerprint: 'a|b',
          responseCause: null,
          atStateRevision: 1,
        },
        {
          exchangeIndex: 2,
          kind: 'ai-counter',
          proposalId: null,
          proposalFingerprint: null,
          responseCause: 'close-needs-more-value',
          atStateRevision: 2,
        },
      ],
      rejectedPlayerVersionIds: ['pv-protected'],
      expressedInterests: ['Team wants shooting'],
      latestRequestedChange: 'Replace one player or add cash consideration (1–2)',
      finalReason: null,
      activeProposalId: 'prop-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const onWalkAway = vi.fn();
    render(NegotiationTranscript, {
      props: { negotiation, inquiryAllowance: 4, onWalkAway, busy: false },
    });
    expect(screen.getByText(/2\/3 exchanges/)).toBeTruthy();
    expect(screen.getByText('close needs more value')).toBeTruthy();
    expect(screen.getByText(/Duplicate fingerprint rejects do not increment/)).toBeTruthy();
    const walk = screen.getByTestId('negotiation-walkaway');
    await fireEvent.click(walk);
    expect(onWalkAway).toHaveBeenCalledWith('inq-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const walked: SeasonTradeNegotiation = {
      ...negotiation,
      status: 'walked-away',
      finalReason: 'negotiations-closed' as const,
      activeProposalId: null,
    };
    const { container: c2 } = render(NegotiationTranscript, {
      props: { negotiation: walked, inquiryAllowance: 4 },
    });
    expect(c2.textContent?.toLowerCase()).toContain('walked away');
  });
  it('announces accepted/rejected without moving focus', () => {
    const negotiation: SeasonTradeNegotiation = {
      inquiryId: 'inq-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      windowIndex: 0,
      fromFranchiseId: franchiseIdSchema.parse('lakers'),
      toFranchiseId: franchiseIdSchema.parse('celtics'),
      status: 'accepted',
      exchangeCount: 1,
      exchanges: [
        {
          exchangeIndex: 1,
          kind: 'human-proposal',
          proposalId: 'prop-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          proposalFingerprint: 'a|b',
          responseCause: 'acceptable',
          atStateRevision: 1,
        },
      ],
      rejectedPlayerVersionIds: [],
      expressedInterests: [],
      latestRequestedChange: null,
      finalReason: 'acceptable',
      activeProposalId: null,
    };
    render(NegotiationTranscript, { props: { negotiation, inquiryAllowance: 3 } });
    expect(screen.getByText(/Accepted — ownership will transfer/)).toBeTruthy();
  });
});
describe('ValueTrendCell', () => {
  it('shows rising/stable/falling without Overall', () => {
    render(ValueTrendCell, {
      props: {
        trend: {
          playerVersionId: 'pv-aaa',
          trend: 'rising',
          basis: 'Averaging 22 pts on high usage, durable minutes',
        },
        basis: 'Averaging 22 pts on high usage, durable minutes',
        playerName: 'Player A',
      },
    });
    expect(screen.getByText('Rising')).toBeTruthy();
    expect(screen.queryByText(/Overall/)).toBeNull();
    expect(screen.queryByText(/860/)).toBeNull();
  });
});
describe('TradeBoardWorkspace distinctive design & a11y', () => {
  it('renders board 8, inquiry counters, package builder constraints, and history', () => {
    const run = {
      rosters: [
        {
          franchiseId: 'lakers',
          players: [{ playerVersionId: 'pv-l-1', displayName: 'Laker One' }],
        },
        {
          franchiseId: 'celtics',
          players: [
            { playerVersionId: 'pv-c-1', displayName: 'Celtic One' },
            { playerVersionId: 'pv-c-2', displayName: 'Celtic Two' },
          ],
        },
      ],
      trade: {
        windows: [
          {
            windowIndex: 0,
            blockIndex: 2,
            status: 'open',
            offers: [],
            inquiryAllowance: 4,
            purchasedInquiryUsed: false,
            earnedInquiryUsed: false,
            activeInquiryId: null,
            negotiations: [],
            boardProfiles: [],
            valueTrends: [],
          },
        ],
      },
      influence: { balances: { lakers: 3, celtics: 2 } },
    } as unknown as SeasonRun;
    const profiles: SeasonTradeBoardTeamProfile[] = [
      {
        franchiseId: franchiseIdSchema.parse('celtics'),
        needs: ['shooting', 'depth'],
        priority: 'fit',
        listedPlayerIds: ['pv-c-1'],
        discussablePlayerIds: ['pv-c-1', 'pv-c-2'],
        protectedPlayerIds: ['pv-c-protected'],
        hardConstraints: ['Roster must stay 10-15', 'Protected: pv-c-protected'],
        rationale: 'Needs shooting based on roster gaps; priority fit',
        competitorInterest: { 'pv-c-1': 'possible' },
      },
    ];
    const manifest = buildManifest();
    render(TradeBoardWorkspace, {
      props: {
        run,
        catalog: null,
        manifest,
        windowState: {
          windowIndex: 0,
          blockIndex: 2,
          status: 'open',
          offers: [],
          boardProfiles: profiles,
          inquiryAllowance: 4,
          purchasedInquiryUsed: false,
          earnedInquiryUsed: false,
          activeInquiryId: null,
          negotiations: [],
        },
        boardProfiles: profiles,
        negotiations: [],
        valueTrends: [{ playerVersionId: 'pv-l-1', trend: 'rising', basis: 'High production' }],
        humanFranchiseId: 'lakers',
        humanBalance: 3,
        onOpenInquiry: vi.fn(),
        onSubmitProposal: vi.fn(),
        onRespond: vi.fn(),
        onWalkAway: vi.fn(),
        onPurchaseInquiry: vi.fn(),
        playerName: (id: string) => (id === 'pv-c-1' ? 'Celtic One' : id),
        playableOf: () => ['SF'],
        availableOf: () => true,
      },
    });
    expect(screen.getByText('Trade Board')).toBeTruthy();
    expect(screen.getByText(/3 base \+ 1 extra/)).toBeTruthy();
    expect(screen.getByTestId('board-team-celtics')).toBeTruthy();
    expect(screen.getByText(/Shooting \/ Depth/)).toBeTruthy();
    expect(screen.getByText(/Priority: Fit/)).toBeTruthy();
    expect(screen.getAllByText(/Listed:/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Protected:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Hard constraints/)).toBeTruthy();
    expect(document.body.textContent?.toLowerCase()).toContain('possible');
    expect(screen.getByText(/Your value trends/)).toBeTruthy();
    expect(screen.getByText('Rising')).toBeTruthy();
    expect(screen.getByText(/0\/4 used/)).toBeTruthy();
    expect(screen.getByText('Pick a team')).toBeTruthy();
  });
  it('keyboard operable and responsive', async () => {
    const profiles: SeasonTradeBoardTeamProfile[] = [
      {
        franchiseId: franchiseIdSchema.parse('celtics'),
        needs: ['shooting'],
        priority: 'talent',
        listedPlayerIds: ['pv-c-1'],
        discussablePlayerIds: ['pv-c-1'],
        protectedPlayerIds: ['pv-p'],
        hardConstraints: ['Roster must stay 10-15'],
        rationale: 'Needs shooting',
      },
    ];
    const run = {
      rosters: [
        { franchiseId: 'lakers', players: [] },
        { franchiseId: 'celtics', players: [] },
      ],
      trade: { windows: [] },
      influence: { balances: { lakers: 2 } },
    } as unknown as SeasonRun;
    render(TradeBoardWorkspace, {
      props: {
        run,
        catalog: null,
        manifest: buildManifest(),
        windowState: {
          windowIndex: 0,
          blockIndex: 2,
          status: 'open',
          offers: [],
          boardProfiles: profiles,
        } as unknown as any,
        boardProfiles: profiles,
        negotiations: [],
        valueTrends: [],
        humanFranchiseId: 'lakers',
        humanBalance: 2,
        onOpenInquiry: vi.fn(),
        onSubmitProposal: vi.fn(),
        onRespond: vi.fn(),
        onWalkAway: vi.fn(),
        onPurchaseInquiry: vi.fn(),
      },
    });
    const btn = screen.getByTestId('board-team-celtics');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await fireEvent.keyDown(btn, { key: 'Enter' });
    await fireEvent.click(btn);
    expect(screen.getByText(/Build package/)).toBeTruthy();
  });
  it('categorical feedback never shows Overall or ratio', () => {
    expect(responseCauseLabel('acceptable')).toBe('acceptable');
    expect(responseCauseLabel('close-needs-more-value')).toBe('close needs more value');
    expect(
      packageConsequenceFacts({
        fromRosterSize: 12,
        toRosterSize: 12,
        outgoingIds: ['a'],
        incomingIds: ['b'],
        outgoingAvailable: [true],
        incomingAvailable: [true],
        influenceAmount: 0,
        influenceFromSender: null,
        humanFranchiseId: 'lakers',
        toFranchiseId: 'celtics',
      }).influenceNote,
    ).not.toContain('Overall');
  });
});
