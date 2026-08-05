// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { buildManifest, buildSeasonLeague } from '@hoop-rush/test-fixtures';
import type {
  HoopRushManifest,
  SeasonLeague,
  SeasonRosterEntry,
  SeasonStandings,
} from '@hoop-rush/data-contracts';
import BoxScore from '$lib/components/season/BoxScore.svelte';
import LeadersTable from '$lib/components/season/LeadersTable.svelte';
import StandingsTable from '$lib/components/season/StandingsTable.svelte';
import type { BoxScore as BoxScoreData, BoxScoreRow } from '$lib/season/season-presentation';
import type { SeasonFaceRef } from '$lib/season/season-branding';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * Season view component tests (M2.3.5): the restyled StandingsTable (ranked
 * cards + semantic table, human highlighted), BoxScore (compact primary
 * stats with an expandable full-stat table), and LeadersTable (headshot-led
 * first-place card + ranked rows with distinct player-season versions).
 */

const MANIFEST: HoopRushManifest = buildManifest();
const LEAGUE: SeasonLeague = buildSeasonLeague();

function buildStandings(): SeasonStandings {
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: LEAGUE.teams.map((team, index) => {
      const wins = team.franchiseId === 'lakers' ? 8 : index % 11;
      const losses = 10 - wins;
      return {
        franchiseId: team.franchiseId,
        wins,
        losses,
        gamesPlayed: 10,
        homeWins: Math.floor(wins / 2),
        homeLosses: 5 - Math.floor(wins / 2),
        awayWins: wins - Math.floor(wins / 2),
        awayLosses: losses - (5 - Math.floor(wins / 2)),
        conferenceWins: wins,
        conferenceLosses: losses,
        divisionWins: wins,
        divisionLosses: losses,
        pointsFor: 1000 + wins * 10,
        pointsAgainst: 1000 + losses * 12,
        headToHead: [],
      };
    }),
  };
}

function renderStandings() {
  return render(StandingsTable, {
    props: {
      standings: buildStandings(),
      league: LEAGUE,
      humanFranchiseId: 'lakers',
      franchiseName: (franchiseId: string) => franchiseId,
      streakOf: () => ({ kind: 'wins' as const, length: 3 }),
      conference: null,
      manifest: MANIFEST,
    },
  });
}

function playerRow(name: string, points: number): BoxScoreRow {
  return {
    playerVersionId: `p-${name}`,
    displayName: name,
    position: 'SG',
    seconds: 1440,
    points,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 2,
    freeThrowsAttempted: 2,
    offensiveRebounds: 1,
    defensiveRebounds: 3,
    assists: 5,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 3,
  };
}

function makeBox(): BoxScoreData {
  return {
    team: {
      franchiseId: 'lakers',
      points: 100,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 88,
      threePointersMade: 10,
      threePointersAttempted: 30,
      freeThrowsMade: 10,
      freeThrowsAttempted: 14,
      offensiveRebounds: 10,
      defensiveRebounds: 30,
      assists: 24,
      steals: 7,
      blocks: 5,
      turnovers: 13,
      fouls: 19,
      possessions: 96,
    },
    players: [playerRow('Alpha', 30), playerRow('Beta', 22), playerRow('Gamma', 18)],
    opponent: { franchiseId: 'celtics', points: 95 },
    won: true,
  };
}

function rosterEntry(playerVersionId: string, seasonKey: string): SeasonRosterEntry {
  return {
    playerVersionId,
    playerId: `person-${playerVersionId}`,
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey,
    displayName: playerVersionId,
  };
}

function face(playerVersionId: string): SeasonFaceRef {
  return {
    playerId: `person-${playerVersionId}`,
    playerExternalId: '',
    altIds: null,
    initials: playerVersionId.slice(0, 2).toUpperCase(),
  };
}

const LEADER_ENTRIES = [
  { playerVersionId: 'v-star', franchiseId: 'lakers', gamesPlayed: 10, value: 250, perGame: 25 },
  { playerVersionId: 'v-second', franchiseId: 'celtics', gamesPlayed: 10, value: 240, perGame: 24 },
  { playerVersionId: 'v-third', franchiseId: 'hawks', gamesPlayed: 10, value: 230, perGame: 23 },
  { playerVersionId: 'v-fourth', franchiseId: 'bulls', gamesPlayed: 10, value: 220, perGame: 22 },
];

