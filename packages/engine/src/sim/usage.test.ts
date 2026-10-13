import { describe, expect, it } from 'vitest';
import { buildPlayerSeason, buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { toSimulationPlayer } from '../modes/sandbox/adapters.ts';
import { finishingDemand } from './offense.ts';
import { toCollectionSimulationPlayer } from '../collection/cards.ts';

describe('finishing demand evidence', () => {
  it('uses recorded attempts and minutes instead of a missing usage fallback', () => {
    const source = buildPlayerSeason();
    source.stats.usageRate = null;
    source.stats.fieldGoalsAttempted = 1800;
    source.stats.gamesPlayed = 80;
    source.anchors.minutesPerGame = 40;
    source.tendencies.usageRate = 18;
    const demand = finishingDemand(toSimulationPlayer(source));
    expect(demand.source).toBe('observed-attempts');
    expect(demand.attemptsPer36).toBeCloseTo(20.25);
    source.tendencies.usageRate = 35;
    expect(finishingDemand(toSimulationPlayer(source))).toEqual(demand);
  });

  it('normalizes legacy attempt evidence by historical minutes', () => {
    const anchors = buildPlayerSeason().anchors;
    const player = buildSimulationPlayer({ anchors: { ...anchors, minutesPerGame: 24 } });
    player.tendencies.shotRate = 25;
    expect(finishingDemand(player).attemptsPer36).toBe(18);
    player.anchors = { ...anchors, minutesPerGame: 48 };
    expect(finishingDemand(player).attemptsPer36).toBe(9);
  });

  it('lets an authoritative Havoc mutation override historical workload', () => {
    const player = toSimulationPlayer(buildPlayerSeason());
    player.tendencies.shotRate = 99;
    player.tendencies.usageRate = 45;
    const evidence = { isAuthoritative: (channel: string) => channel === 'offensive-allocation' };
    expect(finishingDemand(player, evidence).source).toBe('tendency');
    expect(finishingDemand(player, evidence).attemptsPer36).toBeGreaterThan(
      finishingDemand(player).attemptsPer36,
    );
  });

  it('preserves explicit Collection shot and usage overlays through historical evidence', () => {
    const source = buildPlayerSeason();
    const resolved = {
      cardId: 'collection-workload-test',
      playerId: source.playerId,
      displayName: source.displayName,
      positions: source.positions.playable,
      ratings: source.detailedRatings,
      tendencies: { ...source.tendencies },
    };
    const base = finishingDemand(toCollectionSimulationPlayer(resolved, source));
    resolved.tendencies.shotRate += 10;
    resolved.tendencies.usageRate += 5;
    const boosted = toCollectionSimulationPlayer(resolved, source);
    expect(finishingDemand(boosted).attemptsPer36).toBeGreaterThan(base.attemptsPer36);
    expect(boosted.offensiveLoad?.source).toBe('derived-attempts');
    expect(boosted.anchors).toBe(source.anchors);
  });
});
