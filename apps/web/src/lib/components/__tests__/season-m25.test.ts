import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type {
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInjuryRecord,
  SeasonInvalidRosterInterruption,
  SeasonPendingBlockCandidate,
  SeasonRun,
  SeasonTradeOffer,
} from '@hoop-rush/data-contracts';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import HealthStrip from '$lib/components/season/HealthStrip.svelte';
import InjuryTimeline from '$lib/components/season/InjuryTimeline.svelte';
import InfluencePanel from '$lib/components/season/InfluencePanel.svelte';
import InterruptionPanel from '$lib/components/season/InterruptionPanel.svelte';
import ObjectivePicker from '$lib/components/season/ObjectivePicker.svelte';
import TradeOffersPanel from '$lib/components/season/TradeOffersPanel.svelte';
import CheckpointRecap from '$lib/components/season/CheckpointRecap.svelte';
import { availabilityStripRows, humanInjuryTimeline } from '$lib/season/season-health-view';
import { influenceViewModel, type InfluenceViewModel } from '$lib/season/season-influence-view';
import { tradeOfferViewModel } from '$lib/season/season-trade-view';
import { buildManifest } from '@hoop-rush/test-fixtures';
mockSvelteKitApp();
const PLAYER_A = 'pv-00000000000000000000000000000000';
const PLAYER_B = 'pv-11111111111111111111111111111111';
const PLAYER_C = 'pv-22222222222222222222222222222222';
function injuryRecord(overrides: Partial<SeasonInjuryRecord>): SeasonInjuryRecord {
  return {
    injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    playerVersionId: PLAYER_A,
    franchiseId: 'lakers',
    gameId: 's000001',
    type: 'soft-tissue',
    severity: 'moderate',
    occurredBeforeHalftime: false,
    sameGameReturn: false,
    sameGameReturned: null,
    missedGamesTotal: 4,
    missedGamesRemaining: 3,
    actualReturnRound: null,
    seasonEnding: false,
    rehabModifier: 0,
    recurrenceWindowRoundsRemaining: 0,
    seedPath: ['test', 'health'],
    ...overrides,
  };
}
function healthState(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: 'season-health-v2',
    injuries: [
      injuryRecord({ playerVersionId: PLAYER_A, missedGamesRemaining: 2, gameId: 's000001' }),
      injuryRecord({
        injuryId: 'inj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        playerVersionId: PLAYER_B,
        severity: 'minor',
        missedGamesTotal: 2,
        missedGamesRemaining: 0,
        actualReturnRound: 10,
        recurrenceWindowRoundsRemaining: 6,
      }),
    ],
  };
}
function roster() {
  return {
    franchiseId: 'lakers',
    players: [PLAYER_A, PLAYER_B, PLAYER_C].map((playerVersionId, index) => ({
      playerVersionId,
      playerId: `p-${String(index)}`,
      franchiseId: 'lakers',
      eraId: '1990s',
      seasonKey: '1995-96',
      displayName: `Player ${String(index + 1)}`,
    })),
  };
}
function influenceState(balance: number): SeasonInfluenceState {
  return {
    schemaVersion: 1,
    influenceVersion: 'season-influence-v2',
    balances: { lakers: balance, celtics: 2 },
    ledger: [
      {
        entryId: 'e-1',
        franchiseId: 'lakers',
        source: 'block-grant',
        blockIndex: 0,
        commandId: 'grant-0',
        requestedDelta: 1,
        appliedDelta: 1,
        balanceAfter: balance,
        explanation: '+1 Influence grant for accepted block 1',
      },
    ],
    windows: { lakers: [{ windowIndex: 0, extraOfferSpent: false }] },
    rehabs: {},
  };
}
function offer(overrides: Partial<SeasonTradeOffer> = {}): SeasonTradeOffer {
  return {
    offerId: 'off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    windowIndex: 0,
    seedPath: ['test', 'trades'],
    toFranchiseId: 'lakers',
    fromFranchiseId: 'celtics',
    outgoingPlayerVersionIds: [PLAYER_A],
    incomingPlayerVersionIds: [PLAYER_B],
    outgoingHealth: [{ available: true, activeInjuryIds: [] }],
    incomingHealth: [{ available: true, activeInjuryIds: [] }],
    valueBand: { ratioBasisPoints: 960, band: '85-115', qualified: true },
    roleFit: {
      outgoingRoles: ['PG'],
      incomingRoles: ['SG'],
      notes: 'Replaces the starting point guard with a two-guard.',
    },
    rosterNeedFacts: { outgoingDepth: 3, incomingDepth: 2, notes: 'Adds guard depth.' },
    projectedRotationChanges: 'X moves to 32 minutes; Y drops to 18.',
    projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
    status: 'open',
    ...overrides,
  };
}
function runWithRosters(): SeasonRun {
  return {
    rosters: [
      { franchiseId: 'lakers', players: roster().players },
      {
        franchiseId: 'celtics',
        players: [
          {
            playerVersionId: PLAYER_B,
            playerId: 'p-2',
            franchiseId: 'celtics',
            eraId: '1980s',
            seasonKey: '1985-86',
            displayName: 'Larry',
          },
        ],
      },
    ],
  } as unknown as SeasonRun;
}
function tradeOffers() {
  return [
    tradeOfferViewModel(offer(), runWithRosters(), null, (id: string) =>
      id === 'celtics' ? 'Boston Celtics' : id,
    ),
  ];
}
function interruption(): SeasonInvalidRosterInterruption {
  return {
    code: 'invalid-roster',
    runId: 'run-1',
    blockIndex: 1,
    commandId: 'blk-1',
    nextGameId: 's000105',
    humanFranchiseId: 'lakers',
    unavailablePlayerVersionIds: [PLAYER_A, PLAYER_B],
  };
}
function pending(): SeasonPendingBlockCandidate {
  return {
    schemaVersion: 1,
    blockVersion: 'season-block-v5',
    runId: 'run-1',
    commandId: 'blk-1',
    blockIndex: 1,
    expectedRevision: 1,
    expectedStateRevision: 1,
    expectedStateDigest: '0'.repeat(32),
    objectiveId: null,
    nextGameId: 's000105',
    summaries: [],
    retainedDetails: [],
    effects: {
      schemaVersion: 2,
      playerStates: [],
      inactivePlayerStates: [],
      pairStates: [],
      archivedPairs: [],
    },
    health: healthState(),
    standings: { schemaVersion: 1, standingsVersion: 'standings-v1', rows: [] },
    teamAggregates: [],
    playerAggregates: [],
    rotationDigest: 'b'.repeat(32),
  };
}
describe('HealthStrip', () => {
  it('renders statuses, return range, recurrence chip, and consequences', () => {
    const rows = availabilityStripRows(healthState(), roster(), [
      { gameId: 's000001', round: 1 },
      { gameId: 's000101', round: 11 },
      { gameId: 's000102', round: 12 },
    ]);
    const { container } = render(HealthStrip, { props: { rows } });
    const text = container.textContent;
    expect(text).toContain('Player 1');
    expect(text).toContain('Out');
    expect(text).toContain('back around R12');
    expect(text).toContain('Recurrence risk');
    expect(text).toContain('Available');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      '1 player out, 1 returning from injury',
    );
  });
});
describe('InjuryTimeline', () => {
  it('renders per-player history with severity and return facts', () => {
    const players = humanInjuryTimeline(healthState(), roster(), 'lakers');
    const { container } = render(InjuryTimeline, { props: { players } });
    const text = container.textContent;
    expect(text).toContain('Player 1');
    expect(text).toContain('Soft tissue · moderate');
    expect(text).toContain('missed 4 games');
    expect(text).toContain('Recurrence risk');
  });
});
describe('ObjectivePicker', () => {
  it('renders the three choices and fires selection', async () => {
    const onSelect = vi.fn();
    render(ObjectivePicker, {
      props: {
        blockIndex: 0,
        choices: [
          {
            objectiveId: 'win-six',
            name: 'Win Six',
            description: 'Win at least 6 of the block’s team games.',
            measure: 'wins >= 6 across the block’s team games',
            selected: false,
          },
          {
            objectiveId: 'defense-108',
            name: 'Defense 108',
            description: 'Allow at most 1,080 total points.',
            measure: 'pointsAllowed <= 1080',
            selected: false,
          },
          {
            objectiveId: 'turnover-130',
            name: 'Turnover 130',
            description: 'Commit at most 130 turnovers.',
            measure: 'turnovers <= 130',
            selected: false,
          },
        ],
        selectedObjectiveId: null,
        onSelect,
      },
    });
    expect(screen.getByRole('button', { name: /Win Six/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Win Six/ }));
    expect(onSelect).toHaveBeenCalledWith('win-six');
  });
});
describe('InfluencePanel', () => {
  it('renders balance, ledger, and spend affordances; confirms a spend', async () => {
    const onSpend = vi.fn();
    const vm: InfluenceViewModel = influenceViewModel(influenceState(3), 'lakers', healthState());
    render(InfluencePanel, {
      props: {
        balance: vm.balance,
        cap: vm.cap,
        floor: vm.floor,
        atCap: vm.atCap,
        atFloor: vm.atFloor,
        entries: vm.recentEntries,
        affordances: vm.affordances,
        onSpend,
      },
    });
    const text = document.body.textContent;
    expect(text).toContain('3');
    expect(text).toContain('spendable this window');
    expect(text).toContain('Extra trade offer');
    expect(text).toContain('Risky rehab');
    const spendButton = screen.getByRole('button', { name: /Spend 1/ });
    await fireEvent.click(spendButton);
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm spend' }));
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(onSpend.mock.calls[0]?.[0]).toMatchObject({ purpose: 'extra-trade-offer', cost: 1 });
  });
  it('shows a recorded rehab outcome after the spend', () => {
    const vm: InfluenceViewModel = influenceViewModel(
      {
        ...influenceState(1),
        rehabs: {
          'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
            franchiseId: 'lakers',
            outcome: 'failure',
            commandId: 'inf-1',
          },
        },
      },
      'lakers',
      healthState(),
    );
    render(InfluencePanel, {
      props: {
        balance: vm.balance,
        cap: vm.cap,
        floor: vm.floor,
        atCap: vm.atCap,
        atFloor: vm.atFloor,
        entries: vm.recentEntries,
        affordances: vm.affordances,
        onSpend: vi.fn(),
      },
    });
    const text = document.body.textContent;
    expect(text).toContain('Outcome: failure');
  });
});
function tradePanelProps(
  offers: ReturnType<typeof tradeOffers>,
  handlers: {
    onAccept: (offerId: string) => void;
    onDecline: (offerId: string) => void;
  },
) {
  return {
    windowIndex: 0,
    offers,
    manifest: buildManifest(),
    catalog: null,
    summaries: [],
    faceOf: () => null,
    ...handlers,
  };
}
describe('TradeOffersPanel', () => {
  it('renders the offer rationale and confirms accept', async () => {
    const onAccept = vi.fn();
    render(TradeOffersPanel, {
      props: tradePanelProps(tradeOffers(), { onAccept, onDecline: vi.fn() }),
    });
    const text = document.body.textContent;
    expect(text).toContain('Boston Celtics');
    expect(text).toContain('Player 1');
    expect(text).toContain('96%');
    await fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAccept).toHaveBeenCalledWith('off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('confirms decline without accepting', async () => {
    const onDecline = vi.fn();
    render(TradeOffersPanel, {
      props: tradePanelProps(tradeOffers(), { onAccept: vi.fn(), onDecline }),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onDecline).toHaveBeenCalledWith('off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('renders the resolution of a resolved offer', () => {
    const resolved = tradeOfferViewModel(
      offer({ status: 'expired' }),
      runWithRosters(),
      null,
      (id: string) => id,
    );
    render(TradeOffersPanel, {
      props: tradePanelProps([resolved], { onAccept: vi.fn(), onDecline: vi.fn() }),
    });
    const text = document.body.textContent;
    expect(text).toContain('Expired when block 3 locked');
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });
});
describe('InterruptionPanel', () => {
  it('lists unavailable players, the three paths, and resumes', async () => {
    const onResume = vi.fn();
    const onForfeit = vi.fn();
    const onRehab = vi.fn();
    const vm: InfluenceViewModel = influenceViewModel(influenceState(3), 'lakers', healthState());
    render(InterruptionPanel, {
      props: {
        interruption: interruption(),
        pending: pending(),
        playerName: (id: string) =>
          id === PLAYER_A ? 'Player 1' : id === PLAYER_B ? 'Player 2' : id,
        injuryPlayerName: (injuryId: string) =>
          injuryId === 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ? 'Player 1' : injuryId,
        rehabAffordances: vm.affordances.filter((a) => a.purpose === 'risky-rehab'),
        balance: vm.balance,
        onRehab,
        onForfeit,
        onResume,
      },
    });
    const text = document.body.textContent;
    expect(text).toContain('no legal five');
    expect(text).toContain('Player 1');
    expect(text).toContain('Player 2');
    expect(text).toContain('1 · Repair the rotation');
    expect(text).toContain('2 · Risky rehab');
    expect(text).toContain('3 · Forfeit the next game');
    expect(screen.getByRole('link', { name: /Open Rotation/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Forfeit game s000105/ }));
    expect(screen.getByRole('heading', { name: /Forfeit game s000105\?/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Forfeit the game' }));
    expect(onForfeit).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Resume block' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
  it('renders after a reload without the typed interruption', () => {
    render(InterruptionPanel, {
      props: {
        interruption: null,
        pending: pending(),
        playerName: () => '—',
        injuryPlayerName: () => '—',
        rehabAffordances: [],
        balance: 0,
        onRehab: vi.fn(),
        onForfeit: vi.fn(),
        onResume: vi.fn(),
      },
    });
    const text = document.body.textContent;
    expect(text).toContain('Block paused');
    expect(text).toContain('s000105');
  });
});
describe('CheckpointRecap (M2.5)', () => {
  it('renders the health strip and the injury evidence from recorded facts', () => {
    const recap: import('@hoop-rush/data-contracts').SeasonBlockRecap = {
      schemaVersion: 1,
      recapVersion: 'season-recap-v5',
      runId: 'run-1',
      blockIndex: 0,
      completedRounds: 10,
      humanRecord: null,
      standingsMovement: [],
      notablePerformances: [],
      streaks: [],
      versionSpotlights: [],
      upcomingHumanGames: [],
      injuryEvidence: {
        injuries: 3,
        bySeverity: { minor: 2, moderate: 1, major: 0, 'season-ending': 0 },
        sameGameReturns: 1,
        seasonEnding: 0,
        returnedThisBlock: 1,
        activeAtBlockEnd: 1,
        humanTeamInjuries: [],
      },
      objectiveEvidence: {
        objectiveId: 'win-six',
        success: true,
        evaluationFacts: {
          games: 10,
          wins: 7,
          pointsAllowed: 1081,
          reboundMargin: 22,
          tipsWithAtLeastEightAvailable: 10,
          tipsTotal: 10,
          benchMinutes: 340,
          turnovers: 128,
        },
      },
      tradeEvidence: { tradesAccepted: 1, influenceDelta: 1 },
      freeAgencyEvidence: {
        windowIndex: null,
        signings: [],
        influenceDelta: 0,
        seasonSignings: 0,
        seasonSpend: 0,
      },
      influenceBalance: { humanBalance: 4 },
    };
    const rows = availabilityStripRows(healthState(), roster());
    const { container } = render(CheckpointRecap, {
      props: {
        recap,
        humanRecord: null,
        franchiseName: (id: string) => id,
        playerName: (id: string) => id,
        manifest: null,
        effectsEvidence: [],
        healthRows: rows,
      },
    });
    const text = container.textContent;
    expect(text).toContain('Health');
    expect(text).toContain('Out');
    expect(text).toContain('Recurrence risk');
    expect(text).toContain('Injuries this block');
    expect(text).toContain('Injuries: 3 this block');
    expect(text).toContain('win-six');
    expect(text).toContain('Success · +1 Influence');
    expect(text).toContain('Influence +1 (now 4)');
  });
});