function renderLeaders() {
  return render(LeadersTable, {
    props: {
      category: 'points',
      entries: LEADER_ENTRIES,
      rosterByVersion: new Map(
        LEADER_ENTRIES.map((entry) => [
          entry.playerVersionId,
          rosterEntry(entry.playerVersionId, '1995-96'),
        ]),
      ),
      faces: new Map(
        LEADER_ENTRIES.map((entry) => [entry.playerVersionId, face(entry.playerVersionId)]),
      ),
      manifest: MANIFEST,
      playerName: (playerVersionId: string) => playerVersionId,
      franchiseAbbrev: (franchiseId: string) => franchiseId.toUpperCase(),
    },
  });
}

describe('StandingsTable', () => {
  it('renders both conferences with the provisional footnote', () => {
    const { getByRole, getByText } = renderStandings();
    expect(getByRole('heading', { name: 'East · provisional' })).not.toBeNull();
    expect(getByRole('heading', { name: 'West · provisional' })).not.toBeNull();
    expect(getByText(/M2\.6 postseason tiebreak is not applied/)).not.toBeNull();
  });

  it('highlights the human row with a your-team label', () => {
    const { getByRole, getAllByRole } = renderStandings();
    const row = getByRole('row', { name: /lakers \(your team\)/ });
    expect(row).not.toBeNull();
    const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => cell.textContent);
    expect(cells.join(' ')).toContain('8');
    expect(cells.join(' ')).toContain('2');
    // Every standings row carries the data hook (cards and table rows).
    expect(getAllByRole('row').length).toBeGreaterThanOrEqual(31);
  });

  it('renders every ranked row with rank, record, and splits data', () => {
    const { container } = renderStandings();
    const rows = container.querySelectorAll('[data-season-standings-row]');
    expect(rows.length).toBe(60); // 30 cards + 30 table rows in jsdom
    const text = container.textContent;
    expect(text).toContain('3 W');
    expect(text).toContain('Home');
    expect(text).toContain('Conference');
  });
});

describe('BoxScore', () => {
  it('shows the compact primary stats with no full columns, then expands to the full table', async () => {
    const { getAllByText, container } = render(BoxScore, {
      props: {
        box: makeBox(),
        opponentName: 'celtics',
        resultLabel: 'W',
        manifest: MANIFEST,
        teamFranchiseId: 'lakers',
        opponentFranchiseId: 'celtics',
      },
    });
    // jsdom renders all three tables (mobile compact, disclosure full, and
    // desktop full — the Tailwind responsive classes hide nothing in jsdom),
    // so player names and column headers match once per table.
    expect(getAllByText('Alpha').length).toBe(3);
    expect(getAllByText('Pts').length).toBeGreaterThanOrEqual(3);
    expect(getAllByText('Reb').length).toBeGreaterThanOrEqual(3);
    expect(getAllByText('Ast').length).toBeGreaterThanOrEqual(3);
    expect(getAllByText('3PT').length).toBe(2); // full tables only

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    const summary = container.querySelector('details > summary');
    expect(summary?.textContent).toContain('Full stats');
    if (summary) {
      await fireEvent.click(summary);
    }
    expect(details?.hasAttribute('open')).toBe(true);
    // The full table only appears inside the disclosure, not in the compact
    // primary-stat view; both full tables (disclosure + desktop) carry the
    // 13-column headers.
    expect(getAllByText('TO', { exact: true }).length).toBe(2);
  });

  it('reports the result and opponent in the header', () => {
    const { getByText } = render(BoxScore, {
      props: { box: makeBox(), opponentName: 'celtics', resultLabel: 'W' },
    });
    expect(getByText('100 – 95')).not.toBeNull();
    expect(getByText(/vs celtics/)).not.toBeNull();
  });
});

describe('LeadersTable', () => {
  it('renders a headshot-led first-place card and ranked rows', () => {
    const { getByRole, getByText } = renderLeaders();
    expect(getByRole('heading', { name: 'Points' })).not.toBeNull();
    // First-place card shows the leader's name, total value, and per-game.
    expect(getByText('v-star')).not.toBeNull();
    expect(getByText('250')).not.toBeNull(); // value total
    expect(getByText('25.0/g')).not.toBeNull(); // per-game rate
    // Ranked rows 2-4.
    expect(getByRole('listitem', { name: /Rank 2: v-second/ })).not.toBeNull();
    expect(getByRole('listitem', { name: /Rank 3: v-third/ })).not.toBeNull();
    expect(getByRole('listitem', { name: /Rank 4: v-fourth/ })).not.toBeNull();
  });

  it('keeps player-season versions distinct with season labels', () => {
    const { getAllByText, container } = renderLeaders();
    // Every version row shows its season; all four entries share 1995-96.
    expect(getAllByText(/1995-96/).length).toBeGreaterThanOrEqual(4);
    const sections = container.querySelectorAll('[data-season-leaders-category="points"]');
    expect(sections.length).toBe(1);
  });
});
