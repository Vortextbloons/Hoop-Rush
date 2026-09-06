import { describe, expect, it } from 'vitest';
import {
  draftStageOf,
  humanizeCoverageReason,
  humanizeDraftError,
  humanizeDraftGenerationError,
} from './season-draft-flow';
import {
  humanizeBlockSubmitFailure,
  isInnovationRequired,
  seasonBlockReadinessOf,
} from './season-block-submit';
import {
  blockOneLiner,
  campaignHistoryOf,
  campaignOpportunityCardsOf,
  formatCampaignReward,
  recordRankOutLabel,
} from './season-presentation';
import { influenceViewModel } from './season-influence-view';
import {
  riskyRehabOptionsOf,
  SEASON_POSTSEASON_REHAB_COST,
} from './season-postseason-presentation';
import { rehabPriceOf } from '@hoop-rush/engine';
import {
  SEASON_INFLUENCE_CAP,
  franchiseIdSchema,
  type SeasonCampaignState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRun,
} from '@hoop-rush/data-contracts';

describe('M3.11.1 DraftStage maps 1:1', () => {
  it('maps executive when no draft', () => {
    expect(
      draftStageOf({
        draftStatus: 'none',
        phase: 'idle',
        generationError: null,
        hasGeneration: false,
      }),
    ).toBe('executive');
  });
  it('maps drafting', () => {
    expect(
      draftStageOf({
        draftStatus: 'drafting',
        phase: 'drafting',
        generationError: null,
        hasGeneration: false,
      }),
    ).toBe('drafting');
  });
  it('maps ready when finalized', () => {
    expect(
      draftStageOf({
        draftStatus: 'finalized',
        phase: 'finalized',
        generationError: null,
        hasGeneration: false,
      }),
    ).toBe('ready');
  });
  it('maps generating', () => {
    expect(
      draftStageOf({
        draftStatus: 'finalized',
        phase: 'generating',
        generationError: null,
        hasGeneration: false,
      }),
    ).toBe('generating');
  });
  it('maps stalled when generation error (draft saved)', () => {
    expect(
      draftStageOf({
        draftStatus: 'finalized',
        phase: 'finalized',
        generationError: 'worker failed',
        hasGeneration: false,
      }),
    ).toBe('stalled');
    expect(humanizeDraftGenerationError('worker failed')).toContain('draft is saved');
  });
  it('maps complete only with generation', () => {
    expect(
      draftStageOf({
        draftStatus: 'complete',
        phase: 'complete',
        generationError: null,
        hasGeneration: true,
      }),
    ).toBe('complete');
    expect(
      draftStageOf({
        draftStatus: 'complete',
        phase: 'complete',
        generationError: null,
        hasGeneration: false,
      }),
    ).toBe('executive');
  });
  it('humanizes coverage and async errors without internals', () => {
    expect(
      humanizeCoverageReason(
        'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
      ),
    ).toContain('versatile');
    expect(humanizeCoverageReason(null)).toBeNull();
    expect(humanizeDraftError('NO_OFFER_DRAWN')).toContain('Draw');
    expect(humanizeDraftError('UNCOMPLETABLE_ROSTER completion targets unreachable')).toContain(
      'unfillable',
    );
    expect(humanizeDraftError(null)).toContain('Try again');
  });
});

describe('M3.11.1 readiness matches gates', () => {
  it('orders blockers rotation -> innovation -> free-agency', () => {
    const readiness = seasonBlockReadinessOf({
      rotationFailures: ['a'],
      innovationRequired: true,
      faUnresolved: true,
      faWindowIndex: 1,
    });
    expect(readiness.blockers.map((b) => b.kind)).toEqual([
      'rotation',
      'innovation',
      'free-agency',
    ]);
    expect(readiness.canPlay).toBe(false);
  });
  it('canPlay only when no blockers', () => {
    expect(
      seasonBlockReadinessOf({
        rotationFailures: [],
        innovationRequired: false,
        faUnresolved: false,
      }).canPlay,
    ).toBe(true);
  });
  it('innovation required only from block 3 with discovery and missing selection', () => {
    expect(
      isInnovationRequired(
        { evolution: { discovery: { blockIndex: 2 }, selections: {} } },
        'lakers',
        3,
      ),
    ).toBe(true);
    expect(
      isInnovationRequired(
        { evolution: { discovery: { blockIndex: 2 }, selections: {} } },
        'lakers',
        2,
      ),
    ).toBe(false);
    expect(
      isInnovationRequired({ evolution: { discovery: null, selections: {} } }, 'lakers', 3),
    ).toBe(false);
  });
  it('humanizes every submit failure code with destination', () => {
    const codes = [
      'no-run',
      'no-human-team',
      'no-editor',
      'no-next-block',
      'season-complete',
      'block-busy',
      'rotation-invalid',
      'asset-unavailable',
      'evolution-not-selected',
      'free-agency-unresolved',
    ] as const;
    for (const code of codes) {
      const human = humanizeBlockSubmitFailure(code, {
        faWindowIndex: 0,
        firstFailure: 'Too few guards',
      });
      expect(human.code).toBe(code);
      expect(human.message.length).toBeGreaterThan(5);
      expect('destination' in human).toBe(true);
    }
    expect(humanizeBlockSubmitFailure('rotation-invalid').destination).toBe('/season/run/team');
    expect(humanizeBlockSubmitFailure('free-agency-unresolved').destination).toBe(
      '/season/run/free-agency',
    );
  });
});

