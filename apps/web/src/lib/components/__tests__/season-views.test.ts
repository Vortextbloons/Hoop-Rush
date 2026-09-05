import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { buildManifest, buildSeasonLeague } from '@hoop-rush/test-fixtures';
import type {
  HoopRushManifest,
  SeasonLeague,
  SeasonRosterEntry,
  SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import BoxScore from '$lib/components/season/BoxScore.svelte';
import LeadersTable from '$lib/components/season/LeadersTable.svelte';
import StandingsTable from '$lib/components/season/StandingsTable.svelte';
import type { BoxScore as BoxScoreData, BoxScoreRow } from '$lib/season/season-presentation';
import type { SeasonFaceRef } from '$lib/season/season-branding';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
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
    fourPointersMade: 0,
    fourPointersAttempted: 0,
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
      franchiseId: franchiseIdSchema.parse('lakers'),
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
  const parsedSeasonKey = seasonKeySchema.parse(seasonKey);
  return {
    playerVersionId,
    playerId: playerIdSchema.parse(`person-${playerVersionId}`),
    franchiseId: franchiseIdSchema.parse('lakers'),
    eraId: eraIdSchema.parse('1990s'),
    seasonKey: parsedSeasonKey,
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
  {
    playerVersionId: 'v-star',
    franchiseId: franchiseIdSchema.parse('lakers'),
    gamesPlayed: 10,
    value: 250,
    perGame: 25,
  },
  {
    playerVersionId: 'v-second',
    franchiseId: franchiseIdSchema.parse('celtics'),
    gamesPlayed: 10,
    value: 240,
    perGame: 24,
  },
  {
    playerVersionId: 'v-third',
    franchiseId: franchiseIdSchema.parse('hawks'),
    gamesPlayed: 10,
    value: 230,
    perGame: 23,
  },
  {
    playerVersionId: 'v-fourth',
    franchiseId: franchiseIdSchema.parse('bulls'),
    gamesPlayed: 10,
    value: 220,
    perGame: 22,
  },
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
    expect(getAllByRole('row').length).toBeGreaterThanOrEqual(31);
  });
});
describe('BoxScore', () => {
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
    expect(getByText('v-star')).not.toBeNull();
    expect(getByText('250')).not.toBeNull();
    expect(getByText('25.0/g')).not.toBeNull();
    expect(getByRole('listitem', { name: /Rank 2: v-second/ })).not.toBeNull();
    expect(getByRole('listitem', { name: /Rank 3: v-third/ })).not.toBeNull();
    expect(getByRole('listitem', { name: /Rank 4: v-fourth/ })).not.toBeNull();
  });
  it('keeps player-season versions distinct with season labels', () => {
    const { getAllByText, container } = renderLeaders();
    expect(getAllByText(/1995-96/).length).toBeGreaterThanOrEqual(4);
    const sections = container.querySelectorAll('[data-season-leaders-category="points"]');
    expect(sections.length).toBe(1);
  });
});
