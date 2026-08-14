import type {
  EraSimulationProfile,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from './constants.ts';
import {
  blendedZoneWeights,
  isThreePointZone,
  twoPointZoneSharesFromBlend,
  zoneSkillRating,
  type ActionType,
} from './usage.ts';

export interface ShotPrep {
  spacing: number;

  twoPointAnchor: number | null;
}

export function teamSpacing(team: SimulationTeam): number {
  return (
    team.players.reduce((sum, p) => {
      const skill = p.ratings.threePoint / 100;
      const volume = p.tendencies.threePointRate / 100;
      return sum + skill * (0.4 + 0.6 * volume);
    }, 0) / team.players.length
  );
}

export function shotQualityBonus(action: ActionType, zone: ShotZone): number {
  const table = (
    ENGINE_CONSTANTS.shotQuality as Partial<Record<ActionType, Partial<Record<ShotZone, number>>>>
  )[action];
  return table?.[zone] ?? 0;
}

export function contestPenalty(defender: SimulationPlayer, zone: ShotZone): number {
  let contest: number;
  if (zone === 'rim' || zone === 'shortMid') {
    contest =
      defender.ratings.interiorDefense * 0.6 +
      defender.ratings.defensiveIq * 0.25 +
      defender.ratings.strength * 0.15;
  } else if (zone === 'longMid') {
    contest =
      defender.ratings.interiorDefense * 0.35 +
      defender.ratings.perimeterDefense * 0.35 +
      defender.ratings.defensiveIq * 0.3;
  } else {
    contest = defender.ratings.perimeterDefense * 0.6 + defender.ratings.defensiveIq * 0.4;
  }
  const ratio = Math.min(
    1,
    Math.max(
      ENGINE_CONSTANTS.contestMin / ENGINE_CONSTANTS.contestMax,
      (contest - ENGINE_CONSTANTS.contestRatioPivot) / ENGINE_CONSTANTS.contestRatioRange,
    ),
  );
  return ratio * ENGINE_CONSTANTS.contestMax;
}

export function observedTwoPointPct(shooter: SimulationPlayer): number | null {
  const anchors = shooter.anchors;
  if (!anchors) return null;
  const reconstructed = shooter.reconstructedThreePoint;
  const threeRate = anchors.threePointAttemptRate ?? reconstructed?.attemptRateConservative ?? null;
  if (threeRate === null) return null;
  const twoShare = 1 - threeRate;
  if (twoShare < 1e-6) return null;
  const threePct =
    anchors.threePointPct ?? reconstructed?.accuracyConservative ?? anchors.fieldGoalPct;
  const twoPct = (anchors.fieldGoalPct - threeRate * threePct) / twoShare;
  return Math.min(0.62, Math.max(0.32, twoPct));
}

export function twoPointAnchorFactor(
  shooter: SimulationPlayer,
  profile: EraSimulationProfile,
  blend: readonly number[] = blendedZoneWeights(shooter, profile),
): number | null {
  const observed = observedTwoPointPct(shooter);
  if (observed === null) return null;
  const shares = twoPointZoneSharesFromBlend(blend);
  const bases = [
    ENGINE_CONSTANTS.zoneBaseMake.rim,
    ENGINE_CONSTANTS.zoneBaseMake.shortMid,
    ENGINE_CONSTANTS.zoneBaseMake.longMid,
  ];
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < shares.length; i += 1) {
    const share = shares[i] ?? 0;
    weighted += share * (bases[i] ?? 0);
    total += share;
  }
  if (total <= 0) return null;
  const expected = weighted / total;
  if (expected <= 0) return null;
  const factor = observed / expected;
  return Math.min(
    ENGINE_CONSTANTS.twoPointAnchorMax,
    Math.max(ENGINE_CONSTANTS.twoPointAnchorMin, factor),
  );
}

