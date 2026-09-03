import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import type { PositionResponsibilityModifiers } from './position-responsibilities.ts';
export function teamMean(team: SimulationTeam, rating: keyof SimulationPlayer['ratings']): number {
  return (
    team.players.reduce((sum, p) => {
      const tendencyFactor =
        rating === 'offensiveRebound' ? 0.75 + p.tendencies.crashOffensiveGlassRate / 40 : 1;
      return sum + p.ratings[rating] * tendencyFactor;
    }, 0) / team.players.length
  );
}
export interface ReboundResult {
  offensive: boolean;
  team: boolean;
}
export function offensiveReboundProbability(
  offMean: number,
  defMean: number,
  zone: ShotZone,
  profile: EraSimulationProfile,
): number {
  const c = ENGINE_CONSTANTS;
  const ratio = (offMean - defMean) / c.offensiveReboundRange;
  const zoneAdjust =
    zone === 'rim' || zone === 'shortMid'
      ? c.offensiveReboundRimBonus
      : -c.offensiveReboundPerimeterPenalty;
  const base =
    profile.parameters.offensiveReboundRate + ratio * c.offensiveReboundScale + zoneAdjust;
  return Math.min(0.45, Math.max(0.12, base));
}
export function resolveRebound(
  rng: Rng,
  offMean: number,
  defMean: number,
  zone: ShotZone,
  profile: EraSimulationProfile,
  deadBall: boolean,
): ReboundResult {
  if (deadBall) return { offensive: false, team: true };
  const p = offensiveReboundProbability(offMean, defMean, zone, profile);
  if (rng.chance(p)) return { offensive: true, team: false };
  return { offensive: false, team: false };
}
export function rebounderWeights(
  team: SimulationTeam,
  offensive: boolean,
  positionModifiers?: ReadonlyMap<string, PositionResponsibilityModifiers>,
): number[] {
  const rating = offensive ? 'offensiveRebound' : 'defensiveRebound';
  return team.players.map((p) => {
    const historical = offensive
      ? (p.anchors?.offensiveReboundsPerGame ?? 0)
      : (p.anchors?.defensiveReboundsPerGame ?? 0);
    const heightContribution = p.heightInches === null ? 0 : Math.max(0, p.heightInches - 72) * 0.8;
    const weightContribution = p.weightLbs === null ? 0 : Math.max(0, p.weightLbs - 180) * 0.03;
    const responsibility = positionModifiers?.get(p.playerId)?.rebounding ?? 1;
    return (
      Math.max(
        0.5,
        p.ratings[rating] * (offensive ? 0.75 + p.tendencies.crashOffensiveGlassRate / 40 : 1) +
          p.ratings.vertical * 0.25 +
          historical * ENGINE_CONSTANTS.observedReboundWeight +
          heightContribution +
          weightContribution,
      ) * responsibility
    );
  });
}
export function pickRebounder(
  players: readonly SimulationPlayer[],
  weights: readonly number[],
  rng: Rng,
): SimulationPlayer {
  return rng.weightedPick(players, weights);
}
