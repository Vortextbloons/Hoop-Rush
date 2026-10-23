import { describe, expect, it } from 'bun:test';
import { buildGameSimulationInput, buildLegalSimulationTeam } from '@hoop-rush/test-fixtures';
import { prepareTeam } from './prepare.ts';
import { ACTION_TYPES } from './usage.ts';
import { createRng } from './rng.ts';
import { pickAction, pickShot } from './usage.ts';
import { projectExpectedLedger } from '../projection/expected-ledger.ts';
import { playerVersionId } from '@hoop-rush/data-contracts';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing offensive fixture value');
  return value;
}

function shares(usage: number) {
  const team = buildLegalSimulationTeam();
  team.players.forEach((p, i) => {
    p.tendencies.usageRate = i === 1 ? usage : 36;
  });
  const prep = prepareTeam(team, buildGameSimulationInput().profile);
  const total = prep.initiatorWeights.reduce((a, b) => a + b, 0);
  let share = 0;
  team.players.forEach((p, index) => {
    const actions = required(prep.actionWeights.get(prep.keyOf(p)));
    const actionTotal = actions.reduce((a, b) => a + b, 0);
    ACTION_TYPES.forEach((action, ai) => {
      const mass =
        ((required(prep.initiatorWeights[index]) / total) * required(actions[ai])) / actionTotal;
      const pass = required(required(prep.passP.get(prep.keyOf(p)))[ai]);
      if (index === 1) share += mass * (1 - pass);
      const shots = required(prep.teammateShots.get(prep.keyOf(p)));
      const table = required(shots.byAction[ai]);
      const receiver = table.teammates.findIndex((q) => q === team.players[1]);
      if (receiver >= 0)
        share +=
          (mass * pass * required(table.weights[receiver])) /
          table.weights.reduce((a, b) => a + b, 0);
    });
  });
  return share;
}

describe('on-court offensive allocation', () => {
  it('does not lose finishing opportunities when historical usage crosses 23', () => {
    expect(shares(23)).toBeGreaterThanOrEqual(shares(22.99) - 1e-12);
  });

  it('increases finishing demand without also increasing creation responsibility', () => {
    const team = buildLegalSimulationTeam();
    team.players.forEach((player) => {
      player.offensiveLoad = { attemptsPer36: 12, source: 'observed-attempts', confidence: 1 };
    });
    const profile = buildGameSimulationInput().profile;
    const before = prepareTeam(team, profile);
    required(required(team.players[1]).offensiveLoad).attemptsPer36 = 24;
    const after = prepareTeam(team, profile);
    expect(after.offense.creatorShares).toEqual(before.offense.creatorShares);
    expect(after.offense.shotShares[1]).toBeGreaterThan(required(before.offense.shotShares[1]));
    expect(after.offense.shotShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  });

  it('matches the prepared marginal distribution across seeded action samples', () => {
    const team = buildLegalSimulationTeam();
    team.players.forEach((player, index) => {
      player.offensiveLoad = {
        attemptsPer36: 6 + index * 4,
        source: 'observed-attempts',
        confidence: 1,
      };
    });
    const prep = prepareTeam(team, buildGameSimulationInput().profile);
    const rng = createRng('offense-distribution-held-out');
    const counts = team.players.map(() => 0);
    const samples = 20000;
    for (let index = 0; index < samples; index++) {
      const initiator = rng.weightedPick(team.players, prep.initiatorPickTable);
      const key = prep.keyOf(initiator);
      const action = pickAction(initiator, required(prep.actionWeights.get(key)), rng);
      const shot = pickShot(
        required(prep.teammateShots.get(key)),
        initiator,
        action,
        rng,
        prep.passP.get(key),
      );
      const slot = team.players.indexOf(shot.shooter);
      counts[slot] = (counts[slot] ?? 0) + 1;
      expect(shot.passed).toBe(shot.shooter !== shot.initiator);
    }
    counts.forEach((count, index) => {
      expect(Math.abs(count / samples - required(prep.offense.shotShares[index]))).toBeLessThan(
        0.012,
      );
    });
  });

  it('normalizes variable Havoc units with distinct participant identities', () => {
    const base = buildLegalSimulationTeam();
    const team = {
      ...base,
      players: [...base.players, ...base.players.slice(0, 2).map((player) => ({ ...player }))],
    };
    const prep = prepareTeam(team, buildGameSimulationInput().profile, {
      keyOf: (player) => `participant-${String(team.players.indexOf(player))}`,
      responsibilitySlotOf: (_, index) => index % 5,
    });
    expect(prep.slotByPlayerId.size).toBe(7);
    expect(prep.offense.creatorShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(prep.offense.shotShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    for (const shots of prep.teammateShots.values()) {
      for (const action of shots.byAction) expect(action.teammates).toHaveLength(6);
    }
  });

  it('projects separate card versions and uses the same box-usage definition', () => {
    const team = buildLegalSimulationTeam();
    team.players.forEach((player, index) => {
      player.playerVersionId = playerVersionId(
        player.playerId,
        'lakers',
        '1990s',
        `199${String(index)}-9${String(index + 1)}`,
      );
    });
    const opponent = buildLegalSimulationTeam();
    const profile = buildGameSimulationInput().profile;
    const before = projectExpectedLedger({
      team,
      prep: prepareTeam(team, profile),
      opponent,
      opponentPrep: prepareTeam(opponent, profile),
      profile,
    });
    team.players.forEach((player) => {
      player.playerId = required(team.players[0]).playerId;
    });
    const after = projectExpectedLedger({
      team,
      prep: prepareTeam(team, profile),
      opponent,
      opponentPrep: prepareTeam(opponent, profile),
      profile,
    });
    expect(after.offense.ledger).toEqual(before.offense.ledger);
    const usageTotal = after.offense.players.reduce(
      (sum, p) => sum + p.expectedShots + 0.44 * p.expectedFreeThrowAttempts + p.expectedTurnovers,
      0,
    );
    after.offense.players.forEach((player, index) => {
      expect(player.expectedShots).toBe(required(before.offense.players[index]).expectedShots);
      expect(player.usageShare).toBeCloseTo(
        (player.expectedShots +
          0.44 * player.expectedFreeThrowAttempts +
          player.expectedTurnovers) /
          usageTotal,
        12,
      );
    });
  });

  it('keeps missing action evidence consistent with the uniform RNG fallback', () => {
    const team = buildLegalSimulationTeam();
    for (const player of team.players) {
      player.tendencies.isolationRate = 0;
      player.tendencies.pickAndRollBallHandlerRate = 0;
      player.tendencies.pickAndRollRollManRate = 0;
      player.tendencies.postUpRate = 0;
      player.tendencies.spotUpRate = 0;
      player.tendencies.cutRate = 0;
      player.tendencies.transitionRate = 0;
    }
    const prep = prepareTeam(team, buildGameSimulationInput().profile);
    expect(prep.offense.shotShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(prep.offense.shotShares.every((share) => share > 0)).toBe(true);
  });
});
