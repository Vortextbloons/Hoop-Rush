import { describe, expect, it } from 'vitest';
import type { SimulationTeam } from '@hoop-rush/data-contracts';
import { buildEraSimulationProfile, buildLegalSimulationTeam, buildSimulationPlayer, buildSlotPermutationTeams, } from '@hoop-rush/test-fixtures';
import { ENGINE_CONSTANTS, ENGINE_VERSION } from './constants.ts';
import { boundResponsibilityModifiers, responsibilityModifiersForSlot, sameGroupMatchWeight, slotGroupOfSlot, type PositionResponsibilityModifiers, } from './position-responsibilities.ts';
import { prepareTeam } from './prepare.ts';
import { actionWeights, identityModifiers, initiatorWeight, teammateShotWeights } from './usage.ts';
import { rebounderWeights } from './rebounding.ts';
const profile = buildEraSimulationProfile();
const PERMUTATION_ONE = buildSlotPermutationTeams()[0];
if (PERMUTATION_ONE === undefined) {
    throw new Error('fixture missing first slot permutation');
}
function playerAt(team: SimulationTeam, index: number) {
    const player = team.players[index];
    if (player === undefined)
        throw new Error(`fixture player ${String(index)} missing`);
    return player;
}
describe('assigned-position responsibility modifiers', () => {
    it('ships with the responsibility constants versioned', () => {
        expect(ENGINE_VERSION).toBe(ENGINE_CONSTANTS.version);
        expect(ENGINE_VERSION).toMatch(/^m3-engine-v\d+$/);
        expect(ENGINE_CONSTANTS.positionResponsibilityBound).toBeGreaterThanOrEqual(0.08);
    });
    it('keeps every coefficient inside the bounded band around 1', () => {
        const bound = ENGINE_CONSTANTS.positionResponsibilityBound;
        for (const group of ['G', 'F', 'C'] as const) {
            for (const value of Object.values(ENGINE_CONSTANTS.positionResponsibility[group])) {
                expect(value).toBeGreaterThanOrEqual(1 - bound);
                expect(value).toBeLessThanOrEqual(1 + bound);
                expect(value).toBeGreaterThan(0);
            }
        }
    });
    it('has the expected slot directionality', () => {
        const g = ENGINE_CONSTANTS.positionResponsibility.G;
        const f = ENGINE_CONSTANTS.positionResponsibility.F;
        const c = ENGINE_CONSTANTS.positionResponsibility.C;
        expect(g.initiation).toBeGreaterThan(f.initiation);
        expect(f.initiation).toBeGreaterThan(c.initiation);
        expect(g.pnrHandler).toBeGreaterThan(f.pnrHandler);
        expect(f.pnrHandler).toBeGreaterThan(c.pnrHandler);
        expect(c.rollMan).toBeGreaterThan(f.rollMan);
        expect(f.rollMan).toBeGreaterThan(g.rollMan);
        expect(c.postUp).toBeGreaterThan(f.postUp);
        expect(f.postUp).toBeGreaterThan(g.postUp);
        expect(c.rebounding).toBeGreaterThan(f.rebounding);
        expect(f.rebounding).toBeGreaterThan(g.rebounding);
        expect(c.rimProtection).toBeGreaterThan(f.rimProtection);
        expect(f.rimProtection).toBeGreaterThan(g.rimProtection);
    });
    it('maps slot indices to the fixed G,G,F,F,C structure', () => {
        expect([0, 1, 2, 3, 4].map((slot) => slotGroupOfSlot(slot))).toEqual(['G', 'G', 'F', 'F', 'C']);
        expect(() => slotGroupOfSlot(5)).toThrow();
        expect(() => slotGroupOfSlot(-1)).toThrow();
    });
    it('awards the same-group matchup bonus only for matching assigned slot groups', () => {
        const bonus = ENGINE_CONSTANTS.positionMatchBonus;
        expect(sameGroupMatchWeight(0, 1)).toBe(bonus);
        expect(sameGroupMatchWeight(2, 3)).toBe(bonus);
        expect(sameGroupMatchWeight(4, 4)).toBe(bonus);
        expect(sameGroupMatchWeight(0, 2)).toBe(1);
        expect(sameGroupMatchWeight(3, 4)).toBe(1);
        expect(sameGroupMatchWeight(0, 4)).toBe(1);
    });
    it('clamps out-of-band coefficients to the bounded range', () => {
        const wild: PositionResponsibilityModifiers = {
            initiation: 2,
            pnrHandler: -1,
            rollMan: 0.5,
            postUp: 1,
            rebounding: 1,
            rimProtection: 1,
        };
        const bounded = boundResponsibilityModifiers(wild, 0.12);
        expect(bounded.initiation).toBe(1.12);
        expect(bounded.pnrHandler).toBe(0.88);
        expect(bounded.rollMan).toBe(0.88);
        expect(bounded.postUp).toBe(1);
    });
    it('exposes deterministic per-slot modifiers through prepareTeam without mutating inputs', () => {
        const team = buildLegalSimulationTeam();
        const snapshot = JSON.stringify(team);
        const prep = prepareTeam(team, profile);
        expect(JSON.stringify(team)).toBe(snapshot);
        team.players.forEach((player, slot) => {
            expect(prep.positionModifiers.get(player.playerId)).toEqual(responsibilityModifiersForSlot(slot));
        });
        const again = prepareTeam(team, profile);
        team.players.forEach((player) => {
            expect(again.positionModifiers.get(player.playerId)).toEqual(prep.positionModifiers.get(player.playerId));
        });
    });
    it('scales initiator weights by the assigned-slot initiation modifier', () => {
        const creator = playerAt(PERMUTATION_ONE, 0);
        const gMods = responsibilityModifiersForSlot(0);
        expect(initiatorWeight(creator, PERMUTATION_ONE, gMods) /
            initiatorWeight(creator, PERMUTATION_ONE, identityModifiers)).toBeCloseTo(ENGINE_CONSTANTS.positionResponsibility.G.initiation, 12);
        const cMods = responsibilityModifiersForSlot(4);
        expect(initiatorWeight(creator, PERMUTATION_ONE, cMods) /
            initiatorWeight(creator, PERMUTATION_ONE, identityModifiers)).toBeCloseTo(ENGINE_CONSTANTS.positionResponsibility.C.initiation, 12);
    });
    it('scales handler, roll-man, and post-up action weights only', () => {
        const creator = playerAt(PERMUTATION_ONE, 0);
        const gMods = responsibilityModifiersForSlot(0);
        const weighted = actionWeights(creator, gMods);
        const plain = actionWeights(creator, identityModifiers);
        expect(weighted[1] ?? 0).toBeCloseTo((plain[1] ?? 0) * ENGINE_CONSTANTS.positionResponsibility.G.pnrHandler, 12);
        expect(weighted[2] ?? 0).toBeCloseTo((plain[2] ?? 0) * ENGINE_CONSTANTS.positionResponsibility.G.rollMan, 12);
        expect(weighted[3] ?? 0).toBeCloseTo((plain[3] ?? 0) * ENGINE_CONSTANTS.positionResponsibility.G.postUp, 12);
        expect(weighted[0]).toBe(plain[0]);
        expect(weighted[4]).toBe(plain[4]);
        expect(weighted[5]).toBe(plain[5]);
        expect(weighted[6]).toBe(plain[6]);
    });
    it('never manufactures an action from a zero tendency', () => {
        const base = buildSimulationPlayer();
        const zero = buildSimulationPlayer({
            playerId: 'p-zero',
            tendencies: {
                ...base.tendencies,
                pickAndRollBallHandlerRate: 0,
                pickAndRollRollManRate: 0,
                postUpRate: 0,
            },
        });
        const weights = actionWeights(zero, responsibilityModifiersForSlot(4));
        expect(weights[1]).toBe(0);
        expect(weights[2]).toBe(0);
        expect(weights[3]).toBe(0);
        expect(initiatorWeight(zero, buildLegalSimulationTeam(), responsibilityModifiersForSlot(4))).toBeGreaterThan(0);
    });
    it('scales roll-man teammate selection by the teammate slot modifier', () => {
        const creator = playerAt(PERMUTATION_ONE, 0);
        const prep = prepareTeam(PERMUTATION_ONE, profile);
        const rollMods = prep.positionModifiers;
        const rollWeighted = teammateShotWeights(PERMUTATION_ONE, creator, 'pickAndRollRoll', rollMods).weights;
        const rollPlain = teammateShotWeights(PERMUTATION_ONE, creator, 'pickAndRollRoll', new Map()).weights;
        const rimIndex = rollWeighted.length - 1;
        const rim = rollPlain[rimIndex];
        expect(rim).toBeDefined();
        expect(rollWeighted[rimIndex] ?? 0).toBeCloseTo((rim ?? 0) * ENGINE_CONSTANTS.positionResponsibility.C.rollMan, 12);
        const passWeighted = teammateShotWeights(PERMUTATION_ONE, creator, 'spotUp', rollMods).weights;
        const passPlain = teammateShotWeights(PERMUTATION_ONE, creator, 'spotUp', new Map()).weights;
        expect(passWeighted).toEqual(passPlain);
    });
    it('scales rebound attribution weights by the assigned-slot rebounding modifier', () => {
        const prep = prepareTeam(PERMUTATION_ONE, profile);
        const off = rebounderWeights(PERMUTATION_ONE, true);
        const offMods = rebounderWeights(PERMUTATION_ONE, true, prep.positionModifiers);
        const def = rebounderWeights(PERMUTATION_ONE, false);
        const defMods = rebounderWeights(PERMUTATION_ONE, false, prep.positionModifiers);
        const rimOff = off[4];
        const rimDef = def[4];
        expect(rimOff).toBeDefined();
        expect(rimDef).toBeDefined();
        expect(offMods[4] ?? 0).toBeCloseTo((rimOff ?? 0) * ENGINE_CONSTANTS.positionResponsibility.C.rebounding, 12);
        expect(defMods[4] ?? 0).toBeCloseTo((rimDef ?? 0) * ENGINE_CONSTANTS.positionResponsibility.C.rebounding, 12);
        expect(offMods[0] ?? 0).toBeCloseTo((off[0] ?? 0) * ENGINE_CONSTANTS.positionResponsibility.G.rebounding, 12);
    });
    it('derives all modifier tables purely from the player snapshot and slot index', () => {
        const copy: SimulationTeam = {
            ...PERMUTATION_ONE,
            players: PERMUTATION_ONE.players.map((player) => ({
                ...player,
                displayName: `renamed-${player.playerId}`,
            })),
        };
        const a = prepareTeam(PERMUTATION_ONE, profile);
        const b = prepareTeam(copy, profile);
        PERMUTATION_ONE.players.forEach((player) => {
            expect(b.positionModifiers.get(player.playerId)).toEqual(a.positionModifiers.get(player.playerId));
        });
    });
});
