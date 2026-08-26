import { describe, expect, it } from 'vitest';
import { RATINGS_VERSION } from '@hoop-rush/data-contracts';
import type { BaseFiveProjectionInput, ProjectionModelArtifact, SimulationPlayer, } from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { ProjectionCache, projectBaseFive, projectSeasonRoster } from '../projection/index.ts';
import { auditSeasonRotation } from '../season/rotation.ts';
import { buildInput } from './season.test-helpers.ts';
import { optimizeSeasonRotation, projectedQualityWeights } from './minute-plan-quality.ts';
function smallModel(): ProjectionModelArtifact {
    return {
        schemaVersion: 1,
        modelVersion: 'projection-model-v1',
        dataVersion: `m10-${RATINGS_VERSION}`,
        ratingsVersion: RATINGS_VERSION,
        eraProfileVersions: { '1990s': DEFAULT_ERA_SIM_PROFILE.profileVersion },
        references: {
            '1990s': {
                neutral: {
                    referenceId: 'ref-1990s-neutral',
                    archetype: 'neutral',
                    eraId: '1990s',
                    referenceHash: 'f'.repeat(64),
                    players: [1, 2, 3, 4, 5].map((n) => ({
                        playerId: `p-r-${String(n)}`,
                        displayName: `R ${String(n)}`,
                        positions: [n === 5 ? 'C' : n >= 3 ? 'SF' : 'PG'] as string[],
                        heightInches: 78,
                        weightLbs: 210,
                        ratings: {
                            insideScoring: 68,
                            closeShot: 66,
                            midrange: 64,
                            threePoint: 60,
                            freeThrow: 72,
                            ballHandling: 68,
                            passing: 68,
                            offensiveIq: 68,
                            offensiveRebound: 58,
                            defensiveRebound: 62,
                            perimeterDefense: 60,
                            interiorDefense: 60,
                            steal: 58,
                            block: 58,
                            defensiveIq: 60,
                            speed: 68,
                            strength: 64,
                            vertical: 64,
                        },
                        tendencies: {
                            usageRate: 20,
                            passRate: 30,
                            shotRate: 25,
                            driveRate: 18,
                            postUpRate: 5,
                            rimFrequency: 30,
                            shortMidFrequency: 20,
                            longMidFrequency: 14,
                            cornerThreeFrequency: 8,
                            aboveBreakThreeFrequency: 12,
                            threePointRate: 20,
                            freeThrowRate: 22,
                            turnoverRate: 12,
                            isolationRate: 10,
                            pickAndRollBallHandlerRate: 25,
                            pickAndRollRollManRate: 10,
                            spotUpRate: 20,
                            transitionRate: 15,
                            cutRate: 10,
                            foulRate: 2,
                            stealAttemptRate: 8,
                            blockAttemptRate: 10,
                            crashOffensiveGlassRate: 12,
                        },
                    })) as unknown as ProjectionModelArtifact['references']['1990s']['neutral']['players'],
                },
                archetypes: [],
            },
        },
        scales: {
            creation: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
            spacing: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
            defense: { baseline: 55, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
        },
        componentWeights: { creation: 1, spacing: 1, defense: 1 },
        weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
        weaknesses: [],
        search: {
            seedNamespace: 'season-projection-search',
            partialBeamsPerLens: 8,
            completeCandidates: 4,
            startingFives: 4,
            closingFives: 2,
            benchHierarchies: 2,
            minuteTemplates: 1,
            singleRemovals: 'all',
            pairRemovals: 2,
            nodeBudgets: { partial: 10000, complete: 10000, rotation: 40 },
            closeScenarioWeight: 0.2,
        },
        cohorts: {
            calibrationGames: 2048,
            validationGames: 1024,
            heldOutGames: 2048,
            calibrationSeedFrom: '00000000000000000000000000000000',
            calibrationSeedTo: '000000000000000000000000000007ff',
            validationSeedFrom: '00000000000000000000000000000800',
            validationSeedTo: '00000000000000000000000000000bff',
            heldOutSeedFrom: '00000000000000000000000000000c00',
            heldOutSeedTo: '000000000000000000000000000013ff',
        },
        monotonicGates: [
            {
                code: 'shooting-monotonic',
                driver: 'threePoint',
                output: 'effectiveFieldGoalPct',
                description: 'better shooting must not lower projected eFG%',
            },
        ],
    };
}
function rosterOf(players: readonly SimulationPlayer[]) {
    return players.map((player) => ({ player }));
}
function byVersionOf(players: readonly SimulationPlayer[]) {
    return new Map<string, SimulationPlayer>(players.map((player) => [player.playerVersionId ?? player.playerId, player]));
}
function loadOf(players: readonly SimulationPlayer[], options: {
    staminaRating?: number;
    durability?: number;
    fatigueBasisPoints?: number;
    recentLoadBasisPoints?: number;
} = {}) {
    const { staminaRating = 80, durability = 80, fatigueBasisPoints = 0, recentLoadBasisPoints = 0, } = options;
    return new Map(players.map((player) => [
        player.playerVersionId ?? player.playerId,
        { staminaRating, durability, fatigueBasisPoints, recentLoadBasisPoints },
    ]));
}
function lineupOf(players: readonly string[], byVersion: ReadonlyMap<string, SimulationPlayer>) {
    const slotOf = (index: number): BaseFiveProjectionInput['lineup'][number]['slot'] => index === 4 ? 'C' : index >= 2 ? (index === 2 ? 'F1' : 'F2') : index === 0 ? 'G1' : 'G2';
    return players.map((id, index) => {
        const player = byVersion.get(id);
        if (player === undefined)
            throw new Error(`missing player ${id}`);
        return { player, slot: slotOf(index) };
    }) as unknown as BaseFiveProjectionInput['lineup'];
}
describe('projectedQualityWeights', () => {
    it('returns a clamped quality weight per rostered player from the first unit containing them', () => {
        const { players, rotation } = buildInput();
        const byVersion = byVersionOf(players);
        const cache = new ProjectionCache();
        const quality = projectedQualityWeights({
            players,
            byVersion,
            rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            cache,
        });
        expect(quality.size).toBe(10);
        for (const value of quality.values()) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
        for (const id of [...rotation.starters, ...rotation.closingFive]) {
            expect(quality.has(id)).toBe(true);
        }
    });
    it('derives starter quality from the starters unit contribution rows', () => {
        const { players, rotation } = buildInput();
        const byVersion = byVersionOf(players);
        const model = smallModel();
        const quality = projectedQualityWeights({
            players,
            byVersion,
            rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model,
            cache: new ProjectionCache(),
        });
        const starterId = rotation.starters[0];
        if (starterId === undefined)
            throw new Error('fixture starters missing');
        const base = projectBaseFive({
            lineup: lineupOf(rotation.starters, byVersion),
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model,
        });
        const offense = base.offense.players.find((row) => row.playerVersionId === starterId);
        expect(offense).toBeDefined();
        const defense = base.defense.players.find((row) => row.playerVersionId === starterId);
        const defensiveContribution = defense?.defensiveContribution ?? offense?.defensiveContribution ?? 0;
        expect(quality.get(starterId)).toBe(Math.max(0, Math.min(1, ((offense?.expectedPoints ?? 0) + defensiveContribution) / 200)));
    });
    it('shares the projection cache and is deterministic', () => {
        const { players, rotation } = buildInput();
        const byVersion = byVersionOf(players);
        const cache = new ProjectionCache();
        const input = {
            players,
            byVersion,
            rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
        };
        const first = projectedQualityWeights({ ...input, cache });
        const hitsAfterFirst = cache.stats().hits;
        const second = projectedQualityWeights({ ...input, cache });
        expect(cache.stats().hits).toBeGreaterThan(hitsAfterFirst);
        expect(second).toEqual(first);
    });
});
describe('optimizeSeasonRotation', () => {
    it('returns three legal plans preserving structure and franchiseId', () => {
        const { players, rotation } = buildInput();
        const roster = rosterOf(players);
        const load = loadOf(players);
        const memberPlayable = new Map(players.map((player) => [player.playerVersionId ?? player.playerId, player.positions]));
        const result = optimizeSeasonRotation({
            roster,
            structure: rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load,
            horizon: 10,
        });
        expect(result.plans.map((plan) => plan.strategy)).toEqual([
            'starter-heavy',
            'balanced',
            'bench-heavy',
        ]);
        for (const plan of result.plans) {
            expect(plan.rotation.franchiseId).toBe(rotation.franchiseId);
            expect(plan.rotation.starters).toEqual(rotation.starters);
            expect(plan.rotation.benchOrder).toEqual(rotation.benchOrder);
            expect(plan.rotation.closingFive).toEqual(rotation.closingFive);
            expect(plan.rotation.minutePolicy.strategy).toBe(plan.strategy);
            expect(plan.rotation.minutePolicy.policyVersion).toBe('minute-policy-v1');
            expect(plan.rotation.rotationVersion).toBe('season-rotation-v3');
            expect(auditSeasonRotation(plan.rotation, memberPlayable)).toEqual([]);
            expect(plan.rotation.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
            expect(plan.riskScore).toBeGreaterThanOrEqual(0);
            expect(plan.riskScore).toBeLessThanOrEqual(1);
            const reference = projectSeasonRoster({
                roster,
                rotation: plan.rotation,
                eraProfile: DEFAULT_ERA_SIM_PROFILE,
                model: smallModel(),
            });
            expect(plan.projectedNetRating).toBe(reference.metrics.netRating);
            expect(plan.unitQuality).toEqual({
                starting: reference.metrics.startingQuality,
                closing: reference.metrics.closingQuality,
                bench: reference.metrics.benchQuality,
            });
        }
    });
    it('recommends starter-heavy for a healthy high-stamina star team', () => {
        const { players, rotation } = buildInput();
        const starterIds = new Set(rotation.starters);
        const starTeam = players.map((player) => {
            const star = starterIds.has(player.playerVersionId ?? player.playerId);
            const ratings = Object.fromEntries(Object.entries(player.ratings).map(([key]) => [key, star ? 90 : 55])) as SimulationPlayer['ratings'];
            return { ...player, ratings };
        });
        const roster = rosterOf(starTeam);
        const load = new Map(starTeam.map((player) => [
            player.playerVersionId ?? player.playerId,
            starterIds.has(player.playerVersionId ?? player.playerId)
                ? { staminaRating: 95, durability: 95, fatigueBasisPoints: 0, recentLoadBasisPoints: 0 }
                : { staminaRating: 70, durability: 70, fatigueBasisPoints: 0, recentLoadBasisPoints: 0 },
        ]));
        const result = optimizeSeasonRotation({
            roster,
            structure: rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load,
            horizon: 10,
        });
        expect(result.recommended).toBe('starter-heavy');
    });
    it('respects the heavy-strain gate when choosing the recommendation', () => {
        const { players, rotation } = buildInput();
        const roster = rosterOf(players);
        const load = new Map(players.map((player, index) => [
            player.playerVersionId ?? player.playerId,
            index < 5
                ? {
                    staminaRating: 55,
                    durability: 80,
                    fatigueBasisPoints: 5400,
                    recentLoadBasisPoints: 4000,
                }
                : { staminaRating: 80, durability: 80, fatigueBasisPoints: 0, recentLoadBasisPoints: 0 },
        ]));
        const result = optimizeSeasonRotation({
            roster,
            structure: rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load,
            horizon: 10,
        });
        const heavyPlan = result.plans.find((plan) => plan.strategy === 'starter-heavy');
        expect(heavyPlan?.heavyStrain).toBe(true);
        expect(['balanced', 'bench-heavy']).toContain(result.recommended);
    });
    it('is deterministic: identical inputs produce identical plans', () => {
        const { players, rotation } = buildInput();
        const roster = rosterOf(players);
        const load = loadOf(players);
        const input = {
            roster,
            structure: rotation,
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load,
            horizon: 10,
        };
        const first = optimizeSeasonRotation(input);
        const second = optimizeSeasonRotation(input);
        expect(second.plans).toEqual(first.plans);
        expect(second.recommended).toBe(first.recommended);
    });
    it('throws on an invalid structure', () => {
        const { players, rotation } = buildInput();
        const roster = rosterOf(players);
        expect(() => optimizeSeasonRotation({
            roster,
            structure: { ...rotation, starters: rotation.starters.slice(0, 4) },
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load: loadOf(players),
            horizon: 10,
        })).toThrow(/invalid rotation/);
    });
    it('rejects structures that reference unrostered players', () => {
        const { players, rotation } = buildInput();
        const roster = rosterOf(players);
        const unknown = players[0]?.playerVersionId ?? 'missing';
        expect(() => optimizeSeasonRotation({
            roster,
            structure: {
                ...rotation,
                starters: rotation.starters.map((id) => (id === unknown ? 'not-rostered' : id)),
            },
            eraProfile: DEFAULT_ERA_SIM_PROFILE,
            model: smallModel(),
            load: loadOf(players),
            horizon: 10,
        })).toThrow(/invalid rotation/);
    });
});
