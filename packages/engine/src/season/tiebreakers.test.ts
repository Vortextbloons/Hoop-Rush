import { describe, expect, it } from 'vitest';
import {
  buildLeague,
  franchiseIdSchema,
  seasonNamespaceSeed,
  SEASON_SEED_NAMESPACES,
  type SeasonLeague,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { franchisesInConference } from './league.ts';
import { rankSeasonPostseason, type SeasonConferenceRanking } from './tiebreakers.ts';
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const league = buildLeague();
interface TeamSpec {
  w: number;
  l: number;
  confW?: number;
  confL?: number;
  divW?: number;
  divL?: number;
  pf?: number;
  pa?: number;
  h2h?: Record<string, number>;
}
function conferenceWithTie(
  conference: 'east' | 'west',
  tied: readonly string[],
  tie: {
    w: number;
    l: number;
  },
  aboveCount: number,
): Record<string, TeamSpec> {
  const spec: Record<string, TeamSpec> = {};
  const teams = franchisesInConference(league, conference);
  let above = 0;
  let below = 0;
  for (const team of teams) {
    if (tied.includes(team)) {
      spec[team] = { w: tie.w, l: tie.l };
    } else if (above < aboveCount) {
      const w = tie.w + 12 + above;
      spec[team] = { w, l: 82 - w };
      above += 1;
    } else {
      const w = tie.w - 10 - below;
      spec[team] = { w, l: 82 - w };
      below += 1;
    }
  }
  return spec;
}
function clearConference(conference: 'east' | 'west'): Record<string, TeamSpec> {
  return conferenceWithTie(conference, [], { w: 0, l: 0 }, 0);
}
function standingsOf(spec: Record<string, TeamSpec>): SeasonStandings {
  const teamIds = league.teams.map((team) => team.franchiseId);
  const rows = teamIds.map((franchiseId) => {
    const teamSpec = spec[franchiseId] ?? { w: 0, l: 0 };
    return {
      franchiseId,
      wins: teamSpec.w,
      losses: teamSpec.l,
      gamesPlayed: teamSpec.w + teamSpec.l,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      conferenceWins: teamSpec.confW ?? 0,
      conferenceLosses: teamSpec.confL ?? 0,
      divisionWins: teamSpec.divW ?? 0,
      divisionLosses: teamSpec.divL ?? 0,
      pointsFor: teamSpec.pf ?? 0,
      pointsAgainst: teamSpec.pa ?? 0,
      headToHead: teamIds
        .filter((other) => other !== franchiseId)
        .map((other) => {
          const otherSpec = spec[other] ?? { w: 0, l: 0 };
          return {
            franchiseId: other,
            wins: teamSpec.h2h?.[other] ?? 0,
            losses: otherSpec.h2h?.[franchiseId] ?? 0,
          };
        }),
    };
  });
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows,
  };
}
function eastRanking(eastSpec: Record<string, TeamSpec>): SeasonConferenceRanking {
  const spec = { ...clearConference('west'), ...eastSpec };
  return rankSeasonPostseason(league, standingsOf(spec), SEED).east;
}
function overrides(
  base: Record<string, TeamSpec>,
  patch: Record<string, Partial<TeamSpec>>,
): Record<string, TeamSpec> {
  const result: Record<string, TeamSpec> = { ...base };
  for (const [franchiseId, values] of Object.entries(patch)) {
    result[franchiseId] = { ...(result[franchiseId] ?? { w: 0, l: 0 }), ...values };
  }
  return result;
}
describe('tiebreak ranking (M2.6, tiebreaker-v1)', () => {
  it('compares win percentage exactly, never raw wins, across unequal games', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [], { w: 0, l: 0 }, 0), {
      [a]: { w: 50, l: 30 },
      [b]: { w: 55, l: 40 },
    });
    const ranking = eastRanking(spec);
    expect(ranking.ranked.indexOf(a)).toBeLessThan(ranking.ranked.indexOf(b));
  });
  it('resolves a two-team tie by head-to-head record', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [a, b], { w: 40, l: 42 }, 0), {
      [a]: { h2h: { [b]: 3 } },
      [b]: { h2h: { [a]: 1 } },
    });
    const ranking = eastRanking(spec);
    expect(ranking.ranked[0]).toBe(a);
    expect(ranking.ranked[1]).toBe(b);
    const resolution = ranking.resolutions[0];
    expect(resolution?.rule).toBe('head-to-head');
    expect(resolution?.teams).toEqual([a, b]);
    expect(resolution?.evidence[0]?.value).toBe('3-1');
  });
  it('resolves a two-team tie by division-champion status', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const nets = east.find((id) => id === 'nets') ?? b;
    const spec = overrides(conferenceWithTie('east', [a, b], { w: 40, l: 42 }, 0), {
      [nets]: { w: 45, l: 37 },
    });
    const ranking = eastRanking(spec);
    expect(ranking.ranked.indexOf(a)).toBeLessThan(ranking.ranked.indexOf(b));
    expect(ranking.resolutions[0]?.rule).toBe('division-champion');
  });
  it('resolves a two-team tie by conference record', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [a, b], { w: 40, l: 42 }, 0), {
      [a]: { confW: 26, confL: 20 },
      [b]: { confW: 22, confL: 24 },
    });
    const ranking = eastRanking(spec);
    expect(ranking.ranked.indexOf(a)).toBeLessThan(ranking.ranked.indexOf(b));
    expect(ranking.resolutions[0]?.rule).toBe('conference-record');
  });
  it('resolves a two-team tie by deterministic draw with the recorded seed', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [a, b], { w: 40, l: 42 }, 0), {
      [a]: { confW: 24, confL: 22, pf: 8800, pa: 8800, h2h: { [b]: 2 } },
      [b]: { confW: 24, confL: 22, pf: 8800, pa: 8800, h2h: { [a]: 2 } },
    });
    const first = eastRanking(spec);
    const second = eastRanking(spec);
    const resolution = first.resolutions.find((entry) => entry.rule === 'random-draw');
    expect(resolution).toBeDefined();
    expect(resolution?.drawSeed).toBe(
      seasonNamespaceSeed(SEED, SEASON_SEED_NAMESPACES.postseasonTies, 'draw', ...[a, b].sort()),
    );
    expect(first.resolutions).toEqual(second.resolutions);
    expect(first.ranked).toEqual(second.ranked);
    const orders = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      const seed = seasonNamespaceSeed(SEED, 'probe', String(i));
      orders.add(rankSeasonPostseason(league, standingsOf(spec), seed).east.ranked.join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
  it('resolves a multi-team tie with partial separation and restart', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const c = east[4] ?? 'c';
    const spec = overrides(conferenceWithTie('east', [a, b, c], { w: 40, l: 42 }, 0), {
      [a]: { h2h: { [b]: 2, [c]: 2 } },
      [b]: { h2h: { [a]: 1, [c]: 1 }, confW: 10, confL: 2 },
      [c]: { h2h: { [a]: 1, [b]: 1 }, confW: 8, confL: 4 },
    });
    const ranking = eastRanking(spec);
    expect(ranking.ranked.slice(0, 3)).toEqual([a, b, c]);
    const first = ranking.resolutions[0];
    expect(first?.rule).toBe('head-to-head');
    expect(first?.teams).toEqual([a, c]);
    expect(first?.evidence[0]?.label).toContain('record among tied teams');
    const second = ranking.resolutions[1];
    expect(second?.rule).toBe('conference-record');
    expect(second?.teams).toEqual([b, c]);
  });
  it('records qualification-kind resolutions for play-in boundary ties', () => {
    const east = franchisesInConference(league, 'east');
    const seed7 = east[6] ?? 'a';
    const seed8 = east[7] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [seed7, seed8], { w: 38, l: 44 }, 6), {
      [seed7]: { h2h: { [seed8]: 3 } },
      [seed8]: { h2h: { [seed7]: 1 } },
    });
    const ranking = eastRanking(spec);
    expect(ranking.playInSeeds[0]).toBe(seed7);
    expect(ranking.playInSeeds[1]).toBe(seed8);
    expect(ranking.directSeeds).not.toContain(seed7);
    const resolution = ranking.resolutions.find((entry) =>
      entry.teams.includes(franchiseIdSchema.parse(seed7)),
    );
    expect(resolution?.kind).toBe('qualification');
    expect(resolution?.slots).toEqual([7, 8]);
  });
  it('produces identical results regardless of input ordering', () => {
    const east = franchisesInConference(league, 'east');
    const a = east[0] ?? 'a';
    const b = east[1] ?? 'b';
    const spec = overrides(conferenceWithTie('east', [a, b], { w: 40, l: 42 }, 0), {
      [a]: { h2h: { [b]: 3 } },
      [b]: { h2h: { [a]: 1 } },
    });
    const standings = standingsOf(spec);
    const shuffledRows = [...standings.rows].reverse();
    const shuffledLeague: SeasonLeague = {
      ...league,
      teams: [...league.teams].reverse(),
    };
    const canonical = rankSeasonPostseason(league, standings, SEED);
    const shuffled = rankSeasonPostseason(
      shuffledLeague,
      { ...standings, rows: shuffledRows },
      SEED,
    );
    expect(shuffled.east.ranked).toEqual(canonical.east.ranked);
    expect(shuffled.east.resolutions).toEqual(canonical.east.resolutions);
  });
  it('resolves a four-team total tie by deterministic draw with adjacent-pair records', () => {
    const east = franchisesInConference(league, 'east');
    const group = east.slice(0, 4);
    const spec = conferenceWithTie('east', group, { w: 40, l: 42 }, 0);
    const ranking = eastRanking(spec);
    expect([...ranking.ranked.slice(0, 4)].sort()).toEqual([...group].sort());
    const drawResolutions = ranking.resolutions.filter((entry) => entry.rule === 'random-draw');
    expect(drawResolutions.length).toBeGreaterThanOrEqual(1);
    for (const resolution of drawResolutions) {
      expect(resolution.drawSeed).toBeDefined();
      expect(resolution.teams.length).toBeGreaterThanOrEqual(2);
    }
    expect(eastRanking(spec).ranked).toEqual(ranking.ranked);
  });
  it('determines one division winner before applying champion priority', () => {
    const east = franchisesInConference(league, 'east');
    const hawks = east[0] ?? 'hawks';
    const celtics = east[1] ?? 'celtics';
    const hornets = east[3] ?? 'hornets';
    const spec = overrides(
      conferenceWithTie('east', [hawks, celtics, hornets], { w: 40, l: 42 }, 0),
      {
        [hawks]: { h2h: { [hornets]: 3 } },
        [hornets]: { h2h: { [celtics]: 3 } },
        [celtics]: { h2h: { [hawks]: 2 } },
      },
    );
    const ranking = eastRanking(spec);
    expect(ranking.ranked.slice(0, 3)).toEqual([celtics, hawks, hornets]);
    const championResolutions = ranking.resolutions.filter(
      (entry) => entry.rule === 'division-champion',
    );
    expect(championResolutions.length).toBeGreaterThanOrEqual(1);
    expect(eastRanking(spec).ranked).toEqual(ranking.ranked);
  });
});
