import { describe, expect, it } from 'vitest';
import { auditSeasonRotation, buildMinimalRotation } from './rotation.ts';
import { buildMinutePlanCandidates, fatigueBandOf, minutePlanHorizonGames, projectFatigueAfterBlock, type MinutePlanCandidate, type MinutePlanPlayerInput, type MinutePlanStructure, } from './minute-plan.ts';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
function structureOf(): MinutePlanStructure {
    return {
        starters: [...IDS.slice(0, 5)],
        benchOrder: [...IDS.slice(5)],
        closingFive: [IDS[0], IDS[5], IDS[1], IDS[6], IDS[2]],
    };
}
function player(id: string, overrides: Partial<MinutePlanPlayerInput> = {}): MinutePlanPlayerInput {
    return {
        playerVersionId: id,
        quality: 0.5,
        staminaRating: 80,
        durability: 80,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        ...overrides,
    };
}
function playersOf(options: {
    quality?: number;
    stamina?: number;
    fatigue?: number;
} = {}): Map<string, MinutePlanPlayerInput> {
    const { quality = 0.5, stamina = 80, fatigue = 0 } = options;
    return new Map(IDS.map((id) => [
        id,
        player(id, {
            quality,
            staminaRating: stamina,
            fatigueBasisPoints: fatigue,
        }),
    ]));
}
function memberPlayable() {
    return new Map(IDS.map((id) => [id, ['PG', 'SG', 'SF', 'PF', 'C'] as const]));
}
describe('minute-plan legality and structure', () => {
    it('produces legal, integer, 240-total rotations for every strategy', () => {
        const structure = structureOf();
        const candidates = buildMinutePlanCandidates({
            structure,
            players: playersOf(),
            horizon: 10,
        });
        expect(candidates.plans).toHaveLength(3);
        for (const plan of candidates.plans) {
            const errors = auditSeasonRotation(plan.rotation, memberPlayable());
            expect(errors).toEqual([]);
            const total = plan.rotation.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
            expect(total).toBe(240);
            for (const row of plan.rotation.targetMinutes) {
                expect(Number.isInteger(row.minutes)).toBe(true);
                expect(row.minutes).toBeGreaterThanOrEqual(0);
                expect(row.minutes).toBeLessThanOrEqual(48);
            }
            expect(plan.rotation.starters).toEqual(structure.starters);
            expect(plan.rotation.benchOrder).toEqual(structure.benchOrder);
            expect(plan.rotation.closingFive).toEqual(structure.closingFive);
            expect(plan.rotation.minutePolicy.strategy).toBe(plan.strategy);
            expect(plan.rotation.minutePolicy.policyVersion).toBe('minute-policy-v1');
        }
    });
    it('is deterministic: identical inputs produce identical plans', () => {
        const input = {
            structure: structureOf(),
            players: playersOf(),
            horizon: 10,
        };
        const first = buildMinutePlanCandidates(input);
        const second = buildMinutePlanCandidates(input);
        expect(second.plans.map((plan) => plan.rotation.targetMinutes)).toEqual(first.plans.map((plan) => plan.rotation.targetMinutes));
        expect(second.recommended).toBe(first.recommended);
    });
    it('plans are not flat when quality, stamina, or fatigue differ', () => {
        const structure = structureOf();
        const players = playersOf();
        players.set('a', player('a', { quality: 1, staminaRating: 95 }));
        players.set('b', player('b', { quality: 0.1, staminaRating: 50, fatigueBasisPoints: 8000 }));
        const candidates = buildMinutePlanCandidates({
            structure,
            players,
            horizon: 10,
        });
        for (const plan of candidates.plans) {
            const minutesOf = new Map(plan.rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes]));
            const a = minutesOf.get('a') ?? 0;
            const b = minutesOf.get('b') ?? 0;
            expect(a).toBeGreaterThan(b);
            expect(a).toBeGreaterThan(32);
            expect(plan.rotation.targetMinutes.every((row) => row.minutes > 0)).toBe(true);
        }
    });
});
function planAt(plans: MinutePlanCandidate[], index: number): MinutePlanCandidate {
    const plan = plans[index];
    if (plan === undefined)
        throw new Error(`minute plan ${String(index)} missing`);
    return plan;
}
describe('minute-plan envelopes', () => {
    it('starter share is ordered starter-heavy > balanced > bench-heavy', () => {
        const candidates = buildMinutePlanCandidates({
            structure: structureOf(),
            players: playersOf(),
            horizon: 10,
        });
        const starterShare = (plan: {
            rotation: SeasonRotation;
        }) => plan.rotation.targetMinutes
            .filter((row) => plan.rotation.starters.includes(row.playerVersionId))
            .reduce((sum, row) => sum + row.minutes, 0);
        const heavy = starterShare(planAt(candidates.plans, 0));
        const balanced = starterShare(planAt(candidates.plans, 1));
        const bench = starterShare(planAt(candidates.plans, 2));
        expect(heavy).toBeGreaterThan(balanced);
        expect(balanced).toBeGreaterThan(bench);
        expect(heavy).toBe(185);
        expect(balanced).toBe(165);
        expect(bench).toBe(145);
    });
    it('starter-heavy carries the best raw quality for high-stamina star teams', () => {
        const players = playersOf();
        for (const id of IDS.slice(0, 5)) {
            players.set(id, player(id, { quality: 0.9, staminaRating: 95 }));
        }
        for (const id of IDS.slice(5)) {
            players.set(id, player(id, { quality: 0.35, staminaRating: 70 }));
        }
        const candidates = buildMinutePlanCandidates({
            structure: structureOf(),
            players,
            horizon: 10,
        });
        const quality = new Map(candidates.plans.map((plan) => [plan.strategy, plan.quality]));
        expect(quality.get('starter-heavy') ?? 0).toBeGreaterThan(quality.get('balanced') ?? 0);
        expect(quality.get('balanced') ?? 0).toBeGreaterThan(quality.get('bench-heavy') ?? 0);
        expect(candidates.recommended).toBe('starter-heavy');
    });
    it('tired or low-stamina star teams shift toward balanced or bench-heavy', () => {
        const tired = playersOf();
        for (const id of IDS.slice(0, 5)) {
            tired.set(id, player(id, { quality: 0.55, staminaRating: 60, fatigueBasisPoints: 4500 }));
        }
        for (const id of IDS.slice(5)) {
            tired.set(id, player(id, { quality: 0.45, staminaRating: 80 }));
        }
        const candidates = buildMinutePlanCandidates({
            structure: structureOf(),
            players: tired,
            horizon: 10,
        });
        const heavyPlan = candidates.plans.find((plan) => plan.strategy === 'starter-heavy');
        expect(heavyPlan?.heavyStrain).toBe(true);
        expect(candidates.plans
            .filter((plan) => plan.strategy !== 'starter-heavy')
            .every((plan) => !plan.heavyStrain)).toBe(true);
        expect(['balanced', 'bench-heavy']).toContain(candidates.recommended);
    });
    it('bench-heavy has lower projected quality but lower starter strain', () => {
        const structure = structureOf();
        const players = playersOf();
        for (const id of IDS.slice(0, 5)) {
            players.set(id, player(id, { quality: 0.6, staminaRating: 80 }));
        }
        for (const id of IDS.slice(5)) {
            players.set(id, player(id, { quality: 0.4, staminaRating: 70 }));
        }
        const candidates = buildMinutePlanCandidates({ structure, players, horizon: 10 });
        const heavy = planAt(candidates.plans, 0);
        const bench = planAt(candidates.plans, 2);
        expect(bench.quality).toBeLessThan(heavy.quality);
        expect(bench.maxStarterStrainBasisPoints).toBeLessThan(heavy.maxStarterStrainBasisPoints);
        expect(bench.relief).toBeGreaterThan(heavy.relief);
    });
    it('falls back to the best score when every plan is heavy-strain', () => {
        const players = playersOf();
        for (const id of IDS) {
            players.set(id, player(id, { staminaRating: 55, fatigueBasisPoints: 9000 }));
        }
        const candidates = buildMinutePlanCandidates({
            structure: structureOf(),
            players,
            horizon: 10,
        });
        expect(candidates.plans.every((plan) => plan.heavyStrain)).toBe(true);
        expect(['starter-heavy', 'balanced', 'bench-heavy']).toContain(candidates.recommended);
    });
});
describe('minute-plan horizon and fatigue forward model', () => {
    it('derives the block horizon as 10 games, or 2 for the final block', () => {
        expect(minutePlanHorizonGames(82)).toBe(10);
        expect(minutePlanHorizonGames(12)).toBe(10);
        expect(minutePlanHorizonGames(10)).toBe(10);
        expect(minutePlanHorizonGames(2)).toBe(2);
        expect(minutePlanHorizonGames(1)).toBe(1);
    });
    it('projects more fatigue over a longer horizon and respects bands', () => {
        const players = [player('a', { staminaRating: 70, fatigueBasisPoints: 0 })];
        const minutes = new Map([['a', 40]]);
        const short = projectFatigueAfterBlock(players, minutes, 2);
        const long = projectFatigueAfterBlock(players, minutes, 10);
        expect(long.get('a')?.fatigueBasisPoints ?? 0).toBeGreaterThan(short.get('a')?.fatigueBasisPoints ?? 0);
        expect(short.get('a')?.band).toBeDefined();
    });
    it('keeps heavy load in the heavy band and fresh load in fresh', () => {
        expect(fatigueBandOf(0)).toBe('fresh');
        expect(fatigueBandOf(1499)).toBe('fresh');
        expect(fatigueBandOf(1500)).toBe('ready');
        expect(fatigueBandOf(3499)).toBe('ready');
        expect(fatigueBandOf(3500)).toBe('tired');
        expect(fatigueBandOf(5999)).toBe('tired');
        expect(fatigueBandOf(6000)).toBe('heavy');
        expect(fatigueBandOf(10000)).toBe('heavy');
    });
    it('0-minute players still recover through the between-game recovery tick', () => {
        const players = [player('a', { staminaRating: 70, fatigueBasisPoints: 5000 })];
        const minutes = new Map([['a', 0]]);
        const after = projectFatigueAfterBlock(players, minutes, 2);
        expect(after.get('a')?.fatigueBasisPoints ?? 0).toBeLessThan(5000);
    });
});
describe('minute-plan rotation integration', () => {
    it('optimizer rotations satisfy the engine rotation audit through buildMinimalRotation', () => {
        const members = IDS.map((id) => ({
            playerVersionId: id,
            playable: ['PG', 'SG', 'SF', 'PF', 'C'] as const,
        }));
        const base = buildMinimalRotation({ franchiseId: 'lakers', members });
        expect(base.minutePolicy.strategy).toBe('balanced');
        expect(auditSeasonRotation(base, memberPlayable())).toEqual([]);
        expect(base.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
    });
});
