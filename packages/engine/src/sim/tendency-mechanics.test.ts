import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { buildLegalSimulationTeam } from '@hoop-rush/test-fixtures';
import { foulerWeights, shootingFoulProbability } from './fouls.ts';
import { rebounderWeights, teamMean } from './rebounding.ts';
import { stealerWeights } from './security.ts';
import { blockProbability } from './shooting.ts';
import { buildEraSimulationProfile } from '@hoop-rush/test-fixtures';
import { createRng } from './rng.ts';
import { actionWeights, pickAction } from './usage.ts';
import { responsibilityModifiersForSlot } from './position-responsibilities.ts';
function playerAt(team: SimulationTeam, index: number): SimulationPlayer {
    const player = team.players[index];
    if (!player)
        throw new Error(`fixture player ${String(index)} missing`);
    return player;
}
function headWeight(weights: readonly number[]): number {
    const head = weights[0];
    if (head === undefined)
        throw new Error('expected a non-empty weight list');
    return head;
}
function withTendency(key: string, value: number) {
    const team = buildLegalSimulationTeam();
    return {
        ...team,
        players: team.players.map((player, index) => index === 0 ? { ...player, tendencies: { ...player.tendencies, [key]: value } } : player),
    };
}
describe('player tendencies affect possession mechanics', () => {
    it('uses foul aggression in foul probability and attribution', () => {
        const low = withTendency('foulRate', 3);
        const high = withTendency('foulRate', 12);
        const shooter = playerAt(low, 1);
        expect(headWeight(foulerWeights(high))).toBeGreaterThan(headWeight(foulerWeights(low)));
        expect(shootingFoulProbability(shooter, playerAt(high, 0), 'rim', buildEraSimulationProfile())).toBeGreaterThan(shootingFoulProbability(shooter, playerAt(low, 0), 'rim', buildEraSimulationProfile()));
    });
    it('uses steal, block, and offensive-glass aggression', () => {
        const lowSteal = withTendency('stealAttemptRate', 4);
        const highSteal = withTendency('stealAttemptRate', 18);
        expect(headWeight(stealerWeights(highSteal))).toBeGreaterThan(headWeight(stealerWeights(lowSteal)));
        const lowBlock = playerAt(withTendency('blockAttemptRate', 4), 0);
        const highBlock = playerAt(withTendency('blockAttemptRate', 18), 0);
        expect(blockProbability(highBlock, 'rim', 'pickAndRoll')).toBeGreaterThan(blockProbability(lowBlock, 'rim', 'pickAndRoll'));
        const lowCrash = withTendency('crashOffensiveGlassRate', 4);
        const highCrash = withTendency('crashOffensiveGlassRate', 30);
        expect(teamMean(highCrash, 'offensiveRebound')).toBeGreaterThan(teamMean(lowCrash, 'offensiveRebound'));
        expect(headWeight(rebounderWeights(highCrash, true))).toBeGreaterThan(headWeight(rebounderWeights(lowCrash, true)));
    });
    it('creates more transition actions after live turnovers and defensive rebounds', () => {
        const player = playerAt(buildLegalSimulationTeam(), 0);
        const weights = actionWeights(player, responsibilityModifiersForSlot(0));
        const transitionCount = (start: NonNullable<Parameters<typeof pickAction>[3]>): number => {
            const rng = createRng(`transition-${start}`);
            let count = 0;
            for (let i = 0; i < 5000; i += 1) {
                if (pickAction(player, weights, rng, start) === 'transition')
                    count += 1;
            }
            return count;
        };
        const deadBall = transitionCount('deadBall');
        const defensiveRebound = transitionCount('defensiveRebound');
        const liveTurnover = transitionCount('liveTurnover');
        expect(defensiveRebound).toBeGreaterThan(deadBall * 2);
        expect(liveTurnover).toBeGreaterThan(defensiveRebound);
    });
});
