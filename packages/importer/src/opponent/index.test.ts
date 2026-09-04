import { parseOpponentTeam } from '@hoop-rush/data-contracts';
import { describe, expect, it } from 'vitest';
import { anchorsForPlayer, buildOpponentArtifact, LINEUP, type PoolPlayer } from './index.ts';
function poolPlayer(partial: Partial<PoolPlayer>): PoolPlayer {
    return {
        playerId: 'p-1',
        displayName: 'Test Player',
        heightInches: 78,
        weightLbs: 220,
        positions: { playable: ['SF', 'PF'] },
        detailedRatings: {
            insideScoring: 70,
            closeShot: 60,
            midrange: 55,
            threePoint: 50,
            freeThrow: 75,
            ballHandling: 65,
            passing: 60,
            offensiveIq: 65,
            offensiveRebound: 55,
            defensiveRebound: 60,
            perimeterDefense: 60,
            interiorDefense: 60,
            steal: 60,
            block: 55,
            defensiveIq: 60,
            speed: 70,
            strength: 65,
            vertical: 60,
        },
        tendencies: {
            usageRate: 18.5,
            passRate: 15.2,
            shotRate: 25.0,
            driveRate: 12.0,
            postUpRate: 5.0,
            rimFrequency: 35.0,
            shortMidFrequency: 18.0,
            longMidFrequency: 12.0,
            cornerThreeFrequency: 8.0,
            aboveBreakThreeFrequency: 15.0,
            threePointRate: 20.0,
            freeThrowRate: 25.0,
            turnoverRate: 12.0,
            isolationRate: 3.0,
            pickAndRollBallHandlerRate: 30.0,
            pickAndRollRollManRate: 8.0,
            spotUpRate: 20.0,
            transitionRate: 15.0,
            cutRate: 10.0,
            foulRate: 2.0,
            stealAttemptRate: 10.0,
            blockAttemptRate: 10.0,
            crashOffensiveGlassRate: 13.0,
        },
        stats: {
            gamesPlayed: 80,
            minutes: 3000,
            points: 1200,
            rebounds: 500,
            offensiveRebounds: 100,
            defensiveRebounds: 400,
            assists: 200,
            steals: 80,
            blocks: 50,
            turnovers: 120,
            fieldGoalsMade: 450,
            fieldGoalsAttempted: 950,
            threesMade: 60,
            threesAttempted: 180,
            freeThrowsMade: 240,
            freeThrowsAttempted: 320,
        },
        ...partial,
    };
}
const FIVE: PoolPlayer[] = [
    poolPlayer({
        playerId: 'p-89',
        displayName: 'Nick Van Exel',
        positions: { playable: ['PG', 'SG'] },
    }),
    poolPlayer({
        playerId: 'p-9',
        displayName: 'Sedale Threatt',
        positions: { playable: ['PG', 'SG'] },
    }),
    poolPlayer({
        playerId: 'p-920',
        displayName: 'A.C. Green',
        positions: { playable: ['PF', 'SF'] },
    }),
    poolPlayer({
        playerId: 'p-109',
        displayName: 'Robert Horry',
        positions: { playable: ['PF', 'SF'] },
    }),
    poolPlayer({ playerId: 'p-124', displayName: 'Vlade Divac', positions: { playable: ['C'] } }),
];
describe('anchorsForPlayer', () => {
    it('shrinks percentages toward priors and keeps the offensive/defensive split when known', () => {
        const p = poolPlayer({});
        const anchors = anchorsForPlayer(p);
        expect(anchors.gamesPlayed).toBe(80);
        expect(anchors.minutesPerGame).toBe(37.5);
        expect(anchors.pointsPerGame).toBe(15);
        expect(anchors.reboundsPerGame).toBe(6.25);
        expect(anchors.offensiveReboundsPerGame).toBe(1.25);
        expect(anchors.defensiveReboundsPerGame).toBe(5);
        expect(anchors.fieldGoalPct).toBeCloseTo(486 / 1030, 10);
        expect(anchors.threePointPct).toBeCloseTo((60 + 0.34 * 80) / (180 + 80), 10);
        expect(anchors.freeThrowPct).toBeCloseTo((240 + 0.75 * 80) / (320 + 80), 10);
        expect(anchors.threePointAttemptRate).toBeCloseTo(180 / 950, 10);
        expect(anchors.freeThrowAttemptRate).toBeCloseTo(320 / 950, 10);
    });
    it('falls back to the share split for a center with no offensive rebounds', () => {
        const p = poolPlayer({
            positions: { playable: ['C'] },
            stats: { ...poolPlayer({}).stats, offensiveRebounds: 0, defensiveRebounds: null },
        });
        const anchors = anchorsForPlayer(p);
        expect(anchors.offensiveReboundsPerGame).toBe(140 / 80);
        expect(anchors.defensiveReboundsPerGame).toBe((500 - 140) / 80);
    });
    it('uses the fallback split for forwards with many rebounds and no split data', () => {
        const p = poolPlayer({
            positions: { playable: ['SF', 'PF'] },
            stats: {
                ...poolPlayer({}).stats,
                offensiveRebounds: null,
                defensiveRebounds: null,
                rebounds: 400,
            },
        });
        const anchors = anchorsForPlayer(p);
        expect(anchors.offensiveReboundsPerGame).toBe(88 / 80);
        expect(anchors.defensiveReboundsPerGame).toBe((400 - 88) / 80);
    });
    it('emits null threePointPct when the player took no threes', () => {
        const p = poolPlayer({
            stats: { ...poolPlayer({}).stats, threesMade: 0, threesAttempted: 0 },
        });
        const anchors = anchorsForPlayer(p);
        expect(anchors.threePointPct).toBeNull();
    });
    it('returns the prior for zero-attempt percentages', () => {
        const p = poolPlayer({
            stats: {
                ...poolPlayer({}).stats,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
            },
        });
        const anchors = anchorsForPlayer(p);
        expect(anchors.fieldGoalPct).toBe(0.45);
        expect(anchors.freeThrowPct).toBe(0.75);
        expect(anchors.threePointAttemptRate).toBe(0);
        expect(anchors.freeThrowAttemptRate).toBe(0.2);
    });
});
describe('buildOpponentArtifact', () => {
    it('builds the exact committed artifact shape and validates against the schema', () => {
        const artifact = buildOpponentArtifact({ players: FIVE });
        expect(artifact.schemaVersion).toBe(2);
        expect(artifact.opponentId).toBe('lakers-1990s-opening');
        expect(artifact.bracketVersion).toBe('bracket-m3-v3');
        expect(artifact.difficultyBand).toBe('medium');
        expect(artifact.teamId).toBe('lakers');
        expect(artifact.displayName).toBe('Los Angeles Lakers');
        expect(artifact.seasonKey).toBe('1995-96');
        expect(artifact.lineup.structure).toEqual(['G', 'G', 'F', 'F', 'C']);
        expect(artifact.lineup.assignments).toHaveLength(5);
        expect(artifact.players).toHaveLength(5);
        for (const assignment of artifact.lineup.assignments) {
            expect(assignment.slotIndex).toBeGreaterThanOrEqual(0);
            expect(assignment.slotIndex).toBeLessThanOrEqual(4);
            expect(assignment.positions.length).toBeGreaterThan(0);
        }
        for (let i = 0; i < LINEUP.length; i += 1) {
            expect(artifact.lineup.assignments[i]?.playerId).toBe(LINEUP[i]?.playerId);
            expect(artifact.players[i]?.playerId).toBe(LINEUP[i]?.playerId);
            expect(artifact.players[i]?.positions).toEqual(artifact.lineup.assignments[i]?.positions);
        }
        expect(() => parseOpponentTeam(artifact)).not.toThrow();
    });
    it('clamps and rounds ratings like the Python clamp_rating flow', () => {
        const wild: PoolPlayer[] = FIVE.map((p, i) => i === 0
            ? poolPlayer({
                playerId: 'p-89',
                detailedRatings: { ...p.detailedRatings, freeThrow: 150.4, insideScoring: -20.6 },
            })
            : p);
        const artifact = buildOpponentArtifact({ players: wild });
        const first = artifact.players[0];
        expect(first?.ratings.freeThrow).toBe(100);
        expect(first?.ratings.insideScoring).toBe(0);
        expect(first?.ratings.midrange).toBe(55);
    });
    it('errors listing every missing lineup player', () => {
        expect(() => buildOpponentArtifact({ players: FIVE.slice(0, 3) })).toThrow(/missing pool player p-109, p-124/);
    });
});
