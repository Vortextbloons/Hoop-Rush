// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { buildManifest, buildSeasonLeague, buildSeasonRosters } from '@hoop-rush/test-fixtures';
import type {
  HoopRushManifest,
  SeasonBlockRecap,
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonRoster,
} from '@hoop-rush/data-contracts';
import UnitChemistry from '$lib/components/season/UnitChemistry.svelte';
import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
import CheckpointRecap from '$lib/components/season/CheckpointRecap.svelte';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * M2.4 season component tests: the Roster list renders fatigue bands,
 * workload, last-game minutes, and the unit-chemistry panel with the
 * strongest/weakest recorded pairs; the checkpoint recap renders the
 * mechanism-evidence section from retained-detail evidence.
 */

const MANIFEST: HoopRushManifest = buildManifest();
const ROSTER: SeasonRoster = buildSeasonRosters(
  buildSeasonLeague(),
  'roster-m24',
)[0] as SeasonRoster;

function effectsState(fatigue: number, shared: number): SeasonEffectsState {
  const playerStates = ROSTER.players.map((entry) => ({
    playerVersionId: entry.playerVersionId,
    fatigueBasisPoints: fatigue,
    recentLoadBasisPoints: 3000,
    lastCompletedRound: 10,
  }));
  const pairStates: SeasonEffectsState['pairStates'] = [];
  const ids = ROSTER.players.map((entry) => entry.playerVersionId).sort();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) continue;
      pairStates.push({ a, b, sharedPossessions: shared });
    }
  }
  return {
    schemaVersion: 1,
    playerStates,
    pairStates: pairStates.slice(0, 1350),
  };
}

function minimalShell(): SeasonRunShellData {
  return {
    ready: true,
    error: null,
    hubError: null,
    hub: null,
    snapshot: null,
    index: null,
    block: { phase: 'idle' } as never,
    manifest: MANIFEST,
    league: null,
    catalog: null,
    schedule: null,
    playerSlice: new Map(),
    playerSliceReady: true,
    facesByVersion: new Map(),
    facesReady: true,
    run: null,
    humanFranchiseId: 'lakers',
    humanTeam: null,
    nextBlockIndex: 0,
    seasonComplete: false,
    editor: null,
    editorKey: null,
    health: null,
    influence: null,
    trade: null,
    objectives: null,
    pending: null,
    interruption: null,
    commandError: null,
    externalChange: null,
    acknowledgeExternalChange: () => undefined,
    prewarmWorker: () => undefined,
    playerName: () => '',
    playablePositions: () => [],
    franchiseName: (id: string) => id,
    franchiseAbbrev: (id: string) => id,
    cancelBlock: () => undefined,
    retryBlock: () => undefined,
    refresh: () => Promise.resolve(),
    quitRun: () => Promise.resolve({ ok: true, error: null }),
    selectBlockObjective: () => Promise.resolve(),
    spendInfluence: () => Promise.resolve(),
    acceptTradeOffer: () => Promise.resolve(),
    declineTradeOffer: () => Promise.resolve(),
    forfeitInterruptedGame: () => Promise.resolve(),
    resumeBlock: () => Promise.resolve(),
    startPostseason: () => Promise.resolve(),
    advancePostseason: () => Promise.resolve(),
    submitPostseasonRotation: () => Promise.resolve(),
    spectatePostseasonGame: () => Promise.resolve(),
    fastForwardPostseason: () => Promise.resolve(),
    cancelPostseason: () => undefined,
    postseason: {
      phase: 'idle',
      gamesCompleted: 0,
      gamesTotal: 0,
      latestGameId: null,
      latestResult: null,
      error: null,
    },
  };
}

function summaryFor(seconds: number): SeasonGameSummary {
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId: 's000001',
    round: 1,
    homeFranchiseId: 'lakers',
    awayFranchiseId: 'celtics',
    status: 'final',
    overtimePeriods: 0,
    homeScore: 100,
    awayScore: 90,
    forfeitLoserFranchiseId: null,
    injuryEvents: [],
    homeBox: {
      franchiseId: 'lakers',
      points: 100,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 88,
      threePointersMade: 10,
      threePointersAttempted: 30,
      freeThrowsMade: 20,
      freeThrowsAttempted: 26,
      offensiveRebounds: 10,
      defensiveRebounds: 30,
      assists: 24,
      steals: 7,
      blocks: 5,
      turnovers: 13,
      fouls: 19,
      possessions: 96,
    },
    awayBox: {
      franchiseId: 'celtics',
      points: 90,
      fieldGoalsMade: 38,
      fieldGoalsAttempted: 86,
      threePointersMade: 9,
      threePointersAttempted: 28,
      freeThrowsMade: 19,
      freeThrowsAttempted: 25,
      offensiveRebounds: 9,
      defensiveRebounds: 29,
      assists: 22,
      steals: 8,
      blocks: 4,
      turnovers: 15,
      fouls: 21,
      possessions: 94,
    },
    homePlayers: ROSTER.players.map((entry, index) => ({
      playerVersionId: entry.playerVersionId,
      seconds: index < 5 ? seconds : 480,
      points: 10,
      fieldGoalsMade: 4,
      fieldGoalsAttempted: 9,
      threePointersMade: 1,
      threePointersAttempted: 3,
      freeThrowsMade: 1,
      freeThrowsAttempted: 2,
      offensiveRebounds: 1,
      defensiveRebounds: 3,
      assists: 2,
      steals: 1,
      blocks: 1,
      turnovers: 1,
      fouls: 2,
    })),
    awayPlayers: [],
  };
}

