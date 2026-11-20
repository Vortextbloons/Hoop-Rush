import { describe, expect, it } from 'bun:test';
import type { CapRushSourcePlayer } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_FIRST_APRON_DOLLARS,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  capRushSourcePlayerSchema,
  playerVersionId,
} from '@hoop-rush/data-contracts';
import {
  capRushApronStrip,
  capRushLockedApron,
  capRushProjectedApron,
} from './cap-rush-player-profile.ts';
import { apronHeadlineReductions } from '#lib/players/player-apron.js';

function sourcePlayer(): CapRushSourcePlayer {
  const parsed = capRushSourcePlayerSchema.parse({
    playerId: 'p-test',
    playerVersionId: playerVersionId('p-test', 'lakers', '1990s', '1999-00'),
    displayName: 'Test Player',
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1999-00',
    positions: ['PG', 'SG'],
    originalOverall: 88,
    physical: { heightInches: 76, weightLbs: 190 },
    profile: {
      ratings: sourceRatings(),
      tendencies: sourceTendencies(),
    },
  });
  return parsed;
}

function sourceRatings(): CapRushSourcePlayer['profile']['ratings'] {
  return {
    insideScoring: 70,
    closeShot: 68,
    midrange: 66,
    threePoint: 80,
    freeThrow: 82,
    ballHandling: 75,
    passing: 78,
    offensiveIq: 74,
    offensiveRebound: 40,
    defensiveRebound: 55,
    perimeterDefense: 72,
    interiorDefense: 50,
    steal: 70,
    block: 45,
    defensiveIq: 72,
    speed: 74,
    strength: 60,
    vertical: 66,
  };
}

function sourceTendencies(): CapRushSourcePlayer['profile']['tendencies'] {
  return {
    usageRate: 24,
    passRate: 22,
    shotRate: 30,
    driveRate: 20,
    postUpRate: 5,
    rimFrequency: 26,
    shortMidFrequency: 20,
    longMidFrequency: 16,
    cornerThreeFrequency: 10,
    aboveBreakThreeFrequency: 18,
    threePointRate: 30,
    freeThrowRate: 24,
    turnoverRate: 12,
    isolationRate: 10,
    pickAndRollBallHandlerRate: 28,
    pickAndRollRollManRate: 8,
    spotUpRate: 20,
    transitionRate: 16,
    cutRate: 9,
    foulRate: 4,
    stealAttemptRate: 9,
    blockAttemptRate: 8,
    crashOffensiveGlassRate: 10,
  };
}

describe('cap rush apron gating', () => {
  it('stays hidden while payroll remains under the cap', () => {
    const view = capRushProjectedApron(sourcePlayer(), CAP_RUSH_CAP_LINE_DOLLARS);
    expect(view.status.kind).toBe('none');
    expect(view.reductions).toEqual([]);
    expect(view.rules).toEqual([]);
    expect(capRushApronStrip(view)).toBeNull();
  });

  it('projects the first apron once payroll crosses the cap line', () => {
    const view = capRushProjectedApron(sourcePlayer(), CAP_RUSH_CAP_LINE_DOLLARS + 1);
    expect(view.status.kind).toBe('projected');
    expect(view.status.kind === 'none' ? null : view.status.tier).toBe('first');
    expect(view.reductions.length).toBeGreaterThan(0);
  });

  it('projects the second apron past the first apron line', () => {
    const view = capRushProjectedApron(sourcePlayer(), CAP_RUSH_FIRST_APRON_DOLLARS + 1);
    expect(view.status.kind === 'none' ? null : view.status.tier).toBe('second');
  });

  it('treats the first apron line itself as the first tier', () => {
    const view = capRushProjectedApron(sourcePlayer(), CAP_RUSH_FIRST_APRON_DOLLARS);
    expect(view.status.kind === 'none' ? null : view.status.tier).toBe('first');
  });

  it('reports the applied state for a locked apron lineup', () => {
    const view = capRushLockedApron(sourcePlayer(), CAP_RUSH_HARD_LIMIT_DOLLARS);
    expect(view.status.kind).toBe('applied');
    expect(view.status.kind === 'none' ? null : view.status.tier).toBe('second');
  });

  it('keeps a locked under-cap lineup free of apron content', () => {
    const view = capRushLockedApron(sourcePlayer(), CAP_RUSH_CAP_LINE_DOLLARS);
    expect(view.status.kind).toBe('none');
    expect(capRushApronStrip(view)).toBeNull();
  });

  it('reduces the second apron harder than the first for the same rating', () => {
    const first = capRushProjectedApron(sourcePlayer(), CAP_RUSH_CAP_LINE_DOLLARS + 1);
    const second = capRushProjectedApron(sourcePlayer(), CAP_RUSH_FIRST_APRON_DOLLARS + 1);
    const drop = (view: typeof first, label: string) => {
      const row = view.reductions.find((entry) => entry.label === label);
      return row === undefined ? 0 : row.original - row.effective;
    };
    expect(drop(second, 'Passing')).toBeGreaterThan(drop(first, 'Passing'));
  });

  it('never reports an effective value below zero', () => {
    const player = sourcePlayer();
    player.profile.ratings.passing = 2;
    const view = capRushProjectedApron(player, CAP_RUSH_FIRST_APRON_DOLLARS + 1);
    for (const row of view.reductions) {
      expect(row.effective).toBeGreaterThanOrEqual(0);
    }
  });

  it('summarizes only the largest reductions on the card strip', () => {
    const view = capRushProjectedApron(sourcePlayer(), CAP_RUSH_FIRST_APRON_DOLLARS + 1);
    const strip = capRushApronStrip(view);
    expect(strip).not.toBeNull();
    expect(strip).toStartWith('2nd apron');
    const headline = apronHeadlineReductions(view.reductions);
    expect(headline.length).toBe(2);
    const drops = view.reductions.map((row) => row.original - row.effective);
    const largest = Math.max(...drops);
    const top = headline[0];
    expect(top).toBeDefined();
    if (top === undefined) return;
    expect(top.original - top.effective).toBe(largest);
    const second = headline[1];
    if (second === undefined) return;
    expect(top.original - top.effective).toBeGreaterThanOrEqual(second.original - second.effective);
  });
});
