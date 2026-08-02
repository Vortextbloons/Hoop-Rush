import { describe, it } from 'vitest';
import type { GameSimulationInput, SimulationTeam } from '@hoop-rush/data-contracts';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineContext } from './context.js';
import { simulateGame } from './game.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function fixtureSeed(fixtureId: string, index: number): string {
  let hash = 0x811c9dc5;
  const value = `${fixtureId}-${String(index)}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
}

describe('scratch league average', () => {
  it('prints full box for the 1990s league-average team', () => {
    const profile = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json'), 'utf8'),
    ) as unknown as GameSimulationInput['profile'];
    const pool = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/pools/lakers-1990s.json'), 'utf8'),
    ) as {
      players: Array<{
        tendencies: Record<string, number | undefined>;
        detailedRatings: Record<string, number | undefined>;
      }>;
    };
    const usage = pool.players.map((p) => Math.max(0.01, p.tendencies.usageRate ?? 0.01));
    const totalUsage = usage.reduce((a, b) => a + b, 0);
    const meanRatings: Record<string, number> = {};
    const meanTendencies: Record<string, number> = {};
    pool.players.forEach((player, i) => {
      const usageAt = usage[i];
      if (usageAt === undefined) return;
      const weight = usageAt / totalUsage;
      for (const [key, value] of Object.entries(player.detailedRatings)) {
        meanRatings[key] = (meanRatings[key] ?? 0) + (typeof value === 'number' ? value : 0) * weight;
      }
      for (const [key, value] of Object.entries(player.tendencies)) {
        meanTendencies[key] =
          (meanTendencies[key] ?? 0) + (typeof value === 'number' ? value : 0) * weight;
      }
    });
    const rating = (k: string) => Math.round(meanRatings[k] ?? 50);
    const tend = (k: string) => meanTendencies[k] ?? 0;
    const slots: SimulationTeam['players'][number]['positions'][] = [
      ['G'],
      ['G'],
      ['F'],
      ['F'],
      ['C'],
    ];
    const team: SimulationTeam = {
      teamId: 'league-average',
      displayName: 'League Average',
      players: slots.map((positions, i) => ({
        playerId: `avg-${String(i)}`,
        displayName: 'League Average',
        positions,
        heightInches: 80,
        weightLbs: 220,
        ratings: {
          insideScoring: rating('insideScoring'),
          closeShot: rating('closeShot'),
          midrange: rating('midrange'),
          threePoint: rating('threePoint'),
          freeThrow: rating('freeThrow'),
          ballHandling: rating('ballHandling'),
          passing: rating('passing'),
          offensiveIq: rating('offensiveIq'),
          offensiveRebound: rating('offensiveRebound'),
          defensiveRebound: rating('defensiveRebound'),
          perimeterDefense: rating('perimeterDefense'),
          interiorDefense: rating('interiorDefense'),
          steal: rating('steal'),
          block: rating('block'),
          defensiveIq: rating('defensiveIq'),
          speed: rating('speed'),
          strength: rating('strength'),
          vertical: rating('vertical'),
        },
        tendencies: {
          usageRate: tend('usageRate'),
          passRate: tend('passRate'),
          shotRate: tend('shotRate'),
          driveRate: tend('driveRate'),
          postUpRate: tend('postUpRate'),
          rimFrequency: tend('rimFrequency'),
          shortMidFrequency: tend('shortMidFrequency'),
          longMidFrequency: tend('longMidFrequency'),
          cornerThreeFrequency: tend('cornerThreeFrequency'),
          aboveBreakThreeFrequency: tend('aboveBreakThreeFrequency'),
          threePointRate: tend('threePointRate'),
          freeThrowRate: tend('freeThrowRate'),
          turnoverRate: tend('turnoverRate'),
          isolationRate: tend('isolationRate'),
          pickAndRollBallHandlerRate: tend('pickAndRollBallHandlerRate'),
          pickAndRollRollManRate: tend('pickAndRollRollManRate'),
          spotUpRate: tend('spotUpRate'),
          transitionRate: tend('transitionRate'),
          cutRate: tend('cutRate'),
          foulRate: tend('foulRate'),
          stealAttemptRate: tend('stealAttemptRate'),
          blockAttemptRate: tend('blockAttemptRate'),
          crashOffensiveGlassRate: tend('crashOffensiveGlassRate'),
        },
      })),
    };
    console.log('ratings:', Object.values(team.players[0]!.ratings).join(','));
    const ctx = createEngineContext();
    const sums: Record<string, number> = {};
    const count = (key: string, value: number) => {
      sums[key] = (sums[key] ?? 0) + value;
    };
    const n = 300;
    for (let i = 0; i < n; i += 1) {
      const input: GameSimulationInput = {
        schemaVersion: 2,
        gameNumber: 1,
        seed: fixtureSeed('calibrate', i),
        dataVersion: profile.dataVersion,
        profile,
        home: team,
        away: team,
      };
      const r = simulateGame(input, ctx);
      const b = r.home.box;
      count('pts', b.points);
      count('fga', b.fieldGoals.attempted);
      count('fgm', b.fieldGoals.made);
      count('tpa', b.threes.attempted);
      count('tpm', b.threes.made);
      count('fta', b.freeThrows.attempted);
      count('ftm', b.freeThrows.made);
      count('tov', b.turnovers);
      count('poss', b.possessions);
      count('oreb', b.rebounds.offensive);
      count('dreb', b.rebounds.defensive);
      count('ast', b.assists);
      count('pf', b.fouls);
      for (const z of r.home.shotZones) {
        count(`zone.${z.zone}`, z.attempts);
        count(`make.${z.zone}`, z.makes);
      }
    }
    for (const [key, value] of Object.entries(sums)) {
      console.log(key, (value / n).toFixed(2));
    }
    console.log('fg%', (sums.fgm / sums.fga).toFixed(4));
    console.log('3p%', (sums.tpm / sums.tpa).toFixed(4));
    console.log('ft%', (sums.ftm / sums.fta).toFixed(4));
    console.log('ts%', (sums.pts / (2 * sums.poss)).toFixed(4));
    for (const z of ['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree']) {
      console.log(`zone ${z} pct`, `${(((sums[`make.${z}`] ?? 0) / Math.max(1, sums[`zone.${z}`] ?? 0)) * 100).toFixed(1)}%`);
    }
  });
});
