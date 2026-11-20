import { describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  type CapRushConference,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPlayoffSeeds,
  fullCourtStandings,
  type FullCourtStandings,
  type FullCourtStandingsRow,
} from './standings.ts';

const FIELD = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
  teamId: franchiseId,
  displayName: franchiseId,
}));

function scoreFactory() {
  let next = 1;
  function base(homeTeamId: string, awayTeamId: string) {
    const ordinal = next;
    next += 1;
    return {
      gameId: `fc-standings-${String(ordinal)}`,
      slot: ((ordinal - 1) % 82) + 1,
      homeTeamId,
      awayTeamId,
    };
  }
  return {
    played(
      homeTeamId: string,
      awayTeamId: string,
      homePoints: number,
      awayPoints: number,
    ): FullCourtSeasonScore {
      return {
        ...base(homeTeamId, awayTeamId),
        outcome: { kind: 'played', homePoints, awayPoints },
      };
    },
    forfeit(
      homeTeamId: string,
      awayTeamId: string,
      losingSides: ('home' | 'away')[],
    ): FullCourtSeasonScore {
      return {
        ...base(homeTeamId, awayTeamId),
        outcome: { kind: 'forfeit', losingSides },
      };
    },
  };
}

function rowOf(standings: FullCourtStandings, teamId: string): FullCourtStandingsRow {
  const row = [...standings.east, ...standings.west].find((entry) => entry.teamId === teamId);
  if (row === undefined) throw new Error(`Missing standings row for ${teamId}`);
  return row;
}

function indexOf(standings: FullCourtStandings, teamId: string): number {
  const index = [...standings.east, ...standings.west].findIndex(
    (entry) => entry.teamId === teamId,
  );
  if (index < 0) throw new Error(`Missing standings row for ${teamId}`);
  return index;
}

function conferenceRows(
  standings: FullCourtStandings,
  conference: CapRushConference,
): readonly FullCourtStandingsRow[] {
  return standings[conference];
}

