import { describe, expect, it } from 'vitest';
import type { ReconstructedThreePointProfile, SimulationAnchors, SimulationPlayer, SimulationTeam, } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, buildEraSimulationProfile, buildGameSimulationInput, buildLegalSimulationTeam, buildSimulationPlayer, seedFromString, } from '@hoop-rush/test-fixtures';
import { createEngineContext } from './context.ts';
import { simulateGame } from './game.ts';
import { ENGINE_VERSION } from './constants.ts';
import { makeProbability } from './shooting.ts';
import { threePointTarget } from './usage.ts';
const context = createEngineContext();
const nullThreeAnchors: SimulationAnchors = {
    gamesPlayed: 79,
    minutesPerGame: 36.2,
    pointsPerGame: 22,
    reboundsPerGame: 6,
    offensiveReboundsPerGame: 1.5,
    defensiveReboundsPerGame: 4.5,
    assistsPerGame: 5,
    stealsPerGame: 1,
    blocksPerGame: 0.5,
    turnoversPerGame: 2.8,
    fieldGoalPct: 0.48,
    threePointPct: null,
    freeThrowPct: 0.78,
    threePointAttemptRate: null,
    freeThrowAttemptRate: 0.25,
};
function reconstructedProfile(overrides: Partial<ReconstructedThreePointProfile> = {}): ReconstructedThreePointProfile {
    return {
        modelVersion: 'three-point-reconstruction-v1',
        accuracyConservative: 0.28,
        accuracyMean: 0.33,
        accuracyStdDev: 0.05,
        attemptRateConservative: 0.15,
        attemptRateMean: 0.2,
        attemptRateStdDev: 0.05,
        confidence: 'medium',
        floor: 0.1,
        zoneFloors: { cornerThree: 0.14, aboveBreakThree: 0.12 },
        evidence: { missingFeatures: 2, sourceFields: ['minutesPerGame', 'fieldGoalPct'] },
        ...overrides,
    };
}
function reconstructedShooter(overrides: Partial<SimulationPlayer> = {}): SimulationPlayer {
    return buildSimulationPlayer({
        anchors: { ...nullThreeAnchors },
        reconstructedThreePoint: reconstructedProfile(),
        ...overrides,
    });
}
function shotPrep(): {
    spacing: number;
    twoPointAnchor: null;
} {
    return { spacing: 0.5, twoPointAnchor: null };
}
function averageDefender(): SimulationPlayer {
    return buildSimulationPlayer({
        ratings: { ...buildSimulationPlayer().ratings, perimeterDefense: 62, defensiveIq: 62 },
    });
}
function reconstructedTeam(): SimulationTeam {
    const base = buildLegalSimulationTeam();
    return {
        ...base,
        players: base.players.map((player) => buildSimulationPlayer({
            ...player,
            anchors: { ...nullThreeAnchors },
            reconstructedThreePoint: reconstructedProfile(),
        })),
    };
}
describe('threePointTarget resolution order (spec/12)', () => {
    const profile = buildEraSimulationProfile();
    it('uses the conservative attempt rate when the observed rate is null', () => {
        const shooter = reconstructedShooter({ anchors: { ...nullThreeAnchors } });
        expect(threePointTarget(shooter, profile)).toBe(reconstructedProfile().attemptRateConservative);
        const capped = reconstructedShooter({
            reconstructedThreePoint: reconstructedProfile({ attemptRateConservative: 0.9 }),
        });
        expect(threePointTarget(capped, profile)).toBe(0.65);
        const floored = reconstructedShooter({
            reconstructedThreePoint: reconstructedProfile({ attemptRateConservative: 0 }),
        });
        expect(threePointTarget(floored, profile)).toBe(0.01);
    });
});
describe('makeProbability reconstructed three-point path (spec/12)', () => {
    const profile = buildEraSimulationProfile();
    it('stays sensitive to the defender contest', () => {
        const shooter = reconstructedShooter();
        const weak = buildSimulationPlayer({
            ratings: { ...buildSimulationPlayer().ratings, perimeterDefense: 50, defensiveIq: 50 },
        });
        const elite = buildSimulationPlayer({
            ratings: { ...buildSimulationPlayer().ratings, perimeterDefense: 95, defensiveIq: 95 },
        });
        const weakResult = makeProbability(shooter, weak, profile, 'aboveBreakThree', 'spotUp', 300, shotPrep());
        const eliteResult = makeProbability(shooter, elite, profile, 'aboveBreakThree', 'spotUp', 300, shotPrep());
        expect(weakResult).toBeGreaterThan(eliteResult);
    });
    it('applies no generic historical era penalty to reconstructed shots', () => {
        const shooter = reconstructedShooter();
        const lowEra = buildEraSimulationProfile({
            parameters: { ...DEFAULT_ERA_SIM_PROFILE.parameters, leagueTsPct: 0.48 },
        });
        const highEra = buildEraSimulationProfile({
            parameters: { ...DEFAULT_ERA_SIM_PROFILE.parameters, leagueTsPct: 0.62 },
        });
        const result = (era: ReturnType<typeof buildEraSimulationProfile>) => makeProbability(shooter, averageDefender(), era, 'aboveBreakThree', 'spotUp', 300, shotPrep());
        expect(result(lowEra)).toBe(result(highEra));
    });
});
describe('reconstructed team end-to-end (spec/12)', () => {
    it('simulates seeded games deterministically with honest three-point accounting', () => {
        const zeroThreeEra = buildEraSimulationProfile({
            parameters: {
                ...DEFAULT_ERA_SIM_PROFILE.parameters,
                league3PARate: 0,
                zoneMix: {
                    ...DEFAULT_ERA_SIM_PROFILE.parameters.zoneMix,
                    cornerThree: 0,
                    aboveBreakThree: 0,
                },
            },
        });
        const team = reconstructedTeam();
        const games = 60;
        let threePointAttempts = 0;
        let threePointersMade = 0;
        for (let index = 0; index < games; index += 1) {
            const result = simulateGame(buildGameSimulationInput({
                seed: seedSchema.parse(seedFromString(`reconstructed-${String(index)}`)),
                home: team,
                away: team,
                profile: zeroThreeEra,
            }), context);
            expect(result.engineVersion).toBe(ENGINE_VERSION);
            for (const side of [result.home, result.away]) {
                expect(Number.isFinite(side.box.threes.made)).toBe(true);
                expect(Number.isFinite(side.box.threes.attempted)).toBe(true);
                expect(side.box.threes.made).toBeLessThanOrEqual(side.box.threes.attempted);
                expect(side.box.threes.made).toBeGreaterThanOrEqual(0);
                threePointAttempts += side.box.threes.attempted;
                threePointersMade += side.box.threes.made;
                for (const player of side.players) {
                    expect(Number.isFinite(player.threes.made)).toBe(true);
                    expect(Number.isFinite(player.threes.attempted)).toBe(true);
                    expect(Number.isFinite(player.fieldGoals.made)).toBe(true);
                    expect(Number.isFinite(player.freeThrows.made)).toBe(true);
                    expect(player.threes.made).toBeGreaterThanOrEqual(0);
                    expect(player.threes.made).toBeLessThanOrEqual(player.threes.attempted);
                    expect(player.threes.attempted).toBeLessThanOrEqual(player.fieldGoals.attempted);
                }
            }
        }
        expect(threePointAttempts).toBeGreaterThan(100);
        expect(threePointersMade).toBeLessThanOrEqual(threePointAttempts);
    });
    it('keeps deterministic results for a reconstructed team', () => {
        const team = reconstructedTeam();
        const input = buildGameSimulationInput({
            seed: seedSchema.parse(seedFromString('reconstructed-determinism')),
            home: team,
            away: team,
        });
        expect(simulateGame(input, context)).toEqual(simulateGame(input, context));
    });
});
