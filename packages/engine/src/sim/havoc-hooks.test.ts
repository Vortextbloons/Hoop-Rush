import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { eraSimulationProfileSchema, playerIdSchema } from '@hoop-rush/data-contracts';
import {
  buildHavocEraProfile,
  buildLegalSimulationTeam,
  buildSimulationPlayer,
} from '@hoop-rush/test-fixtures';
import type { HavocEvidence } from './havoc-runtime.ts';
import { blockProbability, makeProbability } from './shooting.ts';
import { turnoverProbability } from './security.ts';
import { freeThrowProbability } from './fouls.ts';
import { rebounderWeights, teamMean } from './rebounding.ts';
import { prepareTeam } from './prepare.ts';
import { GameRecorder } from './recorder.ts';

const profile = eraSimulationProfileSchema.parse(buildHavocEraProfile());

function evidenceFor(channels: string[]): HavocEvidence {
  return {
    isAuthoritative: (channel) => channels.includes(channel),
  };
}

function anchoredShooter(): SimulationPlayer {
  return buildSimulationPlayer({
    playerId: playerIdSchema.parse('p-hooks-anchored'),
    displayName: 'Anchored',
    ratings: {
      ...buildSimulationPlayer().ratings,
      threePoint: 95,
      perimeterDefense: 80,
    },
    anchors: {
      gamesPlayed: 80,
      minutesPerGame: 35,
      pointsPerGame: 20,
      reboundsPerGame: 5,
      offensiveReboundsPerGame: 1,
      defensiveReboundsPerGame: 4,
      assistsPerGame: 5,
      stealsPerGame: 1,
      blocksPerGame: 0.5,
      turnoversPerGame: 2,
      fieldGoalPct: 0.42,
      threePointPct: 0.2,
      freeThrowPct: 0.6,
      threePointAttemptRate: 0.4,
      freeThrowAttemptRate: 0.3,
    },
  });
}

describe('havoc sim hooks: evidence handling', () => {
  it('bypasses historical three-point evidence when authoritative', () => {
    const shooter = anchoredShooter();
    const defender = buildSimulationPlayer({ playerId: playerIdSchema.parse('p-hooks-def') });
    const prep = { spacing: 0.5, twoPointAnchor: null };
    const ordinary = makeProbability(
      shooter,
      defender,
      profile,
      'aboveBreakThree',
      'spotUp',
      300,
      prep,
    );
    const authoritative = makeProbability(
      shooter,
      defender,
      profile,
      'aboveBreakThree',
      'spotUp',
      300,
      prep,
      0,
      0,
      { shooterEvidence: evidenceFor(['three-point-accuracy']) },
    );
    expect(authoritative).not.toBe(ordinary);
    expect(authoritative).toBeGreaterThan(ordinary);
  });

  it('drops block anchors when the block-anchor channel is authoritative', () => {
    const defender = buildSimulationPlayer({
      playerId: playerIdSchema.parse('p-hooks-block'),
      ratings: { ...buildSimulationPlayer().ratings, block: 90 },
      anchors: {
        gamesPlayed: 80,
        minutesPerGame: 30,
        pointsPerGame: 10,
        reboundsPerGame: 5,
        offensiveReboundsPerGame: 1,
        defensiveReboundsPerGame: 4,
        assistsPerGame: 1,
        stealsPerGame: 1,
        blocksPerGame: 3.5,
        turnoversPerGame: 1,
        fieldGoalPct: 0.5,
        threePointPct: null,
        freeThrowPct: 0.7,
        threePointAttemptRate: null,
        freeThrowAttemptRate: 0.2,
      },
    });
    const anchored = blockProbability(defender, 'rim', 'isolation');
    const authoritative = blockProbability(
      defender,
      'rim',
      'isolation',
      evidenceFor(['block-anchor']),
    );
    expect(authoritative).toBeLessThan(anchored);
  });

  it('applies reach point deltas to block probability', () => {
    const defender = buildSimulationPlayer({ playerId: playerIdSchema.parse('p-hooks-reach') });
    const base = blockProbability(defender, 'shortMid', 'spotUp');
    const boosted = blockProbability(defender, 'shortMid', 'spotUp', undefined, 0.04);
    expect(boosted).toBeGreaterThan(base);
    const reduced = blockProbability(defender, 'shortMid', 'spotUp', undefined, -0.04);
    expect(reduced).toBeLessThan(base);
  });

  it('uses the tendency-only turnover blend when authoritative', () => {
    const handler = buildSimulationPlayer({
      playerId: playerIdSchema.parse('p-hooks-handler'),
      tendencies: { ...buildSimulationPlayer().tendencies, turnoverRate: 30 },
    });
    const ordinary = turnoverProbability(handler, 0.67, 1, profile);
    const authoritative = turnoverProbability(
      handler,
      0.67,
      1,
      profile,
      0,
      0,
      evidenceFor(['turnover-blend']),
    );
    expect(authoritative).toBeGreaterThan(ordinary);
  });

  it('bypasses free-throw evidence when authoritative', () => {
    const shooter = anchoredShooter();
    const ordinary = freeThrowProbability(shooter, profile);
    const authoritative = freeThrowProbability(
      shooter,
      profile,
      evidenceFor(['free-throw-accuracy']),
    );
    expect(authoritative).not.toBe(ordinary);
  });
});

