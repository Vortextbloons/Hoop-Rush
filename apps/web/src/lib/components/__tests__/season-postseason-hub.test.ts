import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { buildInitialPostseasonState, type SeasonRun } from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { createRotationEditor } from '$lib/season/season-rotation-editor';
import { legalRotation, rotationMembers } from '$lib/season/season-rotation-test-support';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import SeasonRunShellWrapper from '../../../test/SeasonRunShellWrapper.svelte';
mockSvelteKitApp();
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
function fixtureRun(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
  const schedule = generateSeasonSchedule({ league, seed: SEED });
  return buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: 'lakers' });
}
function snapshotOf(run: SeasonRun): SeasonRunSnapshot {
  return {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: {
      schemaVersion: 2,
      playerStates: [],
      inactivePlayerStates: [],
      pairStates: [],
      archivedPairs: [],
    },
  };
}
function playInPostseason(run: SeasonRun): SeasonRun['postseason'] {
  const state = buildInitialPostseasonState(run.rootSeed);
  state.playIn.east.ranking = [
    'east1',
    'east2',
    'east3',
    'east4',
    'east5',
    'east6',
    'east7',
    'east8',
    'east9',
    'east10',
  ];
  state.playIn.west.ranking = [
    'west1',
    'west2',
    'west3',
    'west4',
    'west5',
    'west6',
    'lakers',
    'west8',
    'west9',
    'west10',
  ];
  const completed = (gameId: string, home: string, away: string, homeWon: boolean) => ({
    gameId,
    status: 'final' as const,
    homeFranchiseId: home,
    awayFranchiseId: away,
    winnerFranchiseId: homeWon ? home : away,
    loserFranchiseId: homeWon ? away : home,
    homeScore: homeWon ? 108 : 101,
    awayScore: homeWon ? 101 : 108,
  });
  const east = state.playIn.east;
  east.games.sevenEight = completed('pi-east-seven-eight', 'east7', 'east8', true);
  east.games.nineTen = completed('pi-east-nine-ten', 'east9', 'east10', true);
  east.games.final = completed('pi-east-final', 'east8', 'east9', true);
  east.playoffSeeds = ['east1', 'east2', 'east3', 'east4', 'east5', 'east6', 'east7', 'east8'];
  return state;
}
function activeInjuryRun(run: SeasonRun, playerVersionId: string): SeasonRun {
  run.health.injuries.push({
    injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    playerVersionId,
    franchiseId: 'lakers',
    gameId: 's000001',
    type: 'soft-tissue',
    severity: 'moderate',
    occurredBeforeHalftime: false,
    sameGameReturn: false,
    sameGameReturned: null,
    missedGamesTotal: 6,
    missedGamesRemaining: 2,
    actualReturnRound: null,
    seasonEnding: false,
    rehabModifier: 0 as const,
    recurrenceWindowRoundsRemaining: 0,
    seedPath: ['test'],
  });
  return run;
}
function withRun(mutate: (run: SeasonRun) => void): SeasonRunShellData {
  const shell = baseShell();
  const run = shell.run;
  if (run === null) throw new Error('fixture run missing');
  mutate(run);
  shell.snapshot = snapshotOf(run);
  return shell;
}
function baseShell(): SeasonRunShellData {
  const run = fixtureRun();
  const snapshot = snapshotOf(run);
  const editor = createRotationEditor(legalRotation(), rotationMembers());
  return {
    ready: true,
    error: null,
    hubError: null,
    hub: null,
    snapshot,
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
    manifest: null,
    league: run.league,
    catalog: null,
    schedule: null,
    playerSlice: new Map(),
    playersIndex: [],
    playerSliceReady: true,
    facesByVersion: new Map(),
    facesReady: false,
    run,
    humanFranchiseId: 'lakers',
    humanTeam: run.league.teams.find((team) => team.franchiseId === 'lakers') ?? null,
    nextBlockIndex: 0,
    seasonComplete: false,
    editor,
    editorKey: 'test-editor',
    health: run.health,
    influence: run.influence,
    trade: run.trade,
    freeAgency: run.freeAgency,
    objectives: run.objectives,
    pending: null,
    interruption: null,
    commandError: null,
    externalChange: null,
    acknowledgeExternalChange: () => undefined,
    prewarmWorker: () => undefined,
    playerName: (playerVersionId) => {
      for (const roster of run.rosters) {
        const entry = roster.players.find((player) => player.playerVersionId === playerVersionId);
        if (entry !== undefined) return entry.displayName;
      }
      return playerVersionId;
    },
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
describe('hub: regular-season stage', () => {
  it('keeps the block workflow submit affordance', () => {
    const { container } = render(SeasonRunShellWrapper, { props: { shell: baseShell() } });
    const submit = container.querySelector('button[data-can-submit]');
    expect(submit).not.toBeNull();
    expect(submit?.textContent).toContain('Lock rotation and simulate block');
    expect(container.querySelector('[data-season-start-postseason]')).toBeNull();
  });
  it('offers the Start-postseason action once the regular season completes', async () => {
    const shell = baseShell();
    shell.seasonComplete = true;
    shell.nextBlockIndex = 9;
    const start = vi.fn(() => Promise.resolve());
    shell.startPostseason = start;
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    const panel = container.querySelector('[data-season-start-postseason]');
    expect(panel).not.toBeNull();
    const button = container.querySelector('[data-season-start-postseason-button]');
    expect(button).not.toBeNull();
    await fireEvent.click(button as HTMLElement);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
describe('hub: play-in stage with the human lineup decision', () => {
  it('renders the matchup card and the rotation decision panel', () => {
    const shell = withRun((run) => {
      activeInjuryRun(run, 'lakers');
      run.stage = 'play-in';
      run.postseason = playInPostseason(run);
    });
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    expect(container.querySelector('[data-season-current-matchup]')).not.toBeNull();
    expect(container.querySelector('[data-season-postseason-lineup]')).not.toBeNull();
    expect(container.querySelector('[data-season-rehab-options]')).not.toBeNull();
    const submit = container.querySelector('[data-season-postseason-submit]');
    expect(submit).not.toBeNull();
    expect((submit as HTMLElement).textContent).toContain('Lock lineup and simulate');
  });
  it('shows the risky-rehab cost and blocks selection below the 2-Influence balance', () => {
    const shell = withRun((run) => {
      activeInjuryRun(run, 'lakers');
      run.stage = 'play-in';
      run.postseason = playInPostseason(run);
      run.influence.balances.lakers = 1;
    });
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    const option = container.querySelector<HTMLInputElement>('[data-season-rehab-option]');
    expect(option).not.toBeNull();
    expect(option?.disabled).toBe(true);
    expect(container.textContent).toContain('Needs 2 Influence');
  });
  it('routes the typed rejection message into the decision panel', () => {
    const shell = withRun((run) => {
      run.stage = 'play-in';
      run.postseason = playInPostseason(run);
    });
    shell.commandError = {
      command: 'submit-postseason-rotation',
      rejection: {
        code: 'invalid-rotation',
        franchiseId: 'lakers',
        reasons: ['starter PG cannot play slot'],
      },
      message: 'default arm',
    };
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    expect(container.querySelector('[data-season-postseason-lineup]')?.textContent).toContain(
      'starter PG cannot play slot',
    );
  });
  it('submits the editor rotation with the selected risky-rehab injury', async () => {
    const shell = withRun((run) => {
      activeInjuryRun(run, 'lakers');
      run.stage = 'play-in';
      run.postseason = playInPostseason(run);
    });
    const submit = vi.fn<(input: { targetGameId: string; rotation: unknown }) => Promise<void>>(
      () => Promise.resolve(),
    );
    shell.submitPostseasonRotation = submit;
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    const option = container.querySelector<HTMLInputElement>('[data-season-rehab-option]');
    await fireEvent.click(option as HTMLElement);
    await fireEvent.click(
      container.querySelector('[data-season-postseason-submit]') as HTMLElement,
    );
    expect(submit).toHaveBeenCalledTimes(1);
    const firstCall = submit.mock.calls[0];
    if (firstCall === undefined) throw new Error('expected a submit call');
    const input = firstCall[0];
    expect(input.targetGameId).toBe('pi-west-seven-eight');
    expect(input.rotation).toMatchObject({
      franchiseId: 'lakers',
      riskyRehabInjuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });
});
describe('hub: eliminated stage', () => {
  it('offers spectate-next and fast-forward with progress + cancellation', async () => {
    const shell = baseShell();
    const run = shell.run;
    if (run === null) throw new Error('fixture run missing');
    run.stage = 'playoffs';
    const postseason = buildInitialPostseasonState(run.rootSeed);
    postseason.playIn.east.ranking = [
      'east1',
      'east2',
      'east3',
      'east4',
      'east5',
      'east6',
      'east7',
      'east8',
      'east9',
      'east10',
    ];
    postseason.playIn.west.ranking = [
      'west1',
      'west2',
      'west3',
      'west4',
      'west5',
      'west6',
      'west7',
      'west8',
      'west9',
      'west10',
    ];
    for (const conference of ['east', 'west'] as const) {
      postseason.playIn[conference].playoffSeeds = [
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
    postseason.bracket = {
      schemaVersion: 1,
      postseasonVersion: 'postseason-v2',
      east: {
        conference: 'east',
        seeds: ['east1', 'east2', 'east3', 'east4', 'east5', 'east6', 'east7', 'east8'],
        firstRound: [
          {
            seriesId: 'east1-8',
            round: 'first-round',
            conference: 'east',
            higherSeed: 1,
            lowerSeed: 8,
            homeCourtFranchiseId: 'east1',
            challengerFranchiseId: 'east8',
            homeCourtWins: 1,
            challengerWins: 1,
            games: [
              {
                gameId: 'po-east1-8-g1',
                gameNumber: 1,
                homeFranchiseId: 'east1',
                awayFranchiseId: 'east8',
                status: 'final',
                homeScore: 101,
                awayScore: 99,
                winnerFranchiseId: 'east1',
              },
              {
                gameId: 'po-east1-8-g2',
                gameNumber: 2,
                homeFranchiseId: 'east1',
                awayFranchiseId: 'east8',
                status: 'final',
                homeScore: 98,
                awayScore: 102,
                winnerFranchiseId: 'east8',
              },
            ],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-east4-5',
            round: 'first-round',
            conference: 'east',
            higherSeed: 4,
            lowerSeed: 5,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-east3-6',
            round: 'first-round',
            conference: 'east',
            higherSeed: 3,
            lowerSeed: 6,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-east2-7',
            round: 'first-round',
            conference: 'east',
            higherSeed: 2,
            lowerSeed: 7,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
        ],
        semifinals: [],
        conferenceFinal: {
          seriesId: 'po-east-conf',
          round: 'conference-final',
          conference: 'east',
          higherSeed: null,
          lowerSeed: null,
          homeCourtFranchiseId: null,
          challengerFranchiseId: null,
          homeCourtWins: 0,
          challengerWins: 0,
          games: [],
          winnerFranchiseId: null,
        },
      },
      west: {
        conference: 'west',
        seeds: ['west1', 'west2', 'west3', 'west4', 'west5', 'west6', 'west7', 'west8'],
        firstRound: [
          {
            seriesId: 'po-west1-8',
            round: 'first-round',
            conference: 'west',
            higherSeed: 1,
            lowerSeed: 8,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-west4-5',
            round: 'first-round',
            conference: 'west',
            higherSeed: 4,
            lowerSeed: 5,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-west3-6',
            round: 'first-round',
            conference: 'west',
            higherSeed: 3,
            lowerSeed: 6,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
          {
            seriesId: 'po-west2-7',
            round: 'first-round',
            conference: 'west',
            higherSeed: 2,
            lowerSeed: 7,
            homeCourtFranchiseId: null,
            challengerFranchiseId: null,
            homeCourtWins: 0,
            challengerWins: 0,
            games: [],
            winnerFranchiseId: null,
          },
        ],
        semifinals: [],
        conferenceFinal: {
          seriesId: 'po-west-conf',
          round: 'conference-final',
          conference: 'west',
          higherSeed: null,
          lowerSeed: null,
          homeCourtFranchiseId: null,
          challengerFranchiseId: null,
          homeCourtWins: 0,
          challengerWins: 0,
          games: [],
          winnerFranchiseId: null,
        },
      },
      finals: {
        seriesId: 'po-finals',
        round: 'finals',
        conference: null,
        higherSeed: null,
        lowerSeed: null,
        homeCourtFranchiseId: null,
        challengerFranchiseId: null,
        homeCourtWins: 0,
        challengerWins: 0,
        games: [],
        winnerFranchiseId: null,
      },
      championFranchiseId: null,
    };
    run.postseason = postseason;
    shell.snapshot = snapshotOf(run);
    const spectate = vi.fn(() => Promise.resolve());
    const fastForward = vi.fn(() => Promise.resolve());
    shell.spectatePostseasonGame = spectate;
    shell.fastForwardPostseason = fastForward;
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    expect(container.querySelector('[data-season-eliminated]')).not.toBeNull();
    expect(container.querySelector('[data-season-spectate]')).not.toBeNull();
    expect(container.querySelector('[data-season-current-matchup]')).not.toBeNull();
    await fireEvent.click(container.querySelector('[data-season-spectate-next]') as HTMLElement);
    expect(spectate).toHaveBeenCalledWith({ targetGameId: 'po-east1-8-g3' });
    await fireEvent.click(container.querySelector('[data-season-fast-forward]') as HTMLElement);
    expect(fastForward).toHaveBeenCalledTimes(1);
    shell.postseason = {
      phase: 'running',
      gamesCompleted: 1,
      gamesTotal: 4,
      latestGameId: 'po-east1-8-g3',
      latestResult: {
        gameId: 'po-east1-8-g3',
        homeFranchiseId: 'east8',
        awayFranchiseId: 'east1',
        homeScore: 104,
        awayScore: 96,
      },
      error: null,
    };
    const cancel = vi.fn();
    shell.cancelPostseason = cancel;
    const progress = render(SeasonRunShellWrapper, { props: { shell } });
    const progressbar = progress.container.querySelector('[role="progressbar"]');
    expect(progressbar).not.toBeNull();
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('1');
    const cancelButton = [...progress.container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Cancel'),
    );
    expect(cancelButton).not.toBeNull();
    await fireEvent.click(cancelButton as HTMLElement);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
describe('hub: completed stage', () => {
  it('shows the champion summary with the onward links', () => {
    const shell = baseShell();
    const run = shell.run;
    if (run === null) throw new Error('fixture run missing');
    run.stage = 'completed';
    run.postseason.championFranchiseId = 'lakers';
    run.completion = {
      championFranchiseId: 'lakers',
      almanacDigest: '0'.repeat(32),
      finalizedAtStateRevision: 1,
    };
    shell.snapshot = snapshotOf(run);
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    const champion = container.querySelector('[data-season-champion]');
    expect(champion).not.toBeNull();
    expect(champion?.textContent).toContain('lakers');
  });
});
describe('hub: postseason failure state', () => {
  it('surfaces an orchestration failure with a retry affordance', () => {
    const shell = baseShell();
    const run = shell.run;
    if (run === null) throw new Error('fixture run missing');
    run.stage = 'playoffs';
    run.postseason = playInPostseason(run);
    run.postseason.bracket = null;
    shell.snapshot = snapshotOf(run);
    shell.postseason = {
      phase: 'failed',
      gamesCompleted: 0,
      gamesTotal: 0,
      latestGameId: null,
      latestResult: null,
      error: { code: 'integrity-failure', message: 'the bracket cannot schedule a game' },
    };
    const { container } = render(SeasonRunShellWrapper, { props: { shell } });
    expect(container.querySelector('[data-season-postseason-progress]')).not.toBeNull();
    expect(container.textContent).toContain('the bracket cannot schedule a game');
    const retry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Retry'),
    );
    expect(retry).not.toBeNull();
  });
});
