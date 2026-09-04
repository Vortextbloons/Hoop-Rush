import { describe, expect, it } from 'vitest';
import type { SeasonHealthState, SeasonInjuryRecord, SeasonRoster, } from '@hoop-rush/data-contracts';
import { eraIdSchema, franchiseIdSchema, playerIdSchema, seasonGameIdSchema, seasonKeySchema, } from '@hoop-rush/data-contracts';
import { activeInjuriesOf, availabilityStripRows, humanInjuryTimeline, injuryStatusOf, recoveryEstimate, recurrenceOf, } from './season-health-view';
const INJURY_ID_A = 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INJURY_ID_B = 'inj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
function record(overrides: Partial<SeasonInjuryRecord>): SeasonInjuryRecord {
    return {
        injuryId: INJURY_ID_A,
        playerVersionId: 'pv-00000000000000000000000000000000',
        franchiseId: franchiseIdSchema.parse('lakers'),
        gameId: seasonGameIdSchema.parse('s000001'),
        type: 'soft-tissue',
        severity: 'moderate',
        occurredBeforeHalftime: false,
        sameGameReturn: false,
        sameGameReturned: null,
        missedGamesTotal: 4,
        missedGamesRemaining: 3,
        actualReturnRound: null,
        seasonEnding: false,
        rehabModifier: 0,
        recurrenceWindowRoundsRemaining: 0,
        seedPath: ['test', 'health'],
        ...overrides,
    };
}
function health(records: SeasonInjuryRecord[]): SeasonHealthState {
    return { schemaVersion: 1, healthVersion: 'season-health-v2', injuries: records };
}
function roster(ids: string[]): SeasonRoster {
    return {
        franchiseId: franchiseIdSchema.parse('lakers'),
        players: ids.map((playerVersionId, index) => ({
            playerVersionId,
            playerId: playerIdSchema.parse(`p-${String(index)}`),
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1990s'),
            seasonKey: seasonKeySchema.parse('1995-96'),
            displayName: `Player ${String(index + 1)}`,
        })),
    };
}
describe('injuryStatusOf / activeInjuriesOf', () => {
    const player = 'pv-00000000000000000000000000000000';
    it('derives active from an unresolved injury', () => {
        const state = health([record({ missedGamesRemaining: 3 })]);
        expect(activeInjuriesOf(state, player)).toHaveLength(1);
        expect(injuryStatusOf(state, player)).toBe('active');
    });
    it('treats a same-game-returned injury as not active', () => {
        const state = health([
            record({ sameGameReturn: true, sameGameReturned: true, missedGamesRemaining: 0 }),
        ]);
        expect(activeInjuriesOf(state, player)).toHaveLength(0);
        expect(injuryStatusOf(state, player)).toBe('returned');
    });
    it('reports returned after a resolved recovery and none without records', () => {
        const state = health([record({ missedGamesRemaining: 0, actualReturnRound: 14 })]);
        expect(injuryStatusOf(state, player)).toBe('returned');
        expect(injuryStatusOf(state, 'pv-11111111111111111111111111111111')).toBe('none');
    });
});
describe('recoveryEstimate', () => {
    const future = [
        { gameId: seasonGameIdSchema.parse('s000101'), round: 11 },
        { gameId: seasonGameIdSchema.parse('s000102'), round: 12 },
        { gameId: seasonGameIdSchema.parse('s000103'), round: 13 },
    ];
    it('maps the remaining countdown to the round of the remaining-th team game', () => {
        const estimate = recoveryEstimate(record({ missedGamesRemaining: 2 }), future);
        expect(estimate.remainingGames).toBe(2);
        expect(estimate.returnRoundMin).toBe(12);
        expect(estimate.returnRoundMax).toBe(12);
        expect(estimate.seasonEnding).toBe(false);
    });
    it('flags season-ending injuries from the sentinel', () => {
        const estimate = recoveryEstimate(record({ missedGamesRemaining: 10000, seasonEnding: true }), future);
        expect(estimate.seasonEnding).toBe(true);
        expect(estimate.returnRoundMin).toBeNull();
    });
    it('returns null rounds when no future games remain', () => {
        const estimate = recoveryEstimate(record({ missedGamesRemaining: 4 }), []);
        expect(estimate.returnRoundMin).toBeNull();
        expect(estimate.returnRoundMax).toBeNull();
    });
    it('is exact when the countdown fits the schedule and null beyond it', () => {
        expect(recoveryEstimate(record({ missedGamesRemaining: 3 }), future).returnRoundMin).toBe(13);
        expect(recoveryEstimate(record({ missedGamesRemaining: 4 }), future).returnRoundMin).toBeNull();
    });
});
describe('recurrenceOf', () => {
    it('is true only inside the post-return window', () => {
        expect(recurrenceOf(record({ recurrenceWindowRoundsRemaining: 6 }))).toBe(true);
        expect(recurrenceOf(record({ recurrenceWindowRoundsRemaining: 0 }))).toBe(false);
    });
});
describe('availabilityStripRows', () => {
    const ids = [
        'pv-00000000000000000000000000000000',
        'pv-11111111111111111111111111111111',
        'pv-22222222222222222222222222222222',
        'pv-33333333333333333333333333333333',
        'pv-44444444444444444444444444444444',
        'pv-55555555555555555555555555555555',
    ];
    const teamGames = [
        { gameId: seasonGameIdSchema.parse('s000001'), round: 1 },
        { gameId: seasonGameIdSchema.parse('s000002'), round: 2 },
        { gameId: seasonGameIdSchema.parse('s000101'), round: 11 },
        { gameId: seasonGameIdSchema.parse('s000102'), round: 12 },
    ];
    it('renders out / returned / available rows with consequences', () => {
        const state = health([
            record({
                injuryId: INJURY_ID_A,
                playerVersionId: ids[0],
                missedGamesTotal: 4,
                missedGamesRemaining: 2,
                gameId: seasonGameIdSchema.parse('s000001'),
            }),
            record({
                injuryId: INJURY_ID_B,
                playerVersionId: ids[1],
                severity: 'minor',
                missedGamesTotal: 2,
                missedGamesRemaining: 0,
                actualReturnRound: 10,
                recurrenceWindowRoundsRemaining: 6,
            }),
        ]);
        const rows = availabilityStripRows(state, roster(ids), teamGames);
        expect(rows).toHaveLength(6);
        const first = rows[0];
        expect(first?.status).toBe('active');
        expect(first?.returnRange).toEqual({ min: 11, max: 11 });
        expect(first?.nextGameConsequence).toContain('Out for the next 2 games');
        expect(first?.nextGameConsequence).toContain('back around R11');
        const second = rows[1];
        expect(second?.status).toBe('returned');
        expect(second?.recurrence).toBe(true);
        expect(second?.nextGameConsequence).toContain('recurrence risk 6 games');
        const third = rows[2];
        expect(third?.status).toBe('none');
        expect(third?.nextGameConsequence).toBeNull();
    });
    it('labels a season-ending injury as out for the season', () => {
        const state = health([
            record({
                injuryId: INJURY_ID_A,
                playerVersionId: ids[0],
                missedGamesRemaining: 10000,
                seasonEnding: true,
            }),
        ]);
        const rows = availabilityStripRows(state, roster(ids));
        expect(rows[0]?.status).toBe('active');
        expect(rows[0]?.nextGameConsequence).toBe('Out for the rest of the season');
    });
});
describe('humanInjuryTimeline', () => {
    it('lists per-player records with return facts and enriches from summaries', () => {
        const ids = ['pv-00000000000000000000000000000000'];
        const state = health([
            record({
                injuryId: INJURY_ID_A,
                playerVersionId: ids[0],
                gameId: seasonGameIdSchema.parse('s000001'),
                missedGamesTotal: 4,
                missedGamesRemaining: 0,
                actualReturnRound: 12,
                recurrenceWindowRoundsRemaining: 3,
            }),
        ]);
        const summaries = [
            {
                schemaVersion: 1,
                summaryVersion: 'season-game-summary-v3',
                gameId: seasonGameIdSchema.parse('s000001'),
                round: 1,
                homeFranchiseId: 'lakers',
                awayFranchiseId: 'celtics',
                status: 'final',
                overtimePeriods: 0,
                homeScore: 100,
                awayScore: 90,
                forfeitLoserFranchiseId: null,
                homeBox: {} as never,
                awayBox: {} as never,
                homePlayers: [],
                awayPlayers: [],
                injuryEvents: [
                    {
                        playerVersionId: ids[0],
                        side: 'home',
                        type: 'soft-tissue',
                        severity: 'moderate',
                        removedClock: { period: 2, seconds: 540 },
                        returned: false,
                        returnClock: null,
                    },
                ],
            },
        ] as never;
        const players = humanInjuryTimeline(state, roster(ids), 'lakers', summaries);
        expect(players).toHaveLength(1);
        const entry = players[0]?.entries[0];
        expect(entry?.missedGamesTotal).toBe(4);
        expect(entry?.actualReturnRound).toBe(12);
        expect(entry?.recurrence).toBe(true);
        expect(entry?.removedClock).toEqual({ period: 2, seconds: 540 });
    });
});
