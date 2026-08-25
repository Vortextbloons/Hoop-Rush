import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { buildInitialPostseasonState, type SeasonRun } from '@hoop-rush/data-contracts';
import type { SeasonCompletedRunIndexEntry, SeasonCompletedSeason } from '@hoop-rush/persistence';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import SeasonHistoryResultWrapper from '../../../test/SeasonHistoryResultWrapper.svelte';

mockSvelteKitApp();

vi.mock('$app/navigation', () => ({
  goto: vi.fn(() => Promise.resolve()),
  replaceState: vi.fn(),
  pushState: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve()),
  invalidateAll: vi.fn(() => Promise.resolve()),
  preloadData: vi.fn(() => Promise.resolve()),
  preloadCode: vi.fn(() => Promise.resolve()),
}));

import { goto } from '$app/navigation';

function resultShell(): SeasonRunShellData {
  return {
    ready: true,
    error: null,
    hubError: null,
    hub: null,
    snapshot: null,
    index: null,
    block: {
      requestId: null,
      blockIndex: null,
      phase: 'idle',
      gamesCompleted: 0,
      gamesTotal: 0,
      latestGameId: null,
      latestResult: null,
      error: null,
      command: null,
      startInput: null,
    },
    manifest: {
      schemaVersion: 4,
      dataVersion: 'test',
      modernFranchiseSlots: Array.from({ length: 30 }, (_, index) => ({
        franchiseId: index === 0 ? 'lakers' : `team-${String(index)}`,
        displayName: `Team ${String(index)}`,
        abbreviation: `T${String(index)}`,
      })),
      franchiseLineage: [],
      eras: [{ eraId: '1990s', label: '1990s', seasonKeys: ['1990-91'] }],
      pools: [],
      availability: [],
      eraSimulationProfiles: [
        { eraId: '1990s', url: 'era-sim/1990s.json', contentHash: 'a'.repeat(64) },
      ],
      season: {
        league: { url: 'season/league.json', contentHash: 'b'.repeat(64) },
        schedule: { url: 'season/schedule.json', contentHash: 'c'.repeat(64) },
        draftCatalog: { url: 'season/draft-catalog.json', contentHash: 'd'.repeat(64) },
        rosterTargets: { url: 'season/roster-targets.json', contentHash: 'e'.repeat(64) },
      },
      assets: {
        headshotUrlTemplate: null,
        headshotUrlTemplateSecondary: null,
        logoUrlTemplate: null,
        logoUrlTemplateSecondary: null,
        source: 'test',
        cacheVersion: 'test',
      },
    },
    league: null,
    catalog: null,
    schedule: null,
    playerSlice: new Map(),
    playersIndex: [],
    playerSliceReady: true,
    facesByVersion: new Map(),
    facesReady: false,
    run: null,
    humanFranchiseId: null,
    humanTeam: null,
    nextBlockIndex: null,
    seasonComplete: false,
    editor: null,
    editorKey: null,
    health: null,
    influence: null,
    trade: null,
    freeAgency: null,
    objectives: null,
    pending: null,
    interruption: null,
    commandError: null,
    externalChange: null,
    acknowledgeExternalChange: () => undefined,
    prewarmWorker: () => undefined,
    playerName: (playerVersionId) => playerVersionId,
    playablePositions: () => [],
    franchiseName: (franchiseId) => franchiseId,
    franchiseAbbrev: (franchiseId) => franchiseId.slice(0, 3),
    cancelBlock: () => undefined,
    retryBlock: () => undefined,
    refresh: () => Promise.resolve(),
    quitRun: () => Promise.resolve({ ok: true, error: null }),
    selectBlockObjective: () => Promise.resolve(),
    spendInfluence: () => Promise.resolve(),
    acceptTradeOffer: () => Promise.resolve(),
    declineTradeOffer: () => Promise.resolve(),
    declareFreeAgentInterest: () => Promise.resolve(),
    skipFreeAgentMarket: () => Promise.resolve(),
    resolveFreeAgentMarket: () => Promise.resolve(),
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

const repoCalls = vi.hoisted(() => ({
  deletedRunIds: [] as string[],
  exportedGameIds: [] as string[],
  fullRunExports: 0,
}));

vi.mock('$lib/season/season-completed-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/season/season-completed-export')>();
  return {
    ...actual,
    buildCompletedSeasonRunReplayExport: (...args: Parameters<typeof actual.buildCompletedSeasonRunReplayExport>) => {
      repoCalls.fullRunExports += 1;
      return actual.buildCompletedSeasonRunReplayExport(...args);
    },
  };
});

