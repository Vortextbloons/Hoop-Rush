import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import type { HavocEvidence } from './havoc-runtime.ts';
import { ENGINE_CONSTANTS, type PositionResponsibilityModifiers } from './constants.ts';
export function teamMean(
  team: SimulationTeam,
  rating: keyof SimulationPlayer['ratings'],
  options?: {
    reachOf?: (player: SimulationPlayer) => number;
    divisor?: number;
  },
): number {
  const divisor = options?.divisor ?? team.players.length;
  return (
    team.players.reduce((sum, p) => {
      const tendencyFactor =
        rating === 'offensiveRebound' ? 0.75 + p.tendencies.crashOffensiveGlassRate / 40 : 1;
      const contribution = p.ratings[rating] * tendencyFactor;
      const reach = options?.reachOf?.(p) ?? 0;
      return sum + (reach === 0 ? contribution : Math.max(0, contribution + reach));
    }, 0) / Math.max(1e-9, divisor)
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
  keyOf: (player: SimulationPlayer) => string = (player) => player.playerId,
  evidenceOf?: (player: SimulationPlayer) => HavocEvidence | undefined,
  weightScale?: (player: SimulationPlayer) => number,
): number[] {
  const rating = offensive ? 'offensiveRebound' : 'defensiveRebound';
  return team.players.map((p) => {
    const authoritative = evidenceOf?.(p)?.isAuthoritative('rebound-weights') ?? false;
    const historical = authoritative
      ? 0
      : offensive
        ? (p.anchors?.offensiveReboundsPerGame ?? 0)
        : (p.anchors?.defensiveReboundsPerGame ?? 0);
    const heightContribution = p.heightInches === null ? 0 : Math.max(0, p.heightInches - 72) * 0.8;
    const weightContribution = p.weightLbs === null ? 0 : Math.max(0, p.weightLbs - 180) * 0.03;
    const responsibility =
      positionModifiers?.get(keyOf(p))?.rebounding ??
      positionModifiers?.get(p.playerId)?.rebounding ??
      1;
    const scale = weightScale?.(p) ?? 1;
    return (
      Math.max(
        0.5,
        p.ratings[rating] * (offensive ? 0.75 + p.tendencies.crashOffensiveGlassRate / 40 : 1) +
          p.ratings.vertical * 0.25 +
          historical * ENGINE_CONSTANTS.observedReboundWeight +
          heightContribution +
          weightContribution,
      ) *
      responsibility *
      scale
    );
  });
}
