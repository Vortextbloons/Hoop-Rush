import { describe, expect, it } from 'vitest';
import {
  SEASON_ALIGNMENT,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { ALL_FRANCHISES } from './block-test-support.ts';
describe('canonical alignment parity', () => {
  it('ALL_FRANCHISES covers the canonical set exactly once', () => {
    const canonical = SEASON_ALIGNMENT.map((entry) => entry.franchiseId);
    expect(ALL_FRANCHISES).toHaveLength(canonical.length);
    expect(new Set(ALL_FRANCHISES).size).toBe(canonical.length);
    expect([...ALL_FRANCHISES].sort()).toEqual([...canonical].sort());
  });
  it('ALL_FRANCHISES order is frozen east-then-west', () => {
    const conferences = ALL_FRANCHISES.map((franchiseId) => {
      const entry = SEASON_ALIGNMENT.find((candidate) => candidate.franchiseId === franchiseId);
      if (entry === undefined) throw new Error(`no alignment for ${franchiseId}`);
      return entry.conference;
    });
    const firstWest = conferences.findIndex((conference) => conference === 'west');
    expect(firstWest).toBe(15);
    expect(conferences.slice(firstWest).every((conference) => conference === 'west')).toBe(true);
  });
  it('the fixture league derives its teams from the canonical alignment', () => {
    const league = buildSeasonLeague();
    expect(league.teams.map((team) => team.franchiseId)).toEqual([
      ...SEASON_ALIGNMENT.map((entry) => entry.franchiseId),
    ]);
  });
  it('sim fixture ratings and tendencies match the canonical constants', () => {
    const player = buildSimulationPlayer();
    expect(player.ratings).toEqual(SIMULATION_RATINGS);
    expect(player.tendencies).toEqual(SIMULATION_TENDENCIES);
  });
});