export function blockProbability(
  defender: SimulationPlayer,
  zone: ShotZone,
  action: ActionType,
): number {
  const c = ENGINE_CONSTANTS;
  const anchors = defender.anchors;
  const per48 =
    anchors && anchors.minutesPerGame > 0
      ? (anchors.blocksPerGame / anchors.minutesPerGame) * 48
      : 0;
  const anchorBonus =
    per48 > c.blockAnchorFloorPer48
      ? Math.min(c.blockAnchorMax, (per48 - c.blockAnchorFloorPer48) * c.blockAnchorScale)
      : 0;
  const attemptFactor = 0.75 + Math.min(20, defender.tendencies.blockAttemptRate) / 40;
  if (zone === 'rim') {
    const base = Math.min(
      c.blockRimMax,
      Math.max(0, ((defender.ratings.block - 40) / 60) * c.blockRimMax),
    );
    return Math.min(
      c.blockRimMax + c.blockDriveBonus + c.blockAnchorMax,
      (base +
        (action === 'isolation' || action === 'pickAndRoll' ? c.blockDriveBonus : 0) +
        anchorBonus) *
        attemptFactor,
    );
  }
  if (zone === 'shortMid') {
    return Math.min(
      c.blockMidMax,
      (Math.max(0, ((defender.ratings.block - 50) / 50) * c.blockMidMax) + anchorBonus * 0.5) *
        attemptFactor,
    );
  }
  return Math.min(
    c.blockThreeMax,
    Math.max(0, ((defender.ratings.perimeterDefense - 60) / 40) * c.blockThreeMax) * attemptFactor,
  );
}

export function makeProbability(
  shooter: SimulationPlayer,
  defender: SimulationPlayer,
  profile: EraSimulationProfile,
  zone: ShotZone,
  action: ActionType,
  periodSecondsRemaining: number,
  prep: ShotPrep,
  homeCourtAdjustment = 0,
  effectsAdjustment = 0,
): number {
  const threePointZone = isThreePointZone(zone);
  const reconstructed = threePointZone ? shooter.reconstructedThreePoint : undefined;
  const hasReconstructed = reconstructed !== undefined;
  const observedThreePointPct = threePointZone ? shooter.anchors?.threePointPct : null;
  const hasObservedThree = observedThreePointPct !== null && observedThreePointPct !== undefined;
  const twoAnchor = threePointZone ? null : prep.twoPointAnchor;
  const anchoredTwo = twoAnchor !== null;
  const base = threePointZone
    ? hasObservedThree
      ? observedThreePointPct * ENGINE_CONSTANTS.observedThreePointBlend +
        profile.targets.threePointPct.value * (1 - ENGINE_CONSTANTS.observedThreePointBlend)
      : hasReconstructed
        ? reconstructed.accuracyConservative
        : ENGINE_CONSTANTS.zoneBaseMake[zone]
    : ENGINE_CONSTANTS.zoneBaseMake[zone] * (twoAnchor ?? 1);
  const skill = threePointZone
    ? hasObservedThree
      ? ((zoneSkillRating(shooter, zone) - 70) / 100) *
        ENGINE_CONSTANTS.anchoredThreePointSkillRange
      : hasReconstructed
        ? 0
        : ((zoneSkillRating(shooter, zone) - 70) / 30) * ENGINE_CONSTANTS.skillRange
    : ((zoneSkillRating(shooter, zone) - 70) / 30) *
      ENGINE_CONSTANTS.skillRange *
      (anchoredTwo ? ENGINE_CONSTANTS.twoPointAnchorSkillScale : 1);
  const contest = -contestPenalty(defender, zone);
  const era =
    anchoredTwo || hasObservedThree || hasReconstructed
      ? 0
      : (profile.parameters.leagueTsPct - 0.55) * ENGINE_CONSTANTS.eraEfficiencyWeight;

  const spacing = threePointZone ? 0 : (prep.spacing - 0.5) * ENGINE_CONSTANTS.spacingBonusScale;
  const quality = threePointZone ? 0 : shotQualityBonus(action, zone);
  const latePenalty =
    periodSecondsRemaining <= 4
      ? -(0.04 + Math.min(1, Math.max(0, (4 - periodSecondsRemaining) / 4)) * 0.06)
      : 0;
  const calibration = threePointZone ? ENGINE_CONSTANTS.threePointCalibrationOffset : 0;
  const raw =
    base +
    skill +
    contest +
    era +
    spacing +
    quality +
    latePenalty +
    calibration +
    homeCourtAdjustment +
    effectsAdjustment;

  const floor =
    threePointZone && hasReconstructed
      ? zone === 'cornerThree'
        ? reconstructed.zoneFloors.cornerThree
        : reconstructed.zoneFloors.aboveBreakThree
      : ENGINE_CONSTANTS.zoneMakeFloor[zone];
  return Math.min(0.97, Math.max(floor, Math.max(0.03, raw)));
}
