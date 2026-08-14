// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildManifest, buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import type { HoopRushManifest, SeasonGameSummary, SeasonRoster } from '@hoop-rush/data-contracts';
import SeasonPlayerStats from '$lib/components/season/SeasonPlayerStats.svelte';
import { humanSeasonPlayerStats } from '$lib/season/season-player-stats-view';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * Season Player stats section tests: the empty state before the first block,
 * the sortable full table defaulting to PPG desc, and the Per game/Totals
 * measurement toggle — jsdom renders the sortable stats table.
 */

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const MANIFEST: HoopRushManifest = buildManifest();
const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const schedule = generateSeasonSchedule({ league, seed: SEED });
const run = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: 'lakers' });

const rosterOf = (franchiseId: string): SeasonRoster => {
  const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
  if (roster === undefined) throw new Error(`no roster for ${franchiseId}`);
  return roster;
};

function lineOf(
  roster: SeasonRoster,
  index: number,
  overrides: Partial<Record<string, number>> = {},
) {
  const entry = roster.players[index];
  if (entry === undefined) throw new Error('roster index out of range');
  return {
    playerVersionId: entry.playerVersionId,
    seconds: 720,
    points: 10,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 1,
    freeThrowsAttempted: 2,
    offensiveRebounds: 1,
    defensiveRebounds: 2,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 1,
    ...overrides,
  };
}

function boxOf(roster: SeasonRoster) {
  return {
    franchiseId: roster.franchiseId,
    points: 100,
    fieldGoalsMade: 40,
    fieldGoalsAttempted: 90,
    threePointersMade: 10,
    threePointersAttempted: 30,
    freeThrowsMade: 10,
    freeThrowsAttempted: 20,
    offensiveRebounds: 10,
    defensiveRebounds: 20,
    assists: 30,
    steals: 10,
    blocks: 5,
    turnovers: 20,
    fouls: 15,
    possessions: 100,
  };
}

function summary(home: SeasonRoster, away: SeasonRoster): SeasonGameSummary {
  return {
    schemaVersion: 1,
    summaryVersion: run.versions.summaryVersion,
    gameId: 's000001',
    round: 1,
    homeFranchiseId: home.franchiseId,
    awayFranchiseId: away.franchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore: 100,
    awayScore: 95,
    forfeitLoserFranchiseId: null,
    homeBox: boxOf(home),
    awayBox: boxOf(away),
    homePlayers: home.players.map((_, index) => lineOf(home, index)),
    awayPlayers: away.players.map((_, index) => lineOf(away, index)),
    injuryEvents: [],
  };
}

/** One played game with index 0 scoring/assisting most, index 1 rebounding most. */
function playedGame(): SeasonGameSummary {
  const home = rosterOf('lakers');
  const away = rosterOf('celtics');
  const game = summary(home, away);
  return {
    ...game,
    homePlayers: home.players.map((_, index) =>
      lineOf(
        home,
        index,
        index === 0 ? { points: 30, assists: 9 } : index === 1 ? { offensiveRebounds: 10 } : {},
      ),
    ),
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

function renderStats(summaries: SeasonGameSummary[]) {
  const roster = rosterOf('lakers');
  const view = humanSeasonPlayerStats({
    roster,
    summaries,
    overallRatingOf: () => 87,
    playablePositions: () => ['PG', 'SG'],
  });
  return render(SeasonPlayerStats, {
    props: { view, manifest: MANIFEST, shell: minimalShell() },
  });
}

function firstRowName(container: HTMLElement, tableIndex: number): string | null {
  const row = container.querySelectorAll('table')[tableIndex]?.querySelector('tbody tr th');
  if (row === null || row === undefined) return null;
  const name = row.querySelector('span.font-semibold');
  const text = name?.textContent ?? null;
  return text === null ? null : text.trim();
}
describe('SeasonPlayerStats', () => {
  it('renders the empty state before any block is accepted', () => {
    const { getByText, queryByRole, container } = renderStats([]);
    expect(getByText('No season stats yet')).toBeTruthy();
    expect(getByText('Accept a block to fold per-player season stats.')).toBeTruthy();
    expect(queryByRole('button', { name: 'Sort by PPG' })).toBeNull();
    expect(container.querySelectorAll('table')).toHaveLength(0);
  });

  it('renders a mobile card list without relying on horizontal scroll', () => {
    const { container } = renderStats([playedGame()]);
    expect(container.querySelector('[data-season-player-stats-mobile]')).toBeTruthy();
    expect(container.querySelector('[data-season-player-stats-mobile] select')).toBeTruthy();
  });

  it('defaults to per-game rates sorted by PPG descending', () => {
    const { container } = renderStats([playedGame()]);
    const tables = container.querySelectorAll('table');
    expect(tables.length).toBeGreaterThan(0);
    const topScorer = rosterOf('lakers').players[0]?.displayName;
    expect(firstRowName(container, 0)).toBe(topScorer);
    expect(container.querySelectorAll('button[aria-label="Sort by PPG"]').length).toBe(1);
  });

  it('sorts by another column when its header is clicked', async () => {
    const { container, getAllByRole } = renderStats([playedGame()]);
    const rpgHeader = getAllByRole('button', { name: 'Sort by RPG' })[0];
    if (rpgHeader !== undefined) {
      await fireEvent.click(rpgHeader);
    }
    const topRebounder = rosterOf('lakers').players[1]?.displayName;
    expect(firstRowName(container, 0)).toBe(topRebounder);
  });

  it('toggles between per-game rates and season totals', async () => {
    const { container, getAllByRole, queryAllByRole } = renderStats([playedGame()]);
    expect(queryAllByRole('button', { name: 'Sort by PTS' })).toHaveLength(0);
    const totalsButton = getAllByRole('button', { name: 'Totals' })[0];
    if (totalsButton !== undefined) {
      await fireEvent.click(totalsButton);
    }
    expect(getAllByRole('button', { name: 'Sort by PTS' })).toHaveLength(1);
    expect(queryAllByRole('button', { name: 'Sort by PPG' })).toHaveLength(0);
    const topScorer = rosterOf('lakers').players[0]?.displayName;
    expect(firstRowName(container, 0)).toBe(topScorer);
  });
});