function influenceStateWith(balance: number, fid: string): SeasonInfluenceState {
  return {
    schemaVersion: 1,
    influenceVersion: 'season-influence-v2',
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    balances: { [fid]: balance } as SeasonInfluenceState['balances'],
    ledger: [],
    windows: {},
    rehabs: {},
  };
}
function healthWith(outCount: number, fid: string): SeasonHealthState {
  return {
    injuries: Array.from({ length: outCount }, (_, i) => ({
      injuryId: `inj-${String(i)}`,
      franchiseId: fid,
      playerVersionId: `pv-${String(i)}`,
      playerId: `p-${String(i)}`,
      gameId: 'g1',
      type: 'illness',
      severity: 'minor',
      missedGamesTotal: 2,
      missedGamesRemaining: 2,
      seasonEnding: false,
      sameGameReturn: false,
      sameGameReturned: false,
      actualReturnRound: null,
      recurrenceWindowRoundsRemaining: 0,
      rehabModifier: 0,
    })),
  } as unknown as SeasonHealthState;
}

describe('M3.11.1 rehab dynamic costs regular+postseason', () => {
  it('regular rehab cost follows rehabPriceOf (executive-aware)', () => {
    const fid = franchiseIdSchema.parse('lakers');
    const fidStr = fid as unknown as string;
    for (const executive of [null, 'alex-chen', 'morgan-vale', 'jordan-ellis'] as const) {
      const expected = rehabPriceOf(executive);
      const vm = influenceViewModel(
        influenceStateWith(8, fidStr),
        fidStr,
        healthWith(1, fidStr),
        null,
        executive,
      );
      const rehab = vm.affordances.filter((a) => a.purpose === 'risky-rehab');
      expect(rehab.length).toBeGreaterThan(0);
      for (const affordance of rehab) expect(affordance.cost).toBe(expected);
    }
  });
  it('postseason rehab uses SEASON_POSTSEASON_RISKY_REHAB_COST', () => {
    const fid = 'lakers';
    const run = {
      influence: { balances: { [fid]: 8 }, rehabs: {} },
      health: healthWith(2, fid),
    } as unknown as SeasonRun;
    const options = riskyRehabOptionsOf(run, fid, (id) => `Name ${id}`);
    expect(options.length).toBe(2);
    for (const option of options) {
      expect(option.cost).toBe(SEASON_POSTSEASON_REHAB_COST);
      expect(option.available).toBe(true);
    }
  });
  it('influence header uses cap constant', () => {
    expect(SEASON_INFLUENCE_CAP).toBe(8);
  });
});

describe('M3.11.1 Campaign/Innovation expose no internals', () => {
  function campaignRun(): SeasonRun {
    const campaign = {
      schemaVersion: 1,
      campaignVersion: 'season-campaign-v1',
      startingIdentity: null,
      startingFocus: null,
      offers: {
        0: [
          {
            opportunityId: 'opp-1',
            blockIndex: 0,
            family: 'results',
            branchId: 'branch-abc',
            target: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 3 },
            breakthrough: null,
            completedReward: { rewardId: 'r1', type: 'influence', amount: 1 },
            breakthroughReward: null,
            feasibilityFacts: { secret: 1 },
            prerequisiteId: null,
            sponsor: null,
          },
        ],
      },
      selections: {},
      evaluations: [
        {
          blockIndex: 0,
          opportunityId: 'opp-0',
          outcome: 'completed',
          explanation: 'Won enough',
          facts: {},
          appliedRewardIds: ['r0'],
        },
      ],
      branchState: {},
      evolutionOffers: null,
      evolutionSelection: null,
      rewardEntitlements: {
        influenceEarned: 0,
        inquiryCredits: 0,
        informationBenefits: 0,
        followUpUnlocks: [],
      },
      appliedRewardIds: ['r0'],
    } as unknown as SeasonCampaignState;
    return {
      cursor: { completedRounds: 0 },
      campaign,
    } as unknown as SeasonRun;
  }
  it('opportunity cards expose only target/condition/reward/selected', () => {
    const result = campaignOpportunityCardsOf(campaignRun(), 0, () => 'Unknown player');
    expect(result).not.toBeNull();
    const json = JSON.stringify(result);
    for (const banned of [
      'branchId',
      'feasibility',
      'appliedRewardIds',
      'adapter',
      'canonical',
      'requested',
      'entitlement',
      'basis',
      'rewardId',
    ]) {
      expect(json.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(result?.cards[0]?.targetLabel).toContain('Win');
    expect(result?.cards[0]?.rewardLabel).toBe('+1 Influence');
    expect(formatCampaignReward({ rewardId: 'x', type: 'influence', amount: 2 } as never)).toBe(
      '+2 Influence',
    );
  });
  it('history exposes only outcome + explanation', () => {
    const history = campaignHistoryOf(campaignRun());
    const json = JSON.stringify(history);
    for (const banned of ['branchId', 'feasibility', 'appliedRewardIds', 'adapter', 'rewardId']) {
      expect(json.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(history[0]?.outcomeLabel).toBe('Completed');
  });
  it('hub strip helpers format compact one-liners', () => {
    expect(
      recordRankOutLabel({ wins: 12, losses: 8, rank: 4, conference: 'east', outCount: 2 }),
    ).toBe('12–8 · 4th East · 2 OUT');
    expect(
      recordRankOutLabel({ wins: 12, losses: 8, rank: null, conference: null, outCount: 0 }),
    ).toBe('12–8');
    expect(blockOneLiner({ blockIndex: 3, fromRound: 28, toRound: 36, wins: 3, losses: 0 })).toBe(
      'Block 4 of 9 · Rds 28–36 · 3–0 so far',
    );
  });
});
