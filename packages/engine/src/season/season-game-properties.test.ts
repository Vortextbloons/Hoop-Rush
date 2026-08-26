import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SEASON_MINUTE_POLICY_VERSION, SEASON_NEUTRAL_HOME_COURT, SEASON_ROTATION_PRESET_TARGETS, SEASON_ROTATION_VERSION, playerVersionId, type Position, type SeasonGameSimulationInput, type SeasonGameTeamInput, type SeasonRotation, } from '@hoop-rush/data-contracts';
import { buildEraSimulationProfile, buildSimulationPlayer, seedFromString, } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { checkSeasonGameResult } from './season-game-audit.ts';
import { simulateSeasonGame } from './season-game.ts';
const ctx = createEngineContext();
const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG', 'SG'],
    ['SF', 'PF'],
    ['SG', 'SF'],
    ['C'],
    ['PF', 'C'],
];
function buildSeasonTeam(side: 'home' | 'away'): SeasonGameTeamInput {
    const franchiseId = side === 'home' ? 'lakers' : 'celtics';
    const players = POSITION_PLAN.map((positions, index) => {
        const playerId = `p-prop-${side}-${String(index + 1)}`;
        const base = buildSimulationPlayer();
        return {
            playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
            playerId,
            displayName: `${side} player ${String(index + 1)}`,
            positions: [...positions],
            heightInches: 76,
            weightLbs: 200,
            ratings: { ...base.ratings },
            tendencies: { ...base.tendencies },
        };
    });
    return {
        teamId: `${side}-prop-team`,
        displayName: `${side} Prop Team`,
        franchiseId,
        players,
    };
}
function buildSeasonRotation(team: SeasonGameTeamInput): SeasonRotation {
    const ids = team.players.map((p) => p.playerVersionId);
    const starters = ids.slice(0, 5);
    const bench = ids.slice(5);
    const targets = SEASON_ROTATION_PRESET_TARGETS.balanced;
    return {
        franchiseId: team.franchiseId,
        starters,
        benchOrder: bench,
        targetMinutes: [
            ...starters.map((playerVersionId) => ({ playerVersionId, minutes: targets.starters })),
            ...bench.map((playerVersionId, index) => ({
                playerVersionId,
                minutes: targets.bench[index] ?? 0,
            })),
        ],
        closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
            if (id === undefined)
                throw new Error('fixture missing player');
            return id;
        }),
        minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
        rotationVersion: SEASON_ROTATION_VERSION,
    };
}
function buildInput(seed: string): SeasonGameSimulationInput {
    const home = buildSeasonTeam('home');
    const away = buildSeasonTeam('away');
    return {
        schemaVersion: 1,
        seed: seedFromString(seed),
        gameNumber: 1,
        dataVersion: 'data-v1',
        profile: buildEraSimulationProfile(),
        home,
        away,
        homeRotation: buildSeasonRotation(home),
        awayRotation: buildSeasonRotation(away),
        availability: [...home.players, ...away.players].map((p) => ({
            playerVersionId: p.playerVersionId,
            available: true,
        })),
        removals: [],
        returns: [],
        homeCourt: SEASON_NEUTRAL_HOME_COURT,
    };
}
describe('season game properties (fast-check)', () => {
    it('every completed game passes the full audit across arbitrary seeds', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10000 }), (seedValue) => {
            const input = buildInput(`prop-audit-${String(seedValue)}`);
            const result = simulateSeasonGame(input, ctx);
            expect(checkSeasonGameResult(result, input)).toEqual([]);
        }), { numRuns: 30 });
    });
    it('is byte-identical across repeated runs for arbitrary seeds', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10000 }), (seedValue) => {
            const input = buildInput(`prop-det-${String(seedValue)}`);
            const a = simulateSeasonGame(input, ctx);
            const b = simulateSeasonGame(input, ctx);
            expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        }), { numRuns: 30 });
    });
    it('reconciles exact seconds and deviations for arbitrary seeds', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10000 }), (seedValue) => {
            const input = buildInput(`prop-seconds-${String(seedValue)}`);
            const result = simulateSeasonGame(input, ctx);
            if (result.outcome !== 'completed')
                return;
            const expected = 14400 + result.overtimePeriods * 1500;
            for (const side of [result.home, result.away]) {
                expect(side.players.reduce((sum, p) => sum + p.seconds, 0)).toBe(expected);
                for (const player of side.players) {
                    expect(Number.isInteger(player.seconds)).toBe(true);
                    expect(player.minutes).toBe(player.seconds / 60);
                }
            }
            for (const sideKey of ['home', 'away'] as const) {
                const balance = result.deviations
                    .filter((d) => d.side === sideKey)
                    .reduce((sum, d) => sum + d.actualSeconds - d.targetSeconds, 0);
                expect(balance).toBe(0);
                for (const deviation of result.deviations.filter((d) => d.side === sideKey)) {
                    expect(deviation.reasons.length).toBeGreaterThan(0);
                }
            }
        }), { numRuns: 30 });
    });
    it('keeps substitutions and unit stints self-consistent for arbitrary seeds', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10000 }), (seedValue) => {
            const input = buildInput(`prop-subs-${String(seedValue)}`);
            const result = simulateSeasonGame(input, ctx);
            if (result.outcome !== 'completed')
                return;
            for (const sub of result.substitutions) {
                expect(new Set(sub.unit).size).toBe(5);
                expect(sub.unit).toContain(sub.playerIn);
                expect(sub.unit).not.toContain(sub.playerOut);
                expect(sub.playerIn).not.toBe(sub.playerOut);
            }
            for (const sideKey of ['home', 'away'] as const) {
                const stints = result.unitStints.filter((s) => s.side === sideKey);
                for (let i = 1; i < stints.length; i += 1) {
                    const prev = stints[i - 1];
                    const cur = stints[i];
                    if (cur === undefined || prev === undefined)
                        continue;
                    if (cur.period === prev.period) {
                        expect(cur.startSecondsRemaining).toBe(prev.endSecondsRemaining);
                    }
                    else {
                        expect(prev.endSecondsRemaining).toBe(0);
                        expect(cur.startSecondsRemaining).toBe(cur.period <= 4 ? 720 : 300);
                    }
                    expect(cur.durationSeconds).toBe(cur.startSecondsRemaining - cur.endSecondsRemaining);
                }
            }
        }), { numRuns: 30 });
    });
    it('every rostered player with a positive target plays in regulation', () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10000 }), (seedValue) => {
            const input = buildInput(`prop-play-${String(seedValue)}`);
            const result = simulateSeasonGame(input, ctx);
            if (result.outcome !== 'completed')
                return;
            for (const sideKey of ['home', 'away'] as const) {
                const side = result[sideKey];
                for (const player of side.players) {
                    expect(player.seconds).toBeGreaterThan(0);
                }
            }
        }), { numRuns: 30 });
    });
});