vi.mock('@hoop-rush/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hoop-rush/persistence')>();
  class FakeDexieSeasonRunRepository {
    loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null> {
      return Promise.resolve(runId === 'completed-1' ? buildCompletedSeason() : null);
    }
    listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]> {
      return Promise.resolve([indexEntry()]);
    }
    deleteCompletedSeason(runId: string): Promise<void> {
      repoCalls.deletedRunIds.push(runId);
      return Promise.resolve();
    }
    buildReplayExport(runId: string, gameId: string): Promise<unknown> {
      repoCalls.exportedGameIds.push(gameId);
      return Promise.resolve({
        schemaVersion: 1,
        exportVersion: 'replay-export-v1',
        runId,
        gameId,
        summary: null,
        digest: '0'.repeat(32),
      });
    }
  }
  return {
    ...actual,
    DexieSeasonRunRepository: FakeDexieSeasonRunRepository,
  };
});

import type { SeasonPostseasonSummary } from '@hoop-rush/data-contracts';

function fixtureRun(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
  const schedule = generateSeasonSchedule({ league, seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a' });
  const run = buildSeasonRunFixture({
    schedule,
    league,
    seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    humanFranchiseId: 'lakers',
  });
  run.stage = 'completed';
  run.postseason = buildInitialPostseasonState(run.rootSeed);
  run.postseason.playIn.east.ranking = [
    'e1',
    'e2',
    'e3',
    'e4',
    'e5',
    'e6',
    'e7',
    'e8',
    'e9',
    'e10',
  ];
  run.postseason.playIn.west.ranking = [
    'w1',
    'w2',
    'w3',
    'w4',
    'w5',
    'w6',
    'w7',
    'w8',
    'w9',
    'w10',
  ];
  for (const conference of ['east', 'west'] as const) {
    const playIn = run.postseason.playIn[conference];
    playIn.games.sevenEight = {
      gameId: `pi-${conference}-seven-eight`,
      status: 'final',
      homeFranchiseId: `${conference}7`,
      awayFranchiseId: `${conference}8`,
      winnerFranchiseId: `${conference}7`,
      loserFranchiseId: `${conference}8`,
      homeScore: 112,
      awayScore: 101,
    };
    playIn.games.nineTen = {
      gameId: `pi-${conference}-nine-ten`,
      status: 'final',
      homeFranchiseId: `${conference}9`,
      awayFranchiseId: `${conference}10`,
      winnerFranchiseId: `${conference}9`,
      loserFranchiseId: `${conference}10`,
      homeScore: 98,
      awayScore: 91,
    };
    playIn.games.final = {
      gameId: `pi-${conference}-final`,
      status: 'final',
      homeFranchiseId: `${conference}8`,
      awayFranchiseId: `${conference}9`,
      winnerFranchiseId: `${conference}8`,
      loserFranchiseId: `${conference}9`,
      homeScore: 104,
      awayScore: 100,
    };
    playIn.playoffSeeds = [
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ];
  }
  const closedSeries = (
    seriesId: string,
    round: 'first-round' | 'conference-semifinal' | 'conference-final' | 'finals',
    conference: 'east' | 'west' | null,
    home: string | null,
    away: string | null,
    winner: string,
  ) => ({
    seriesId,
    round,
    conference,
    higherSeed: null,
    lowerSeed: null,
    homeCourtFranchiseId: home,
    challengerFranchiseId: away,
    homeCourtWins: 4,
    challengerWins: 2,
    games: [1, 2, 3, 4, 5, 6].map((gameNumber) => {
      const homeIsHomeSide = [1, 2, 5].includes(gameNumber);
      return {
        gameId: `po-${seriesId}-g${String(gameNumber)}`,
        gameNumber,
        homeFranchiseId: homeIsHomeSide ? (home ?? '') : (away ?? ''),
        awayFranchiseId: homeIsHomeSide ? (away ?? '') : (home ?? ''),
        status: 'final' as const,
        homeScore: 100 + gameNumber,
        awayScore: 95 + gameNumber,
        winnerFranchiseId:
          100 + gameNumber > 95 + gameNumber === homeIsHomeSide ? (home ?? '') : (away ?? ''),
      };
    }),
    winnerFranchiseId: winner,
  });
  const conferenceBracket = (conference: 'east' | 'west') => ({
    conference,
    seeds: [
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ],
    firstRound: [
      closedSeries(
        `c${conference}1-8`,
        'first-round',
        conference,
        `${conference}1`,
        `${conference}8`,
        `${conference}1`,
      ),
      closedSeries(
        `c${conference}4-5`,
        'first-round',
        conference,
        `${conference}4`,
        `${conference}5`,
        `${conference}5`,
      ),
      closedSeries(
        `c${conference}3-6`,
        'first-round',
        conference,
        `${conference}3`,
        `${conference}6`,
        `${conference}3`,
      ),
      closedSeries(
        `c${conference}2-7`,
        'first-round',
        conference,
        `${conference}2`,
        `${conference}7`,
        `${conference}2`,
      ),
    ],
    semifinals: [
      closedSeries(
        `c${conference}1-5`,
        'conference-semifinal',
        conference,
        `${conference}1`,
        `${conference}5`,
        `${conference}1`,
      ),
      closedSeries(
        `c${conference}3-2`,
        'conference-semifinal',
        conference,
        `${conference}3`,
        `${conference}2`,
        `${conference}2`,
      ),
    ],
    conferenceFinal: closedSeries(
      `c${conference}1-2`,
      'conference-final',
      conference,
      `${conference}1`,
      `${conference}2`,
      `${conference}1`,
    ),
  });
  run.postseason.bracket = {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v2',
    east: conferenceBracket('east'),
    west: conferenceBracket('west'),
    finals: closedSeries('finals', 'finals', null, 'west1', 'east1', 'west1'),
    championFranchiseId: 'lakers',
  };
  run.postseason.championFranchiseId = 'lakers';
  run.awards = {
    schemaVersion: 1,
    awardsVersion: 'awards-v1',
    runId: run.runId,
    mvp: { playerVersionId: 'pv-mvp', franchiseId: 'lakers' },
    defensivePlayerOfYear: { playerVersionId: 'pv-dpoy', franchiseId: 'lakers' },
    sixthManOfYear: { playerVersionId: 'pv-sixth', franchiseId: 'lakers' },
    allLeagueFirstTeam: [
      { playerVersionId: 'pv-1', franchiseId: 'lakers' },
      { playerVersionId: 'pv-2', franchiseId: 'lakers' },
      { playerVersionId: 'pv-3', franchiseId: 'lakers' },
      { playerVersionId: 'pv-4', franchiseId: 'lakers' },
      { playerVersionId: 'pv-5', franchiseId: 'lakers' },
    ],
    digest: '0'.repeat(32),
  };
  run.completion = {
    championFranchiseId: 'lakers',
    almanacDigest: '0'.repeat(32),
    finalizedAtStateRevision: 12,
  };
  return run;
}

function postseasonSummary(gameId: string): SeasonPostseasonSummary {
  return {
    schemaVersion: 1,
    summaryVersion: 'postseason-summary-v1',
    runId: 'completed-1',
    gameId,
    phase: 'play-in',
    round: 'seven-eight',
    seriesId: null,
    gameNumber: 1,
    conference: 'west',
    homeFranchiseId: 'lakers',
    awayFranchiseId: 'kings',
    winnerFranchiseId: 'lakers',
    loserFranchiseId: 'kings',
    status: 'final',
    homeScore: 112,
    awayScore: 97,
    forfeitLoserFranchiseId: null,
    homeBox: {
      franchiseId: 'lakers',
      points: 112,
      fieldGoalsMade: 42,
      fieldGoalsAttempted: 90,
      threePointersMade: 12,
      threePointersAttempted: 32,
      freeThrowsMade: 16,
      freeThrowsAttempted: 20,
      offensiveRebounds: 11,
      defensiveRebounds: 31,
      assists: 26,
      steals: 8,
      blocks: 6,
      turnovers: 12,
      fouls: 18,
      possessions: 98,
    },
    awayBox: {
      franchiseId: 'kings',
      points: 97,
      fieldGoalsMade: 37,
      fieldGoalsAttempted: 88,
      threePointersMade: 11,
      threePointersAttempted: 34,
      freeThrowsMade: 12,
      freeThrowsAttempted: 16,
      offensiveRebounds: 9,
      defensiveRebounds: 28,
      assists: 21,
      steals: 6,
      blocks: 3,
      turnovers: 16,
      fouls: 20,
      possessions: 95,
    },
    homePlayers: [],
    awayPlayers: [],
    rotationEvidence: {
      home: { playersUsed: 0, substitutions: 0 },
      away: { playersUsed: 0, substitutions: 0 },
    },
    injuryEvents: [],
    resultDigest: '0'.repeat(32),
  };
}

function indexEntry(): SeasonCompletedRunIndexEntry {
  return {
    recordId: 'completed-1',
    runId: 'completed-1',
    rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    humanFranchiseId: 'lakers',
    championFranchiseId: 'lakers',
    almanacDigest: '0'.repeat(32),
    commandLogDigest: '0'.repeat(32),
    completedAtIso: '2026-08-01T12:00:00.000Z',
  };
}

function buildCompletedSeason(): SeasonCompletedSeason {
  const run = fixtureRun();
  return {
    run,
    almanac: {
      schemaVersion: 1,
      almanacVersion: 'almanac-v1',
      runId: run.runId,
      rootSeed: run.rootSeed,
      championFranchiseId: 'lakers',
      postseasonDigest: '0'.repeat(32),
      commandLogDigest: '0'.repeat(32),
      awardsDigest: '0'.repeat(32),
      tradeGradesDigest: '0'.repeat(32),
      digest: '0'.repeat(32),
    },
    commandLog: {
      schemaVersion: 1,
      commandLogVersion: 'command-log-v1',
      runId: run.runId,
      entries: [],
    },
    summaries: [],
    postseasonSummaries: [postseasonSummary('pi-west-seven-eight')],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  repoCalls.deletedRunIds = [];
  repoCalls.exportedGameIds = [];
  repoCalls.fullRunExports = 0;
});

describe('CompletedSeasonResult', () => {
  it('loads and renders the champion, bracket, postseason results, and export', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => undefined,
    });
    const { container } = render(SeasonHistoryResultWrapper, {
      props: { shell: resultShell(), runId: 'completed-1' },
    });
    await waitFor(() => {
      expect(container.querySelector('[data-season-champion]')).not.toBeNull();
    });
    expect(container.textContent).toContain('lakers');
    expect(container.querySelector('[data-season-series-card]')).not.toBeNull();
    const game = container.querySelector(
      '[data-season-history-postseason-game="pi-west-seven-eight"]',
    );
    expect(game?.textContent).toContain('W');
    expect(game?.textContent).toContain('112–97');

    await fireEvent.click(container.querySelector('[data-season-history-export]') as HTMLElement);
    await waitFor(() => {
      expect(repoCalls.exportedGameIds).toEqual(['pi-west-seven-eight']);
    });

    await fireEvent.click(
      container.querySelector('[data-season-history-export-full-run]') as HTMLElement,
    );
    await waitFor(() => {
      expect(repoCalls.fullRunExports).toBe(1);
    });
  });

  it('shows the typed not-found state for an unknown run id', async () => {
    const { container } = render(SeasonHistoryResultWrapper, {
      props: { shell: resultShell(), runId: 'missing-run' },
    });
    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(container.textContent).toContain('No completed season with run id missing-run');
  });

  it('deletes only after the confirm dialog and returns to the history list', async () => {
    const { container } = render(SeasonHistoryResultWrapper, {
      props: { shell: resultShell(), runId: 'completed-1' },
    });
    await waitFor(() => {
      expect(container.querySelector('[data-season-champion]')).not.toBeNull();
    });
    await fireEvent.click(container.querySelector('[data-season-history-delete]') as HTMLElement);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    if (dialog === null) throw new Error('expected the delete dialog');
    expect(dialog.textContent).toContain('Delete this season?');
    const deleteButtons = [...dialog.querySelectorAll('button')];
    const confirm = deleteButtons.find((button) => button.textContent.includes('Delete season'));
    expect(confirm).not.toBeNull();
    await fireEvent.click(confirm as HTMLElement);
    await waitFor(() => {
      expect(repoCalls.deletedRunIds).toEqual(['completed-1']);
    });
    expect(goto).toHaveBeenCalledWith('/season/run/history');
  });
});
