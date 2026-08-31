import { describe, expect, it, vi } from 'vitest';
import type { SeasonHealthState, SeasonInfluenceState, SeasonRun } from '@hoop-rush/data-contracts';
vi.mock('@hoop-rush/engine', () => ({
  seasonObjectiveChoicesForBlock: (_rootSeed: string, blockIndex: number) =>
    blockIndex === 0
      ? (['win-six', 'defense-108', 'turnover-130'] as const)
      : (['bench-320', 'rebound-plus-20', 'availability-eight'] as const),
}));
import {
  canAffordSpend,
  currentObjectiveBlock,
  influenceViewModel,
  objectiveChoicesViewModel,
} from './season-influence-view';
const FRANCHISE = 'lakers';
function influenceState(overrides: Partial<SeasonInfluenceState> = {}): SeasonInfluenceState {
  return {
    schemaVersion: 1,
    influenceVersion: 'season-influence-v2',
    balances: { [FRANCHISE]: 3, celtics: 2 },
    ledger: [
      {
        entryId: 'e-1',
        franchiseId: FRANCHISE,
        source: 'initial-grant',
        blockIndex: null,
        commandId: null,
        requestedDelta: 2,
        appliedDelta: 2,
        balanceAfter: 2,
        explanation: 'Initial +2 Influence grant at run creation',
      },
      {
        entryId: 'e-2',
        franchiseId: FRANCHISE,
        source: 'block-grant',
        blockIndex: 0,
        commandId: 'grant-0',
        requestedDelta: 1,
        appliedDelta: 1,
        balanceAfter: 3,
        explanation: 'Block grant',
      },
    ],
    windows: { [FRANCHISE]: [{ windowIndex: 0, extraOfferSpent: false }] },
    rehabs: {},
    ...overrides,
  };
}
function healthWithInjuries(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: 'season-health-v2',
    injuries: [
      {
        injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        playerVersionId: 'pv-00000000000000000000000000000000',
        franchiseId: FRANCHISE,
        gameId: 's000001',
        type: 'soft-tissue',
        severity: 'moderate',
        occurredBeforeHalftime: false,
        sameGameReturn: false,
        sameGameReturned: null,
        missedGamesTotal: 6,
        missedGamesRemaining: 4,
        actualReturnRound: null,
        seasonEnding: false,
        rehabModifier: 0,
        recurrenceWindowRoundsRemaining: 0,
        seedPath: ['test', 'health'],
      },
    ],
  };
}
function runWithObjectives(selections: SeasonRun['objectives']['selections']): SeasonRun {
  return {
    rootSeed: 'a'.repeat(32),
    cursor: { schemaVersion: 1, completedRounds: 0 },
    objectives: {
      schemaVersion: 1,
      objectiveVersion: 'season-objective-v1',
      catalog: [
        {
          objectiveId: 'win-six',
          name: 'Win Six',
          description: 'Win at least 6 of the block’s team games.',
          measure: 'wins >= 6 across the block’s team games',
        },
        {
          objectiveId: 'defense-108',
          name: 'Defense 108',
          description: 'Allow at most 1,080 total points across the block.',
          measure: 'pointsAllowed <= 1080 across the block',
        },
        {
          objectiveId: 'rebound-plus-20',
          name: 'Rebound +20',
          description: 'Finish the block with at least a +20 total rebound margin.',
          measure: 'reboundMargin >= 20 across the block',
        },
        {
          objectiveId: 'availability-eight',
          name: 'Availability Eight',
          description: 'Field at least 8 available players at every tipoff.',
          measure: 'tipsWithAtLeastEightAvailable == tipsTotal',
        },
        {
          objectiveId: 'bench-320',
          name: 'Bench 320',
          description: 'Non-starters record at least 320 total minutes.',
          measure: 'benchMinutes >= 320 across the block',
        },
        {
          objectiveId: 'turnover-130',
          name: 'Turnover 130',
          description: 'Commit at most 130 turnovers across the block.',
          measure: 'turnovers <= 130 across the block',
        },
      ],
      selections,
    },
  } as unknown as SeasonRun;
}
describe('influenceViewModel', () => {
  it('reports balance, cap/floor facts, and the recent ledger', () => {
    const vm = influenceViewModel(influenceState(), FRANCHISE);
    expect(vm.balance).toBe(3);
    expect(vm.cap).toBe(8);
    expect(vm.floor).toBe(0);
    expect(vm.atCap).toBe(false);
    expect(vm.atFloor).toBe(false);
    expect(vm.recentEntries.map((entry) => entry.entryId)).toEqual(['e-2', 'e-1']);
  });
  it('offers one extra-trade-offer affordance per tracked window', () => {
    const vm = influenceViewModel(influenceState(), FRANCHISE);
    const extra = vm.affordances.filter((a) => a.purpose === 'extra-trade-offer');
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({
      windowIndex: 0,
      cost: 1,
      spent: false,
      affordable: true,
    });
  });
  it('offers a risky-rehab affordance per active injury with the player', () => {
    const vm = influenceViewModel(influenceState(), FRANCHISE, healthWithInjuries());
    const rehab = vm.affordances.find((a) => a.purpose === 'risky-rehab');
    expect(rehab).toMatchObject({
      injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      playerVersionId: 'pv-00000000000000000000000000000000',
      cost: 2,
      spent: false,
      affordable: true,
    });
  });
  it('blocks the rehab affordance after a recorded spend', () => {
    const state = influenceState({
      rehabs: {
        'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
          franchiseId: FRANCHISE,
          outcome: 'success',
          commandId: 'inf-1',
        },
      },
    });
    const vm = influenceViewModel(state, FRANCHISE, healthWithInjuries());
    const rehab = vm.affordances.find((a) => a.purpose === 'risky-rehab');
    expect(rehab?.spent).toBe(true);
    expect(rehab?.affordable).toBe(false);
    expect(rehab?.rehabOutcome).toBe('success');
  });
  it('rejects an unaffordable spend (floor 0)', () => {
    const state = influenceState({ balances: { [FRANCHISE]: 0, celtics: 2 } });
    const vm = influenceViewModel(state, FRANCHISE, healthWithInjuries());
    const rehab = vm.affordances.find((a) => a.purpose === 'risky-rehab');
    expect(rehab?.affordable).toBe(false);
    expect(vm.atFloor).toBe(true);
    expect(canAffordSpend(0, 2)).toBe(false);
    expect(canAffordSpend(1, 2)).toBe(false);
    expect(canAffordSpend(2, 2)).toBe(true);
  });
  it('marks the cap', () => {
    const state = influenceState({ balances: { [FRANCHISE]: 8, celtics: 2 } });
    const vm = influenceViewModel(state, FRANCHISE);
    expect(vm.atCap).toBe(true);
  });
});
describe('objectiveChoicesViewModel / currentObjectiveBlock', () => {
  it('offers the mocked three-choice set with the catalog names', () => {
    const vm = objectiveChoicesViewModel(runWithObjectives({}));
    expect(vm.blockIndex).toBe(0);
    expect(vm.choices.map((choice) => choice.objectiveId)).toEqual([
      'win-six',
      'defense-108',
      'turnover-130',
    ]);
    expect(vm.choices[0]).toMatchObject({
      name: 'Win Six',
      selected: false,
    });
    expect(vm.selectedObjectiveId).toBeNull();
    expect(vm.success).toBeNull();
  });
  it('keeps the current block after a selection until that block is simulated', () => {
    const run = runWithObjectives({
      '0': { objectiveId: 'win-six', selectedByCommandId: 'obj-1', success: null },
    });
    expect(currentObjectiveBlock(run)).toBe(0);
    const vm = objectiveChoicesViewModel(run);
    expect(vm.blockIndex).toBe(0);
    expect(vm.selectedObjectiveId).toBe('win-six');
    expect(vm.choices.find((choice) => choice.objectiveId === 'win-six')?.selected).toBe(true);
  });
  it('advances to the next block after the cursor moves', () => {
    const run = runWithObjectives({
      '0': { objectiveId: 'win-six', selectedByCommandId: 'obj-1', success: true },
    });
    run.cursor.completedRounds = 10;
    expect(currentObjectiveBlock(run)).toBe(1);
    const vm = objectiveChoicesViewModel(run);
    expect(vm.blockIndex).toBe(1);
    expect(vm.selectedObjectiveId).toBeNull();
    expect(vm.lastEvaluation).toMatchObject({
      blockIndex: 0,
      objectiveId: 'win-six',
      name: 'Win Six',
      success: true,
    });
  });
  it('returns no block on the final two-game block or when the season is complete', () => {
    const blockEight = runWithObjectives({});
    blockEight.cursor.completedRounds = 80;
    expect(currentObjectiveBlock(blockEight)).toBeNull();
    const complete = runWithObjectives({});
    complete.cursor.completedRounds = 82;
    expect(currentObjectiveBlock(complete)).toBeNull();
  });
});
