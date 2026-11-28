import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import FullCourtReportSummary from './FullCourtReportSummary.svelte';
import FullCourtReportRoster from './FullCourtReportRoster.svelte';
import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';
import type { FullCourtReportData } from './full-court-report-data.ts';
import type { FullCourtPlayerSeasonRow, FullCourtStandingsRow } from '@hoop-rush/engine';

function row(overrides: Partial<FullCourtPlayerSeasonRow> = {}): FullCourtPlayerSeasonRow {
  return {
    playerId: 'p-1',
    displayName: 'Alex Star',
    positions: ['SG'],
    teamId: 'team-a',
    teamName: 'Alpha',
    games: 82,
    starts: 82,
    minutes: 2400,
    mpg: 29.3,
    ppg: 24.5,
    rpg: 6.1,
    apg: 5.2,
    spg: 1.2,
    bpg: 0.4,
    topg: 2.1,
    tpmPg: 2.5,
    fgPct: 48.2,
    tpPct: 38.1,
    ftPct: 84,
    tsPct: 58.4,
    points: 2009,
    rebounds: 500,
    offRebounds: 60,
    defRebounds: 440,
    assists: 426,
    steals: 98,
    blocks: 33,
    turnovers: 172,
    fouls: 190,
    fgm: 720,
    fga: 1494,
    tpm: 205,
    tpa: 538,
    ftm: 364,
    fta: 433,
    gameScorePg: 17.2,
    ...overrides,
  } as FullCourtPlayerSeasonRow;
}

const entry = {
  runId: 'run-abc123',
  completedDateLabel: '11/27/2026',
  teamName: 'Milwaukee Bucks',
  variant: 'standard',
  variantLabel: 'Full Court Standard',
  regularRecordLabel: '67–15',
  pointDiffLabel: '+1000',
  benchSummaryLabel: 'Bench scoring: 819 total · 9 average over 91 games',
  benchBestGameLabel: 'Best bench game: 21 points in game 69',
  playoffStatus: 'eliminated',
  playoffLabel: 'Eliminated · Conference semifinals',
  playoffTone: 'negative',
  championName: 'Los Angeles Lakers',
  seriesWon: 1,
  payrollLabel: '$195.3M',
  capStatus: 'under-cap',
  capStatusLabel: 'Under the cap',
  capStatusClass: 'text-positive',
  warChestSpentLabel: '$205.3M',
  warChestRemainingLabel: '$44.7M',
  scoutingSpentLabel: '$10M',
  strategySummary: 'Fast pace · Balanced offense · Balanced defense',
  customRotation: false,
  roster: [
    {
      playerId: 'p-1',
      playerVersionId: 'v-1',
      displayName: 'Alex Star',
      seasonKey: '2025-26',
      teamAbbreviation: 'LAL',
      position: 'SG',
      overall: 98,
      salaryLabel: '$69M',
      minutesTarget: 36,
      starter: true,
      closer: true,
    },
    {
      playerId: 'p-2',
      playerVersionId: 'v-2',
      displayName: 'Bench Spark',
      seasonKey: '2025-26',
      teamAbbreviation: 'LAL',
      position: 'SF',
      overall: 82,
      salaryLabel: '$12M',
      minutesTarget: 22,
      starter: false,
      closer: false,
    },
  ],
  achievements: [{ id: 'bench-mob' as const, name: 'Bench Mob' }],
} as unknown as FullCourtHistoryEntryView;

const userRow = {
  teamId: 'team-a',
  displayName: 'Milwaukee Bucks',
  conference: 'east',
  division: 'central',
  wins: 67,
  losses: 15,
  conferenceWins: 44,
  conferenceLosses: 8,
  pointsFor: 9200,
  pointsAgainst: 8200,
  pointDifferential: 1000,
  seed: 1,
  qualified: true,
} as unknown as FullCourtStandingsRow;

const data = {
  record: {
    runId: 'run-abc123',
    completedAtIso: '2026-11-27T00:00:00.000Z',
    coaching: {
      rotation: { startingFive: ['p-1'], closingFive: ['p-1'], minuteTargets: { 'p-1': 36 } },
    },
    teamName: 'Milwaukee Bucks',
    teamId: 'team-a',
  },
  playerRows: [row(), row({ playerId: 'p-2', displayName: 'Bench Spark', ppg: 12.1 })],
  standings: { west: [], east: [], qualifiedTeamIds: [] },
  seasonLock: { season: { userTeamId: 'team-a', teams: [] } },
  bracket: null,
} as unknown as FullCourtReportData;

describe('FullCourtReport tabs', () => {
  test('summary shows record, economy, strategy, and bench facts', () => {
    const body = render(FullCourtReportSummary, {
      props: { entry, rosterStats: data.playerRows, userRow },
    }).body;
    expect(body).toContain('67–15');
    expect(body).toContain('$205.3M');
    expect(body).toContain('Fast pace');
    expect(body).toContain('Best bench game');
    expect(body).toContain('#1 seed');
  });

  test('roster shows every signed player with role and per-game stats', () => {
    const body = render(FullCourtReportRoster, {
      props: { entry, data, art: null },
    }).body;
    expect(body).toContain('Alex Star');
    expect(body).toContain('Bench Spark');
    expect(body).toContain('Starter');
    expect(body).toContain('Closer');
    expect(body).toContain('36m target');
    expect(body).toContain('24.5');
    expect(body).toContain('Bench Mob');
  });
});