describe('havoc sim hooks: physical and aggregation options', () => {
  it('scales individual rebounder weights', () => {
    const team = buildLegalSimulationTeam();
    const base = rebounderWeights(team, true);
    const scaled = rebounderWeights(team, true, undefined, undefined, undefined, () => 1.1);
    base.forEach((weight, index) => {
      expect(scaled[index]).toBeCloseTo(weight * 1.1, 10);
    });
  });

  it('adds reach to team rebound strength and keeps the divisor explicit', () => {
    const team = buildLegalSimulationTeam();
    const five = buildLegalSimulationTeam({
      players: [
        team.players[0],
        team.players[1],
        team.players[2],
        team.players[3],
        team.players[4],
      ].filter((player): player is SimulationPlayer => player !== undefined),
    });
    const base = teamMean(five, 'defensiveRebound');
    const withReach = teamMean(five, 'defensiveRebound', { reachOf: () => 4 });
    expect(withReach).toBeGreaterThan(base);
    const six: SimulationTeam = {
      teamId: five.teamId,
      displayName: five.displayName,
      players: [
        ...five.players,
        buildSimulationPlayer({ playerId: playerIdSchema.parse('p-hooks-sixth') }),
      ],
    };
    const divisorFive = teamMean(six, 'defensiveRebound', { divisor: 5 });
    const divisorSix = teamMean(six, 'defensiveRebound', { divisor: 6 });
    expect(divisorFive).toBeGreaterThan(divisorSix);
  });

  it('distinguishes runtime identity keys for source-identical players', () => {
    const shared = buildSimulationPlayer({ playerId: playerIdSchema.parse('p-hooks-shared') });
    const team = buildLegalSimulationTeam({
      players: [
        shared,
        shared,
        shared,
        shared,
        buildSimulationPlayer({ playerId: playerIdSchema.parse('p-hooks-fifth') }),
      ],
    });
    const defaultPrep = prepareTeam(team, profile);
    expect(defaultPrep.slotByPlayerId.size).toBe(2);
    const keys = ['inst-a', 'inst-b', 'inst-c', 'inst-d', 'inst-e'];
    const identityPrep = prepareTeam(team, profile, {
      keyOf: (player) => keys[team.players.indexOf(player)] ?? 'missing',
    });
    expect(identityPrep.slotByPlayerId.size).toBe(5);
    const third = team.players[2];
    if (third === undefined) throw new Error('missing player');
    const shots = identityPrep.teammateShots.get('inst-c');
    expect(shots).toBeDefined();
    expect(shots?.pass.teammates).toHaveLength(4);
    expect(shots?.roll.teammates).toHaveLength(4);
  });

  it('keeps the recorder five-slot path strict and allows variable units', () => {
    const recorder = new GameRecorder([15, 15]);
    recorder.setActiveFive(0, [0, 1, 2, 3, 4]);
    recorder.setActiveUnits(0, [0, 1, 2, 3, 4, 5, 6]);
    expect(() => {
      recorder.setActiveFive(0, [0, 1, 2, 3, 4, 5]);
    }).toThrow();
    expect(() => {
      recorder.setActiveUnits(0, [0, 1, 2, 3]);
    }).toThrow();
    expect(() => {
      recorder.setActiveUnits(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }).toThrow();
  });
});
