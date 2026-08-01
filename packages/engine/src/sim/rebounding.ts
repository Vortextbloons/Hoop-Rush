import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.js';
import { ENGINE_CONSTANTS } from './constants.js';

/**
 * Rebound resolution (spec/03 pipeline stage 7). Every live miss resolves to
 * an offensive or defensive player; declared dead-ball misses become team
 * rebounds. The era offensive-rebound rate anchors the base chance so equal
 * rebounding teams land on the packaged league rate.
 */

/** Team-average rating helper. */
export function teamMean(team: SimulationTeam, rating: keyof SimulationPlayer['ratings']): number {
  return team.players.reduce((sum, p) => sum + p.ratings[rating], 0) / team.players.length;
}

export interface ReboundResult {
  /** Whether the offense kept the ball (offensive rebound). */
  offensive: boolean;
  /** Whether the rebound was a declared dead-ball team rebound. */
  team: boolean;
}

/**
 * Probability an offensive rebound follows a miss at the zone, anchored to the
 * era rate at equal team rebounding.
 */
export function offensiveReboundProbability(
  offense: SimulationTeam,
  defense: SimulationTeam,
  zone: ShotZone,
  profile: EraSimulationProfile,
): number {
  const c = ENGINE_CONSTANTS;
  const off = teamMean(offense, 'offensiveRebound');
  const def = teamMean(defense, 'defensiveRebound');
  const ratio = (off - def) / c.offensiveReboundRange;
  const zoneAdjust =
    zone === 'rim' || zone === 'shortMid'
      ? c.offensiveReboundRimBonus
      : -c.offensiveReboundPerimeterPenalty;
  const base =
    profile.parameters.offensiveReboundRate + ratio * c.offensiveReboundScale + zoneAdjust;
  return Math.min(0.45, Math.max(0.12, base));
}

/**
 * Resolves the miss. `deadBall` marks buzzer misses that become team rebounds
 * (no live rebound could occur); all other misses are live.
 */
export function resolveRebound(
  rng: Rng,
  offense: SimulationTeam,
  defense: SimulationTeam,
  zone: ShotZone,
  profile: EraSimulationProfile,
  deadBall: boolean,
): ReboundResult {
  if (deadBall) return { offensive: false, team: true };
  const p = offensiveReboundProbability(offense, defense, zone, profile);
  if (rng.chance(p)) return { offensive: true, team: false };
  return { offensive: false, team: false };
}

/** The rebounder, weighted by the relevant rebound rating plus vertical reach. */
export function pickRebounder(
  team: SimulationTeam,
  offensive: boolean,
  rng: Rng,
): SimulationPlayer {
  const rating = offensive ? 'offensiveRebound' : 'defensiveRebound';
  return rng.weightedPick(
    team.players,
    team.players.map((p) => Math.max(0.5, p.ratings[rating] + p.ratings.vertical * 0.25)),
  );
}
