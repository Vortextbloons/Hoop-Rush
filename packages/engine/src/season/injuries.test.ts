import { describe, expect, it } from 'vitest';
import { SEASON_ENDING_MISSED_GAMES_SENTINEL, franchiseIdSchema, seasonInjuryRecordSchema, type SeasonHealthState, type SeasonInjuryRecord, } from '@hoop-rush/data-contracts';
import { applyRiskyRehabOutcome, applySeasonGameHealthTransition, clockFromTipoffSeconds, rollSeasonInjuryForPlayer, rollSeasonRehabOutcome, seasonInjuryRiskBasisPoints, seasonPlayerAvailable, SEASON_INJURY_RISK_MAX_BP, SEASON_INJURY_RISK_MIN_BP, } from './injuries.ts';
function healthWith(injuries: SeasonInjuryRecord[]): SeasonHealthState {
    return {
        schemaVersion: 1,
        healthVersion: 'season-health-v2',
        injuries,
    };
}
function rollAt(rootSeed: string, gameId: string, playerVersionId: string, overrides: Partial<Parameters<typeof rollSeasonInjuryForPlayer>[0]> = {}): ReturnType<typeof rollSeasonInjuryForPlayer> {
    return rollSeasonInjuryForPlayer({
        rootSeed,
        gameId,
        playerVersionId,
        franchiseId: franchiseIdSchema.parse('lakers'),
        durabilityRating: 70,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        targetMinutes: 33,
        recurrenceWindowRoundsRemaining: 0,
        ...overrides,
    });
}
function forcedRoll(rootSeed: string, gameId: string, playerVersionId: string) {
    return rollAt(rootSeed, gameId, playerVersionId, {
        durabilityRating: 45,
        fatigueBasisPoints: 10000,
        recentLoadBasisPoints: 10000,
        targetMinutes: 48,
        recurrenceWindowRoundsRemaining: 10,
    });
}
describe('season injury clocks', () => {
    it('maps the exact end of regulation to the fourth-quarter horn', () => {
        expect(clockFromTipoffSeconds(48 * 60)).toEqual({ period: 4, seconds: 0 });
    });
});
describe('season injury risk formula (M2.5 §5)', () => {
    it('computes the frozen coefficients exactly', () => {
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(80);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 45,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(93);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 95,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(68);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 200,
            recentLoadBasisPoints: 0,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(81);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 250,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(81);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 40,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(92);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 12,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(80);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 70,
            fatigueBasisPoints: 0,
            recentLoadBasisPoints: 0,
            targetMinutes: 20,
            recurrenceWindowRoundsRemaining: 10,
        })).toBe(120);
    });
    it('clamps every input combination into 20..220', () => {
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 45,
            fatigueBasisPoints: 10000,
            recentLoadBasisPoints: 10000,
            targetMinutes: 48,
            recurrenceWindowRoundsRemaining: 10,
        })).toBeGreaterThanOrEqual(SEASON_INJURY_RISK_MIN_BP);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 45,
            fatigueBasisPoints: 10000,
            recentLoadBasisPoints: 10000,
            targetMinutes: 48,
            recurrenceWindowRoundsRemaining: 10,
        })).toBeLessThanOrEqual(SEASON_INJURY_RISK_MAX_BP);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: 200,
            fatigueBasisPoints: -100000,
            recentLoadBasisPoints: -100000,
            targetMinutes: 0,
            recurrenceWindowRoundsRemaining: 0,
        })).toBe(SEASON_INJURY_RISK_MIN_BP);
        expect(seasonInjuryRiskBasisPoints({
            durabilityRating: -1000,
            fatigueBasisPoints: 10000,
            recentLoadBasisPoints: 10000,
            targetMinutes: 48,
            recurrenceWindowRoundsRemaining: 10,
        })).toBe(SEASON_INJURY_RISK_MAX_BP);
    });
    it('depends only on minutes/fatigue/load/durability/prior injury', () => {
        const a = rollAt('seed-a', 's000001', 'pv-1', { targetMinutes: 30 });
        const b = rollAt('seed-a', 's000001', 'pv-1', { targetMinutes: 30 });
        expect(a.riskBasisPoints).toBe(b.riskBasisPoints);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        const highMinutes = rollAt('seed-a', 's000001', 'pv-1', { targetMinutes: 48 });
        expect(highMinutes.riskBasisPoints).not.toBe(a.riskBasisPoints);
    });
});
describe('season injury occurrence lifecycle (M2.5 §5)', () => {
    it('reproduces identical records for identical inputs and independent ones otherwise', () => {
        const first = forcedRoll('root-1', 's000001', 'pv-1');
        const second = forcedRoll('root-1', 's000001', 'pv-1');
        expect(second.occurred).toBe(first.occurred);
        expect(JSON.stringify(second.injury)).toBe(JSON.stringify(first.injury));
        const otherPlayer = forcedRoll('root-1', 's000001', 'pv-2');
        const otherGame = forcedRoll('root-1', 's000002', 'pv-1');
        const otherSeed = forcedRoll('root-2', 's000001', 'pv-1');
        const distinct = [otherPlayer, otherGame, otherSeed].filter((roll) => roll.occurred);
        const ids = distinct
            .map((roll) => roll.injury?.injuryId)
            .filter((id): id is string => id !== undefined);
        expect(new Set(ids).size).toBe(ids.length);
        for (const roll of distinct) {
            if (roll.injury !== null) {
                expect(seasonInjuryRecordSchema.safeParse(roll.injury).success).toBe(true);
                expect(roll.injury.injuryId).toMatch(/^inj-[0-9a-f]{32}$/);
                expect(roll.injury.seedPath).toEqual([
                    'injuries',
                    roll.injury.gameId,
                    roll.injury.playerVersionId,
                    'occurrence',
                ]);
            }
        }
    });
    it('rolls every severity into its frozen recovery range and the sentinel', () => {
        const records: SeasonInjuryRecord[] = [];
        for (let i = 0; i < 12000; i += 1) {
            const roll = forcedRoll('severity-cohort', 's000001', `pv-sev-${String(i)}`);
            if (roll.occurred && roll.injury !== null)
                records.push(roll.injury);
        }
        expect(records.length).toBeGreaterThan(100);
        for (const record of records) {
            if (record.severity === 'season-ending') {
                expect(record.missedGamesRemaining).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
                expect(record.missedGamesTotal).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
                expect(record.seasonEnding).toBe(true);
            }
            else if (record.sameGameReturn) {
                expect(record.missedGamesTotal).toBe(0);
                expect(record.missedGamesRemaining).toBe(0);
                expect(record.seasonEnding).toBe(false);
            }
            else {
                const ranges: Record<string, readonly [
                    number,
                    number
                ]> = {
                    minor: [1, 2],
                    moderate: [3, 6],
                    major: [7, 18],
                };
                const range = ranges[record.severity];
                expect(range).toBeDefined();
                if (range === undefined)
                    continue;
                expect(record.missedGamesTotal).toBeGreaterThanOrEqual(range[0]);
                expect(record.missedGamesTotal).toBeLessThanOrEqual(range[1]);
                expect(record.missedGamesRemaining).toBe(record.missedGamesTotal);
                expect(record.seasonEnding).toBe(false);
            }
            expect(['lower-body', 'soft-tissue', 'upper-body', 'illness']).toContain(record.type);
            expect(record.rehabModifier).toBe(0);
            expect(record.actualReturnRound).toBeNull();
            expect(record.recurrenceWindowRoundsRemaining).toBe(0);
            expect(record.sameGameReturned).toBeNull();
        }
        const minor = records.filter((record) => record.severity === 'minor').length;
        const moderate = records.filter((record) => record.severity === 'moderate').length;
        const major = records.filter((record) => record.severity === 'major').length;
        const seasonEnding = records.filter((record) => record.severity === 'season-ending').length;
        const share = (count: number): number => count / records.length;
        expect(share(minor)).toBeGreaterThan(0.45);
        expect(share(minor)).toBeLessThan(0.75);
        expect(share(moderate)).toBeGreaterThan(0.15);
        expect(share(moderate)).toBeLessThan(0.42);
        expect(share(major)).toBeGreaterThan(0.02);
        expect(share(seasonEnding)).toBeGreaterThan(0);
        expect(share(seasonEnding)).toBeLessThan(0.08);
    });
    it('applies the 35% same-game-return gate to minor before-halftime injuries', () => {
        const eligible: SeasonInjuryRecord[] = [];
        for (let i = 0; i < 20000; i += 1) {
            const roll = forcedRoll('return-cohort', 's000001', `pv-ret-${String(i)}`);
            if (roll.occurred &&
                roll.injury !== null &&
                roll.injury.severity === 'minor' &&
                roll.injury.occurredBeforeHalftime) {
                eligible.push(roll.injury);
            }
        }
        expect(eligible.length).toBeGreaterThan(50);
        const withReturn = eligible.filter((record) => record.sameGameReturn);
        const share = withReturn.length / eligible.length;
        expect(share).toBeGreaterThan(0.2);
        expect(share).toBeLessThan(0.5);
        for (const record of withReturn) {
            expect(record.missedGamesTotal).toBe(0);
        }
        for (let i = 0; i < 6000; i += 1) {
            const roll = forcedRoll('return-cohort-2', 's000001', `pv-ret2-${String(i)}`);
            if (roll.occurred && roll.injury !== null) {
                if (roll.injury.severity !== 'minor' || !roll.injury.occurredBeforeHalftime) {
                    expect(roll.injury.sameGameReturn).toBe(false);
                }
            }
        }
    });
    it('rolls removal clocks inside the player target minutes and returns in periods 3-4', () => {
        let sawRemovalClock = false;
        for (let i = 0; i < 6000; i += 1) {
            const roll = forcedRoll('clock-cohort', 's000001', `pv-clk-${String(i)}`);
            if (!roll.occurred || roll.injury === null)
                continue;
            if (roll.injury.sameGameReturn) {
                expect(roll.returnClock).not.toBeNull();
                expect(roll.returnClock?.period).toBeGreaterThanOrEqual(3);
                expect(roll.returnClock?.period).toBeLessThanOrEqual(4);
            }
            else {
                expect(roll.returnClock).toBeNull();
            }
            expect(roll.removalClock).not.toBeNull();
            sawRemovalClock = true;
        }
        expect(sawRemovalClock).toBe(true);
    });
});
describe('season injury recovery and recurrence (M2.5 §5)', () => {
    it('counts down active injuries per team game and marks the actual return', () => {
        const record: SeasonInjuryRecord = {
            injuryId: 'inj-' + 'a'.repeat(32),
            playerVersionId: 'pv-1',
            franchiseId: franchiseIdSchema.parse('lakers'),
            gameId: 's000001',
            type: 'upper-body',
            severity: 'moderate',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: 3,
            missedGamesRemaining: 3,
            actualReturnRound: null,
            seasonEnding: false,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 's000001', 'pv-1', 'occurrence'],
        };
        let health = healthWith([record]);
        health = applySeasonGameHealthTransition(health, {
            gameId: 's000002',
            round: 2,
            franchises: ['lakers', 'celtics'],
            newInjuries: [],
            sameGameReturned: [],
        });
        expect(health.injuries[0]?.missedGamesRemaining).toBe(2);
        expect(health.injuries[0]?.actualReturnRound).toBeNull();
        health = applySeasonGameHealthTransition(health, {
            gameId: 's000003',
            round: 3,
            franchises: ['lakers', 'celtics'],
            newInjuries: [],
            sameGameReturned: [],
        });
        expect(health.injuries[0]?.missedGamesRemaining).toBe(1);
        expect(health.injuries[0]?.actualReturnRound).toBeNull();
        health = applySeasonGameHealthTransition(health, {
            gameId: 's000004',
            round: 4,
            franchises: ['lakers', 'celtics'],
            newInjuries: [],
            sameGameReturned: [],
        });
        const returned = health.injuries[0];
        expect(returned?.missedGamesRemaining).toBe(0);
        expect(returned?.actualReturnRound).toBe(4);
        expect(returned?.recurrenceWindowRoundsRemaining).toBe(10);
        expect(seasonPlayerAvailable(health, 'pv-1')).toBe(true);
        health = applySeasonGameHealthTransition(health, {
            gameId: 's000005',
            round: 5,
            franchises: ['lakers', 'celtics'],
            newInjuries: [],
            sameGameReturned: [],
        });
        expect(health.injuries[0]?.recurrenceWindowRoundsRemaining).toBe(9);
    });
    it('never decrements a franchise that did not play', () => {
        const record: SeasonInjuryRecord = {
            injuryId: 'inj-' + 'b'.repeat(32),
            playerVersionId: 'pv-2',
            franchiseId: franchiseIdSchema.parse('lakers'),
            gameId: 's000001',
            type: 'lower-body',
            severity: 'minor',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: 2,
            missedGamesRemaining: 2,
            actualReturnRound: null,
            seasonEnding: false,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 's000001', 'pv-2', 'occurrence'],
        };
        const health = applySeasonGameHealthTransition(healthWith([record]), {
            gameId: 's000002',
            round: 2,
            franchises: ['celtics', 'knicks'],
            newInjuries: [],
            sameGameReturned: [],
        });
        expect(health.injuries[0]?.missedGamesRemaining).toBe(2);
    });
    it('preserves the season-ending sentinel across every team-game cadence', () => {
        const record: SeasonInjuryRecord = {
            injuryId: 'inj-' + 's'.repeat(32),
            playerVersionId: 'pv-season-ending',
            franchiseId: franchiseIdSchema.parse('lakers'),
            gameId: 's000001',
            type: 'lower-body',
            severity: 'season-ending',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: SEASON_ENDING_MISSED_GAMES_SENTINEL,
            missedGamesRemaining: SEASON_ENDING_MISSED_GAMES_SENTINEL,
            actualReturnRound: null,
            seasonEnding: true,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 's000001', 'pv-season-ending', 'occurrence'],
        };
        let health = healthWith([record]);
        for (let round = 2; round <= 82; round += 1) {
            health = applySeasonGameHealthTransition(health, {
                gameId: `s${String(round).padStart(6, '0')}`,
                round,
                franchises: ['lakers', 'celtics'],
                newInjuries: [],
                sameGameReturned: [],
            });
        }
        expect(health.injuries[0]?.missedGamesTotal).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(health.injuries[0]?.missedGamesRemaining).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(health.injuries[0]?.actualReturnRound).toBeNull();
        expect(health.injuries[0]?.recurrenceWindowRoundsRemaining).toBe(0);
        expect(seasonPlayerAvailable(health, record.playerVersionId)).toBe(false);
    });
    it('appends new injuries with their game facts and resolves same-game returns', () => {
        let rolled = forcedRoll('root-r', 's000003', 'pv-3');
        for (let attempt = 0; attempt < 200 && !rolled.occurred; attempt += 1) {
            rolled = forcedRoll(`root-r-${String(attempt)}`, 's000003', `pv-3-${String(attempt)}`);
        }
        if (!rolled.occurred || rolled.injury === null)
            throw new Error('expected an occurrence');
        const injury = {
            ...rolled.injury,
            sameGameReturn: true,
            missedGamesTotal: 0,
            missedGamesRemaining: 0,
        };
        const health = applySeasonGameHealthTransition(healthWith([]), {
            gameId: 's000003',
            round: 3,
            franchises: ['lakers', 'celtics'],
            newInjuries: [injury],
            sameGameReturned: [{ injuryId: injury.injuryId, returned: true }],
        });
        const resolved = health.injuries.find((entry) => entry.injuryId === injury.injuryId);
        expect(resolved).toBeDefined();
        expect(resolved?.sameGameReturned).toBe(true);
        expect(resolved?.actualReturnRound).toBe(3);
        expect(resolved?.recurrenceWindowRoundsRemaining).toBe(10);
        expect(seasonPlayerAvailable(health, 'pv-3')).toBe(true);
        const missed = applySeasonGameHealthTransition(healthWith([]), {
            gameId: 's000003',
            round: 3,
            franchises: ['lakers', 'celtics'],
            newInjuries: [injury],
            sameGameReturned: [{ injuryId: injury.injuryId, returned: false }],
        });
        expect(missed.injuries[0]?.sameGameReturned).toBe(false);
    });
    it('records risky-rehab outcomes deterministically (60/40) and applies them', () => {
        let successes = 0;
        const outcomes: string[] = [];
        for (let i = 0; i < 2000; i += 1) {
            const outcome = rollSeasonRehabOutcome('rehab-root', `inj-${String(i).padStart(32, '0')}`);
            outcomes.push(outcome);
            if (outcome === 'success')
                successes += 1;
        }
        const successShare = successes / outcomes.length;
        expect(successShare).toBeGreaterThan(0.5);
        expect(successShare).toBeLessThan(0.7);
        expect(rollSeasonRehabOutcome('rehab-root', 'inj-1'.padEnd(34, '0'))).toBe(rollSeasonRehabOutcome('rehab-root', 'inj-1'.padEnd(34, '0')));
        const record: SeasonInjuryRecord = {
            injuryId: 'inj-' + 'c'.repeat(32),
            playerVersionId: 'pv-4',
            franchiseId: franchiseIdSchema.parse('lakers'),
            gameId: 's000001',
            type: 'illness',
            severity: 'major',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: 10,
            missedGamesRemaining: 10,
            actualReturnRound: null,
            seasonEnding: false,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 's000001', 'pv-4', 'occurrence'],
        };
        const healed = applyRiskyRehabOutcome(healthWith([record]), record.injuryId, 'success');
        expect(healed.injuries[0]?.missedGamesRemaining).toBe(9);
        expect(healed.injuries[0]?.rehabModifier).toBe(-1);
        const oneLeft = applyRiskyRehabOutcome(healthWith([{ ...record, missedGamesRemaining: 1 }]), record.injuryId, 'success');
        expect(oneLeft.injuries[0]?.missedGamesRemaining).toBe(1);
        const worsened = applyRiskyRehabOutcome(healthWith([record]), record.injuryId, 'failure');
        expect(worsened.injuries[0]?.missedGamesRemaining).toBe(11);
        expect(worsened.injuries[0]?.rehabModifier).toBe(1);
    });
    it('keeps the season-ending sentinel fixed when risky rehab is spent', () => {
        const record: SeasonInjuryRecord = {
            injuryId: 'inj-' + 'r'.repeat(32),
            playerVersionId: 'pv-rehab-season-ending',
            franchiseId: franchiseIdSchema.parse('lakers'),
            gameId: 's000001',
            type: 'illness',
            severity: 'season-ending',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: SEASON_ENDING_MISSED_GAMES_SENTINEL,
            missedGamesRemaining: SEASON_ENDING_MISSED_GAMES_SENTINEL,
            actualReturnRound: null,
            seasonEnding: true,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 's000001', 'pv-rehab-season-ending', 'occurrence'],
        };
        const success = applyRiskyRehabOutcome(healthWith([record]), record.injuryId, 'success');
        expect(success.injuries[0]?.missedGamesTotal).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(success.injuries[0]?.missedGamesRemaining).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(success.injuries[0]?.rehabModifier).toBe(-1);
        const failure = applyRiskyRehabOutcome(healthWith([record]), record.injuryId, 'failure');
        expect(failure.injuries[0]?.missedGamesTotal).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(failure.injuries[0]?.missedGamesRemaining).toBe(SEASON_ENDING_MISSED_GAMES_SENTINEL);
        expect(failure.injuries[0]?.rehabModifier).toBe(1);
    });
});