describe('SeasonRosterList (M2.4)', () => {
  it('renders fatigue bands, workload, and last-game minutes', () => {
    const effects = effectsState(4000, 400);
    const { container } = render(SeasonRosterList, {
      props: {
        roster: ROSTER,
        manifest: MANIFEST,
        shell: minimalShell(),
        roleOf: () => ({ role: 'Starter G', minutes: 32 }),
        effects,
        summaries: [summaryFor(1920)],
      },
    });
    const text = container.textContent;
    // Tired band at 40% fatigue (4000 bp); the label and percent are
    // separate text nodes inside the pill span.
    expect(text).toContain('Tired');
    expect(text).toContain('40%');
    // Workload and last-game minutes.
    expect(text).toContain('Recent load 30%');
    expect(text).toContain('last game 32 min');
  });

  it('handles a null effects state without fatigue pills', () => {
    const { container } = render(SeasonRosterList, {
      props: {
        roster: ROSTER,
        manifest: MANIFEST,
        shell: minimalShell(),
        roleOf: () => ({ role: 'Bench 1', minutes: 16 }),
        effects: null,
        summaries: [],
      },
    });
    const text = container.textContent;
    expect(text).not.toContain('Fresh');
    expect(text).toContain('Fixture hawks 1');
  });
});

describe('UnitChemistry (M2.4)', () => {
  it('renders the chemistry panel with shared-play evidence', () => {
    const effects = effectsState(4000, 400);
    const { container } = render(UnitChemistry, {
      props: {
        roster: ROSTER,
        effects,
        shell: minimalShell(),
      },
    });
    const text = container.textContent;
    expect(text).toContain('Unit chemistry');
    expect(text).toContain('Most shared play');
    expect(text).toContain('Least shared play');
    expect(text).toContain('400 trips');
  });

  it('omits the panel when effects state is absent', () => {
    const { container } = render(UnitChemistry, {
      props: {
        roster: ROSTER,
        effects: null,
        shell: minimalShell(),
      },
    });
    expect(container.textContent).not.toContain('Unit chemistry');
  });
});

describe('CheckpointRecap (M2.4)', () => {
  it('renders the mechanism-evidence section with recorded figures', () => {
    const recap: SeasonBlockRecap = {
      schemaVersion: 1,
      recapVersion: 'season-recap-v3',
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
        injuries: 0,
        bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
        sameGameReturns: 0,
        seasonEnding: 0,
        returnedThisBlock: 0,
        activeAtBlockEnd: 0,
        humanTeamInjuries: [],
      },
      objectiveEvidence: null,
      tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
      influenceBalance: { humanBalance: 2 },
    };
    const { container } = render(CheckpointRecap, {
      props: {
        recap,
        humanRecord: null,
        franchiseName: (id: string) => id,
        playerName: (id: string) => id,
        manifest: null,
        effectsEvidence: [
          {
            mechanism: 'shooter-fatigue',
            side: 'home',
            opportunities: 90,
            deltaTotals: -250_000,
            deltaMin: -25_000,
            deltaMax: 0,
            avgInputFraction: 0.4,
          },
          {
            mechanism: 'assist-conversion',
            side: 'home',
            opportunities: 30,
            deltaTotals: 420_000,
            deltaMin: 14_000,
            deltaMax: 14_000,
            avgInputFraction: 0.5,
          },
        ],
      },
    });
    const text = container.textContent;
    expect(text).toContain('Stamina and chemistry');
    expect(text).toContain('Fatigued shooters converted at a lower rate');
    expect(text).toContain('90 opportunities');
    expect(text).toContain('Fatigue · swing');
    expect(text).toContain('-25.00pp');
    expect(text).toContain('Chemistry converted passes into assists');
  });

  it('omits the section when no evidence is recorded', () => {
    const { container } = render(CheckpointRecap, {
      props: {
        recap: {
          schemaVersion: 1,
          recapVersion: 'season-recap-v3',
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
            injuries: 0,
            bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
            sameGameReturns: 0,
            seasonEnding: 0,
            returnedThisBlock: 0,
            activeAtBlockEnd: 0,
            humanTeamInjuries: [],
          },
          objectiveEvidence: null,
          tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
          influenceBalance: { humanBalance: 2 },
        },
        humanRecord: null,
        franchiseName: (id: string) => id,
        playerName: (id: string) => id,
        manifest: null,
        effectsEvidence: [],
      },
    });
    expect(container.textContent).not.toContain('Stamina and chemistry');
  });
});
