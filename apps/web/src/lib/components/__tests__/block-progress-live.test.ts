import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import {
  franchiseIdSchema,
  seasonGameIdSchema,
  type HoopRushManifest,
  type SeasonPostseasonScoreline,
  type SeasonScoreline,
} from '@hoop-rush/data-contracts';
import BlockProgress from '$lib/components/season/BlockProgress.svelte';
import PostseasonProgress from '$lib/components/season/PostseasonProgress.svelte';
import type { BlockRunState } from '$lib/season/season-hub-state';
import type { HubPostseasonProgress } from '$lib/season/season-postseason-presentation';

const HUMAN = franchiseIdSchema.parse('lakers');
const OPP = franchiseIdSchema.parse('celtics');
const OTHER_HOME = franchiseIdSchema.parse('bulls');
const OTHER_AWAY = franchiseIdSchema.parse('knicks');

function line(
  gameId: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
): SeasonScoreline {
  return {
    gameId: seasonGameIdSchema.parse(gameId),
    homeFranchiseId: franchiseIdSchema.parse(home),
    homeScore,
    awayScore,
    awayFranchiseId: franchiseIdSchema.parse(away),
  };
}

function blockState(overrides: Partial<BlockRunState> = {}): BlockRunState {
  return {
    requestId: 'req-1',
    blockIndex: 0,
    phase: 'running',
    gamesCompleted: 10,
    gamesTotal: 150,
    latestGameId: null,
    latestResult: null,
    isHumanGame: false,
    humanRecordInBlock: { wins: 0, losses: 0 },
    humanResults: [],
    leaguePulse: { closest: null, blowout: null, highestScoring: null },
    error: null,
    command: null,
    startInput: null,
    ...overrides,
  };
}

function blockProps(state: BlockRunState, manifest: HoopRushManifest | null = null) {
  return {
    block: state,
    onCancel: () => {},
    onRetry: () => {},
    label: 'Block 1 · R1–R9',
    humanFranchiseId: HUMAN,
    schedule: null,
    franchiseName: (id: string) => id,
    franchiseAbbrev: (id: string) => id.toUpperCase().slice(0, 3),
    recapHref: '/season/run/checkpoint?block=0',
    manifest,
  };
}

function testManifest(): HoopRushManifest {
  return {
    modernFranchiseSlots: [
      { franchiseId: HUMAN, teamExternalId: '1610612747', displayName: 'Lakers' },
      { franchiseId: OPP, teamExternalId: '1610612738', displayName: 'Celtics' },
      { franchiseId: OTHER_HOME, teamExternalId: '1610612741', displayName: 'Bulls' },
      { franchiseId: OTHER_AWAY, teamExternalId: '1610612752', displayName: 'Knicks' },
    ],
    assets: {
      headshotUrlTemplate: null,
      headshotUrlTemplateSecondary: null,
      logoUrlTemplate: 'https://example.com/logos/{teamExternalId}.png',
      logoUrlTemplateSecondary: null,
      source: 'test',
      cacheVersion: 'test',
    },
  } as unknown as HoopRushManifest;
}

const mounted: Array<{ unmount: () => void }> = [];
afterEach(async () => {
  for (const entry of mounted.splice(0)) entry.unmount();
  await tick();
});

function mountBlock(state: BlockRunState, manifest: HoopRushManifest | null = null) {
  const rendered = render(BlockProgress, blockProps(state, manifest));
  mounted.push(rendered);
  return rendered;
}

