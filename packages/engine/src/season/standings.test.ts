import { describe, expect, it } from 'vitest';
import { franchiseIdSchema, seasonGameIdSchema, seasonStandingsSchema, type SeasonGame, type SeasonStandings, } from '@hoop-rush/data-contracts';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { createRng } from '../sim/rng.ts';
import { auditSeasonStandings, reduceSeasonStandings } from './standings.ts';
const league = buildSeasonLeague();
const teams = league.teams.map((team) => team.franchiseId);
function finalGame(index: number, homeFranchiseId: string, awayFranchiseId: string, homeScore: number, awayScore: number, round = (index % 82) + 1): SeasonGame {
    return {
        gameId: seasonGameIdSchema.parse(`s${String(index + 1).padStart(6, '0')}`),
        round,
        homeFranchiseId: franchiseIdSchema.parse(homeFranchiseId),
        awayFranchiseId: franchiseIdSchema.parse(awayFranchiseId),
        status: 'final',
        homeScore,
        awayScore,
        forfeitLoserFranchiseId: null,
    };
}
function forfeitGame(index: number, homeFranchiseId: string, awayFranchiseId: string, forfeitLoserFranchiseId: string): SeasonGame {
    return {
        gameId: seasonGameIdSchema.parse(`s${String(index + 1).padStart(6, '0')}`),
        round: (index % 82) + 1,
        homeFranchiseId: franchiseIdSchema.parse(homeFranchiseId),
        awayFranchiseId: franchiseIdSchema.parse(awayFranchiseId),
        status: 'forfeit',
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: franchiseIdSchema.parse(forfeitLoserFranchiseId),
    };
}
function scheduledGame(index: number, homeFranchiseId: string, awayFranchiseId: string): SeasonGame {
    return {
        gameId: seasonGameIdSchema.parse(`s${String(index + 1).padStart(6, '0')}`),
        round: (index % 82) + 1,
        homeFranchiseId: franchiseIdSchema.parse(homeFranchiseId),
        awayFranchiseId: franchiseIdSchema.parse(awayFranchiseId),
        status: 'scheduled',
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: null,
    };
}
function rowOf(standings: SeasonStandings, franchiseId: string) {
    const row = standings.rows.find((entry) => entry.franchiseId === franchiseId);
    if (!row)
        throw new Error(`no row for ${franchiseId}`);
    return row;
}
describe('reduceSeasonStandings', () => {
    it('produces schema-valid zero standings for an empty league', () => {
        const standings = reduceSeasonStandings(league, []);
        expect(seasonStandingsSchema.safeParse(standings).success).toBe(true);
        expect(standings.rows).toHaveLength(30);
        for (const row of standings.rows) {
            expect(row.wins).toBe(0);
            expect(row.losses).toBe(0);
            expect(row.gamesPlayed).toBe(0);
            expect(row.headToHead).toHaveLength(29);
        }
        expect(auditSeasonStandings(league, [], standings)).toEqual([]);
    });
    it('reduces a known set of finals into exact rows and splits', () => {
        const games = [
            finalGame(0, 'lakers', 'celtics', 110, 100),
            finalGame(1, 'celtics', 'lakers', 105, 99),
            finalGame(2, 'lakers', 'celtics', 88, 120),
            finalGame(3, 'lakers', 'warriors', 101, 90),
        ];
        const standings = reduceSeasonStandings(league, games);
        expect(auditSeasonStandings(league, games, standings)).toEqual([]);
        const lakers = rowOf(standings, 'lakers');
        const celtics = rowOf(standings, 'celtics');
        expect(lakers.wins).toBe(2);
        expect(lakers.losses).toBe(2);
        expect(lakers.gamesPlayed).toBe(4);
        expect(lakers.homeWins).toBe(2);
        expect(lakers.homeLosses).toBe(1);
        expect(lakers.awayWins).toBe(0);
        expect(lakers.awayLosses).toBe(1);
        expect(lakers.pointsFor).toBe(398);
        expect(lakers.pointsAgainst).toBe(415);
        const lakersVsCeltics = lakers.headToHead.find((entry) => entry.franchiseId === 'celtics');
        expect(lakersVsCeltics?.wins).toBe(1);
        expect(lakersVsCeltics?.losses).toBe(2);
        const celticsVsLakers = celtics.headToHead.find((entry) => entry.franchiseId === 'lakers');
        expect(celticsVsLakers?.wins).toBe(2);
        expect(celticsVsLakers?.losses).toBe(1);
        expect(celtics.wins).toBe(2);
        expect(celtics.losses).toBe(1);
    });
    it('records conference and division splits only for same-conference games', () => {
        const games = [
            finalGame(0, 'lakers', 'clippers', 100, 90),
            finalGame(1, 'lakers', 'celtics', 100, 90),
            finalGame(2, 'lakers', 'warriors', 90, 100),
        ];
        const standings = reduceSeasonStandings(league, games);
        const lakers = rowOf(standings, 'lakers');
        expect(lakers.conferenceWins).toBe(1);
        expect(lakers.conferenceLosses).toBe(1);
        expect(lakers.divisionWins).toBe(1);
        expect(lakers.divisionLosses).toBe(1);
    });
    it('counts a forfeit as the official 2-0 result', () => {
        const games = [forfeitGame(0, 'lakers', 'celtics', 'celtics')];
        const standings = reduceSeasonStandings(league, games);
        expect(auditSeasonStandings(league, games, standings)).toEqual([]);
        const lakers = rowOf(standings, 'lakers');
        const celtics = rowOf(standings, 'celtics');
        expect(lakers.wins).toBe(1);
        expect(lakers.losses).toBe(0);
        expect(lakers.pointsFor).toBe(2);
        expect(lakers.pointsAgainst).toBe(0);
        expect(celtics.wins).toBe(0);
        expect(celtics.losses).toBe(1);
        expect(celtics.pointsFor).toBe(0);
        expect(celtics.pointsAgainst).toBe(2);
        expect(lakers.headToHead.find((entry) => entry.franchiseId === 'celtics')).toMatchObject({
            wins: 1,
            losses: 0,
        });
    });
    it('ignores scheduled games', () => {
        const games = [
            scheduledGame(0, 'lakers', 'celtics'),
            finalGame(1, 'lakers', 'celtics', 100, 90),
        ];
        const standings = reduceSeasonStandings(league, games);
        expect(rowOf(standings, 'lakers').gamesPlayed).toBe(1);
        expect(rowOf(standings, 'celtics').gamesPlayed).toBe(1);
    });
    it('throws on games referencing franchises outside the league', () => {
        const games = [finalGame(0, 'lakers', 'sonics', 100, 90)];
        expect(() => reduceSeasonStandings(league, games)).toThrow();
    });
    it('throws on tied finals and finals without scores', () => {
        const tied = [finalGame(0, 'lakers', 'celtics', 100, 100)];
        expect(() => reduceSeasonStandings(league, tied)).toThrow();
        const missing = [{ ...finalGame(0, 'lakers', 'celtics', 100, 90), homeScore: null }];
        expect(() => reduceSeasonStandings(league, missing)).toThrow();
    });
    it('reduces a seeded league slate with exact global reconciliation', () => {
        const rng = createRng('standings-property-slate');
        const games: SeasonGame[] = [];
        const pairCounts = new Map<string, number>();
        for (let i = 0; i < 300; i += 1) {
            const home = rng.pick(teams);
            let away = rng.pick(teams);
            while (away === home) {
                away = rng.pick(teams);
            }
            const key = [home, away].sort().join('\u0000');
            pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
            const homeScore = rng.nextInt(70, 140);
            let awayScore = rng.nextInt(70, 140);
            while (awayScore === homeScore) {
                awayScore = rng.nextInt(70, 140);
            }
            games.push(finalGame(i, home, away, homeScore, awayScore));
        }
        const standings = reduceSeasonStandings(league, games);
        expect(auditSeasonStandings(league, games, standings)).toEqual([]);
        const totalWins = standings.rows.reduce((sum, row) => sum + row.wins, 0);
        const totalLosses = standings.rows.reduce((sum, row) => sum + row.losses, 0);
        const totalPointsFor = standings.rows.reduce((sum, row) => sum + row.pointsFor, 0);
        const totalPointsAgainst = standings.rows.reduce((sum, row) => sum + row.pointsAgainst, 0);
        expect(totalWins).toBe(totalLosses);
        expect(totalWins).toBe(300);
        expect(totalPointsFor).toBe(totalPointsAgainst);
        for (const row of standings.rows) {
            expect(row.gamesPlayed).toBe(row.wins + row.losses);
            expect(row.homeWins + row.homeLosses + row.awayWins + row.awayLosses).toBe(row.gamesPlayed);
        }
    });
});
describe('auditSeasonStandings', () => {
    const games = [
        finalGame(0, 'lakers', 'celtics', 110, 100),
        finalGame(1, 'celtics', 'lakers', 105, 99),
        finalGame(2, 'lakers', 'warriors', 101, 90),
    ];
    const standings = reduceSeasonStandings(league, games);
    it('detects corrupted wins, losses, and scores', () => {
        const corrupt = (mutate: (standings: SeasonStandings) => SeasonStandings): string[] => auditSeasonStandings(league, games, mutate(structuredClone(standings)));
        expect(corrupt((s) => {
            const row = s.rows.find((entry) => entry.franchiseId === 'lakers');
            if (row)
                row.wins += 1;
            return s;
        }).some((failure) => failure.includes('lakers wins'))).toBe(true);
        expect(corrupt((s) => {
            const row = s.rows.find((entry) => entry.franchiseId === 'lakers');
            if (row)
                row.pointsFor -= 1;
            return s;
        }).some((failure) => failure.includes('lakers pointsFor'))).toBe(true);
        expect(corrupt((s) => {
            const row = s.rows.find((entry) => entry.franchiseId === 'lakers');
            const against = row?.headToHead.find((entry) => entry.franchiseId === 'celtics');
            if (against)
                against.wins += 1;
            return s;
        }).some((failure) => failure.includes('head-to-head vs celtics wins'))).toBe(true);
    });
    it('detects missing rows and duplicate rows', () => {
        const withoutLakers = {
            ...standings,
            rows: standings.rows.filter((row) => row.franchiseId !== 'lakers'),
        };
        expect(auditSeasonStandings(league, games, withoutLakers).length).toBeGreaterThan(0);
        const firstRow = standings.rows[0];
        if (!firstRow)
            throw new Error('no standings rows');
        const duplicated = { ...standings, rows: [...standings.rows, firstRow] };
        expect(auditSeasonStandings(league, games, duplicated).length).toBeGreaterThan(0);
    });
    it('rejects a table that contradicts a finalized game', () => {
        const tampered = structuredClone(standings);
        const lakers = tampered.rows.find((row) => row.franchiseId === 'lakers');
        if (lakers)
            lakers.gamesPlayed = 99;
        expect(auditSeasonStandings(league, games, tampered)).not.toEqual([]);
    });
});