describe('full court standings', () => {
  test('splits the field by conference and seeds every row deterministically', () => {
    const standings = fullCourtStandings(FIELD, []);

    expect(standings.west).toHaveLength(15);
    expect(standings.east).toHaveLength(15);
    for (const conference of ['west', 'east'] as const) {
      const rows = conferenceRows(standings, conference);
      expect(rows.map((row) => row.teamId)).toEqual([...rows.map((row) => row.teamId)].sort());
      expect(rows.map((row) => row.seed)).toEqual(
        Array.from({ length: 15 }, (_, index) => index + 1),
      );
      expect(rows.every((row) => row.conference === conference)).toBe(true);
      expect(rows.map((row) => row.qualified)).toEqual([
        ...Array.from({ length: 8 }, () => true),
        ...Array.from({ length: 7 }, () => false),
      ]);
    }

    const seeds = fullCourtPlayoffSeeds(standings);
    expect(seeds.west).toEqual(standings.west.slice(0, 8).map((row) => row.teamId));
    expect(seeds.east).toEqual(standings.east.slice(0, 8).map((row) => row.teamId));
    expect(standings.qualifiedTeamIds).toEqual([...seeds.west, ...seeds.east]);
    expect(fullCourtStandings([...FIELD].reverse(), [])).toEqual(standings);
  });

  test('breaks a wins tie by head-to-head before point differential', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'knicks', 100, 90),
      scores.played('heat', 'celtics', 100, 80),
      scores.played('knicks', 'magic', 100, 80),
      scores.played('heat', 'magic', 100, 80),
    ];
    const standings = fullCourtStandings(FIELD, results);

    expect(rowOf(standings, 'celtics')).toMatchObject({ wins: 1, losses: 1 });
    expect(rowOf(standings, 'knicks')).toMatchObject({ wins: 1, losses: 1 });
    expect(indexOf(standings, 'heat')).toBeLessThan(indexOf(standings, 'celtics'));
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
    expect(fullCourtStandings(FIELD, [...results].reverse())).toEqual(standings);
  });

  test('breaks a head-to-head tie by conference record', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('heat', 'celtics', 100, 90),
      scores.played('celtics', 'lakers', 100, 90),
      scores.played('knicks', 'magic', 100, 90),
      scores.played('warriors', 'knicks', 100, 90),
    ];
    const standings = fullCourtStandings(FIELD, results);

    expect(rowOf(standings, 'celtics')).toMatchObject({
      wins: 1,
      losses: 1,
      conferenceWins: 0,
      conferenceLosses: 1,
    });
    expect(rowOf(standings, 'knicks')).toMatchObject({
      wins: 1,
      losses: 1,
      conferenceWins: 1,
      conferenceLosses: 0,
    });
    expect(indexOf(standings, 'knicks')).toBeLessThan(indexOf(standings, 'celtics'));
  });

  test('a circular three-team tie falls through consistently to point differential', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'knicks', 120, 100),
      scores.played('knicks', 'heat', 101, 100),
      scores.played('heat', 'celtics', 130, 125),
    ];
    const standings = fullCourtStandings(FIELD, results);
    expect(standings.east.slice(0, 3).map((team) => team.teamId)).toEqual([
      'celtics',
      'heat',
      'knicks',
    ]);
    expect(fullCourtStandings([...FIELD].reverse(), [...results].reverse())).toEqual(standings);
  });

  test('breaks a conference tie by point differential', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'lakers', 120, 100),
      scores.played('warriors', 'celtics', 100, 90),
      scores.played('knicks', 'suns', 110, 100),
      scores.played('kings', 'knicks', 100, 80),
    ];
    const standings = fullCourtStandings(FIELD, results);

    expect(rowOf(standings, 'celtics').pointDifferential).toBe(10);
    expect(rowOf(standings, 'knicks').pointDifferential).toBe(-10);
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
  });

  test('breaks a differential tie by points for', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'lakers', 150, 100),
      scores.played('warriors', 'celtics', 130, 90),
      scores.played('knicks', 'suns', 130, 100),
      scores.played('kings', 'knicks', 120, 100),
    ];
    const standings = fullCourtStandings(FIELD, results);

    expect(rowOf(standings, 'celtics')).toMatchObject({
      pointDifferential: 10,
      pointsFor: 240,
    });
    expect(rowOf(standings, 'knicks')).toMatchObject({
      pointDifferential: 10,
      pointsFor: 230,
    });
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
  });

  test('breaks a points-for tie by team id', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'lakers', 100, 90),
      scores.played('warriors', 'celtics', 90, 80),
      scores.played('knicks', 'suns', 100, 90),
      scores.played('kings', 'knicks', 90, 80),
    ];
    const standings = fullCourtStandings(FIELD, results);

    expect(rowOf(standings, 'celtics')).toMatchObject({
      pointDifferential: 0,
      pointsFor: 180,
    });
    expect(rowOf(standings, 'knicks')).toMatchObject({
      pointDifferential: 0,
      pointsFor: 180,
    });
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
  });

  test('a single forfeit counts as a win, conference result and head-to-head result', () => {
    const scores = scoreFactory();
    const results = [
      scores.forfeit('celtics', 'knicks', ['home']),
      scores.played('celtics', 'magic', 100, 90),
      scores.played('heat', 'knicks', 100, 90),
    ];
    const standings = fullCourtStandings(FIELD, results);
    const celtics = rowOf(standings, 'celtics');
    const knicks = rowOf(standings, 'knicks');

    expect(celtics).toMatchObject({
      wins: 1,
      losses: 1,
      conferenceWins: 1,
      conferenceLosses: 1,
      pointsFor: 100,
      pointsAgainst: 90,
    });
    expect(knicks).toMatchObject({
      wins: 1,
      losses: 1,
      conferenceWins: 1,
      conferenceLosses: 1,
      pointsFor: 90,
      pointsAgainst: 100,
    });
    expect(indexOf(standings, 'knicks')).toBeLessThan(indexOf(standings, 'celtics'));
  });

  test('an away forfeit awards the home side', () => {
    const scores = scoreFactory();
    const standings = fullCourtStandings(FIELD, [scores.forfeit('lakers', 'rockets', ['away'])]);

    expect(rowOf(standings, 'lakers')).toMatchObject({
      wins: 1,
      losses: 0,
      conferenceWins: 1,
      conferenceLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
    expect(rowOf(standings, 'rockets')).toMatchObject({
      wins: 0,
      losses: 1,
      conferenceWins: 0,
      conferenceLosses: 1,
    });
  });

  test('a forfeit never contributes points to the differential tiebreak', () => {
    const scores = scoreFactory();
    const results = [
      scores.played('celtics', 'lakers', 101, 100),
      scores.played('warriors', 'celtics', 100, 90),
      scores.forfeit('suns', 'knicks', ['home']),
      scores.played('kings', 'knicks', 100, 80),
    ];
    const standings = fullCourtStandings(FIELD, results);
    const celtics = rowOf(standings, 'celtics');
    const knicks = rowOf(standings, 'knicks');

    expect(celtics).toMatchObject({ wins: 1, losses: 1, pointDifferential: -9 });
    expect(knicks).toMatchObject({
      wins: 1,
      losses: 1,
      pointsFor: 80,
      pointsAgainst: 100,
      pointDifferential: -20,
    });
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
  });

  test('a double forfeit counts as a loss for both with no head-to-head win', () => {
    const scores = scoreFactory();
    const standings = fullCourtStandings(FIELD, [
      scores.forfeit('celtics', 'knicks', ['home', 'away']),
    ]);
    const celtics = rowOf(standings, 'celtics');
    const knicks = rowOf(standings, 'knicks');

    expect(celtics).toMatchObject({
      wins: 0,
      losses: 1,
      conferenceWins: 0,
      conferenceLosses: 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
    });
    expect(knicks).toMatchObject({
      wins: 0,
      losses: 1,
      conferenceWins: 0,
      conferenceLosses: 1,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
    });
    expect(indexOf(standings, 'celtics')).toBeLessThan(indexOf(standings, 'knicks'));
  });

  test('rejects duplicate games and unknown teams', () => {
    const scores = scoreFactory();
    const played = scores.played('celtics', 'knicks', 100, 90);
    expect(() => fullCourtStandings(FIELD, [played, { ...played }])).toThrow('duplicate game');
    expect(() =>
      fullCourtStandings(FIELD, [scores.played('celtics', 'not-a-team', 100, 90)]),
    ).toThrow('unknown team');
  });
});