describe('BlockProgress broadcast modal', () => {
  it('opens a dialog with the simming pill, shimmer bar, and your-game card', async () => {
    const humanWin = line('s000007', HUMAN, OPP, 112, 108);
    mountBlock(
      blockState({
        latestGameId: humanWin.gameId,
        latestResult: humanWin,
        isHumanGame: true,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [humanWin],
      }),
    );
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Simming')).not.toBeNull();
    expect(screen.getByText('Your games')).not.toBeNull();
    expect(screen.getByText('112–108')).not.toBeNull();
    expect(screen.getByTestId('block-human-spotlight')).not.toBeNull();
    expect(
      screen.getByRole('progressbar').querySelector('.sim-bar-fill')?.getAttribute('data-active'),
    ).toBe('true');
  });

  it('streams league finals into the ticker without touching the worker wire', async () => {
    const first = line('s000001', OTHER_HOME, OTHER_AWAY, 120, 118);
    const second = line('s000002', OTHER_AWAY, OTHER_HOME, 99, 104);
    const rendered = mountBlock(blockState({ latestGameId: first.gameId, latestResult: first }));
    await tick();
    expect(screen.getByText('Around the league')).not.toBeNull();
    expect(screen.getByText('KNI 118–120 BUL')).not.toBeNull();
    await rendered.rerender(
      blockProps(
        blockState({
          gamesCompleted: 2,
          latestGameId: second.gameId,
          latestResult: second,
        }),
      ),
    );
    await tick();
    expect(screen.getByText('KNI 118–120 BUL')).not.toBeNull();
    expect(screen.getByText('BUL 104–99 KNI')).not.toBeNull();
  });

  it('hides to a slim bar and reopens on demand while the sim keeps running', async () => {
    mountBlock(blockState());
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Hide live sim' }));
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Watch live' })).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Watch live' }));
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('ignores Escape — the modal only exits through its own buttons', async () => {
    mountBlock(blockState());
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    await fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('animates the progress-bar fill over a fixed 4 seconds', async () => {
    mountBlock(blockState({ gamesCompleted: 75, gamesTotal: 150 }));
    await tick();
    const fill = screen.getByRole('progressbar').querySelector('.sim-bar-fill');
    expect(fill).not.toBeNull();
    expect(fill?.getAttribute('style') ?? '').toContain('4000');
  });

  it('stays open on the Final view after the hub resets to idle on commit', async () => {
    const humanWin = line('s000007', HUMAN, OPP, 112, 108);
    const rendered = mountBlock(
      blockState({
        gamesCompleted: 150,
        latestGameId: humanWin.gameId,
        latestResult: humanWin,
        isHumanGame: false,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [humanWin],
      }),
    );
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    await rendered.rerender(
      blockProps(
        blockState({
          requestId: null,
          blockIndex: null,
          phase: 'idle',
          gamesCompleted: 0,
          gamesTotal: 0,
          latestGameId: null,
          latestResult: null,
          isHumanGame: false,
          humanRecordInBlock: { wins: 0, losses: 0 },
          humanResults: [],
        }),
      ),
    );
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText(/You went 1–0 in Block 1/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'View recap' })).not.toBeNull();
  });

  it('renders team logos and home/away context when a manifest is provided', async () => {
    const humanWin = line('s000007', HUMAN, OPP, 112, 108);
    const league = line('s000001', OTHER_HOME, OTHER_AWAY, 120, 118);
    mountBlock(
      blockState({
        latestGameId: league.gameId,
        latestResult: league,
        isHumanGame: false,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [humanWin],
      }),
      testManifest(),
    );
    await tick();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img[src*="1610612747"]')).not.toBeNull();
    expect(dialog.querySelector('img[src*="1610612738"]')).not.toBeNull();
    expect(dialog.querySelector('img[src*="1610612741"]')).not.toBeNull();
    expect(dialog.querySelector('img[src*="1610612752"]')).not.toBeNull();
    expect(screen.getByText('HOME')).not.toBeNull();
  });

  it('keeps human games out of the league ticker and celebrates a finished block', async () => {
    const humanWin = line('s000007', HUMAN, OPP, 112, 108);
    mountBlock(
      blockState({
        phase: 'complete',
        gamesCompleted: 150,
        latestGameId: humanWin.gameId,
        latestResult: humanWin,
        isHumanGame: false,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [humanWin],
      }),
    );
    await tick();
    expect(document.querySelector('.sim-live-pill[data-tone="final"]')).not.toBeNull();
    expect(screen.getByText(/You went 1–0 in Block 1/)).not.toBeNull();
    expect(screen.queryByLabelText('Latest league finals')).toBeNull();
    expect(screen.getByRole('link', { name: 'View recap' }).getAttribute('href')).toBe(
      '/season/run/checkpoint?block=0',
    );
  });
});

function postseasonState(overrides: Partial<HubPostseasonProgress> = {}): HubPostseasonProgress {
  return {
    phase: 'running',
    gamesCompleted: 1,
    gamesTotal: 7,
    latestGameId: null,
    latestResult: null,
    error: null,
    ...overrides,
  };
}

describe('PostseasonProgress broadcast modal', () => {
  it('opens a dialog with the latest final card while simming', async () => {
    const final: SeasonPostseasonScoreline = {
      gameId: 'pi-east-seven-eight',
      homeFranchiseId: HUMAN,
      homeScore: 110,
      awayScore: 108,
      awayFranchiseId: OPP,
    };
    mounted.push(
      render(PostseasonProgress, {
        props: {
          progress: postseasonState({ latestGameId: final.gameId, latestResult: final }),
          onCancel: () => {},
          onRetry: () => {},
          label: 'Postseason',
          franchiseAbbrev: (id: string) => id,
          humanFranchiseId: HUMAN,
        },
      }),
    );
    await tick();
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(screen.getByText('Simming')).not.toBeNull();
    expect(screen.getByText('celtics 108–110 lakers')).not.toBeNull();
  });

  it('announces saved results when complete', async () => {
    mounted.push(
      render(PostseasonProgress, {
        props: {
          progress: postseasonState({ phase: 'complete', gamesCompleted: 7 }),
          onCancel: () => {},
          onRetry: () => {},
          label: 'Postseason',
        },
      }),
    );
    await tick();
    expect(document.querySelector('.sim-live-pill[data-tone="final"]')).not.toBeNull();
    expect(screen.getByText(/Results are saved/)).not.toBeNull();
  });

  it('ignores Escape and fills its bar over a fixed 4 seconds', async () => {
    const final: SeasonPostseasonScoreline = {
      gameId: 'pi-east-seven-eight',
      homeFranchiseId: HUMAN,
      homeScore: 110,
      awayScore: 108,
      awayFranchiseId: OPP,
    };
    mounted.push(
      render(PostseasonProgress, {
        props: {
          progress: postseasonState({ latestGameId: final.gameId, latestResult: final }),
          onCancel: () => {},
          onRetry: () => {},
          label: 'Postseason',
          franchiseAbbrev: (id: string) => id,
          humanFranchiseId: HUMAN,
          manifest: testManifest(),
        },
      }),
    );
    await tick();
    await fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await tick();
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('img[src*="1610612747"]')).not.toBeNull();
    expect(dialog.querySelector('img[src*="1610612738"]')).not.toBeNull();
    const fill = screen.getByRole('progressbar').querySelector('.sim-bar-fill');
    expect(fill?.getAttribute('style') ?? '').toContain('4000');
  });
});
