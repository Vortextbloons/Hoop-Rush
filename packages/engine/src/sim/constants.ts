import type { ShotZone } from '@hoop-rush/data-contracts';

/**
 * Frozen possession-engine constants (spec/03). Every value is a deliberate
 * basketball rule; era-level context (pace, efficiency, shot mix, turnover and
 * foul rates) comes from the versioned era simulation profile, never from
 * hidden difficulty modifiers. Constants change only through a versioned
 * engine bump accompanied by a calibration report.
 */

export const ENGINE_VERSION = 'm3-engine-v4';

export const ENGINE_CONSTANTS = {
  version: ENGINE_VERSION,

  /** Base make probability by zone before any player or era adjustment. */
  zoneBaseMake: {
    rim: 0.67,
    shortMid: 0.46,
    longMid: 0.44,
    cornerThree: 0.52,
    aboveBreakThree: 0.49,
  } as const satisfies Record<ShotZone, number>,

  /**
   * Player skill deviates make chance by at most this much around the 70
   * anchor. Calibrated down from 0.18 so lineup-strength gaps do not turn
   * into guaranteed winners: elite teams still shoot better, but plausible
   * upsets survive.
   */
  skillRange: 0.12,
  /**
   * Defensive contest can reduce make chance by at most this much. Sized
   * with skillRange so contests compress blowouts without silencing
   * perimeter-defense sensitivity.
   */
  contestMax: 0.15,
  /** Era efficiency anchor blends league TS% into the final make chance. */
  eraEfficiencyWeight: 0.35,

  /**
   * Turnover probability coefficients around the era turnover-per-possession
   * baseline (security.ts). A handler at the documented neutral reference
   * (tendency 0.12, team pressure 0.62, handling offset 0.4, passing offset
   * 0.2) converts at the era rate; deviations move the probability in bounded
   * steps. These neutral references match the packaged pool population means.
   */
  turnoverNeutralTendency: 0.12,
  turnoverNeutralPressure: 0.62,
  turnoverNeutralHandling: 0.4,
  turnoverNeutralPassing: 0.2,
  turnoverTendencyWeight: 0.18,
  turnoverPressureWeight: 0.18,
  turnoverHandlingWeight: 0.06,
  turnoverPassingWeight: 0.03,
  turnoverMin: 0.03,
  turnoverMax: 0.3,

  /** Block probability coefficients by zone (V1 possessionEngine, revalidated). */
  blockRimMax: 0.14,
  blockMidMax: 0.07,
  blockThreeMax: 0.04,
  blockDriveBonus: 0.03,

  /**
   * Shooting-foul calibration scale: the zone/position/discipline modifiers
   * drag the raw foulsPerPossession rate below the league value, so the base
   * is scaled to restore the league average at population-mean inputs.
   */
  shootingFoulScale: 1.3,
  /** Fouled shots convert less often: contact lowers the make chance. */
  fouledShotMakeScale: 0.75,

  /** Free-throw conversion anchor: a 75 rating converts at leagueFtPct. */
  freeThrowAnchorRating: 75,

  /** Non-shooting fouls in the bonus award two free throws from this team-foul count. */
  bonusFoulsRegulation: 5,
  bonusFoulsOvertime: 2,
  /** Free throws consume this many seconds of game clock each. */
  secondsPerFreeThrow: 3,
  /** A trip may not take longer than the shot clock. */
  shotClockSeconds: 24,
  /** Minimum sampled trip duration, in seconds. */
  minimumTripSeconds: 1,
  /** A possession may start with this many seconds remaining at the earliest. */
  minimumStartSeconds: 0.5,

  /** Player-level three-point volume boost from the threePointRate tendency. */
  threePointRateWeight: 0.35,
  /** Blend of era zone mix into player shot-mix selection. */
  eraZoneMixBlend: 0.55,
  /** Base-trip allowance reserved for fouls and free throws charged afterward. */
  paceDeadBallAdjustment: 0.75,
  /** How strongly observed three-point percentage anchors the shot result. */
  observedThreePointBlend: 0.7,
  /** How strongly observed free-throw percentage anchors the shot result. */
  observedFreeThrowBlend: 0.8,

  /**
   * Three-point volume evidence gates (usage.ts pickZone). A player with no
   * recorded three-point attempts never takes threes; players with very low
   * observed volume receive a tightly capped rate; era-wide three-point
   * growth applies only to players with meaningful shooting evidence.
   */
  /** Observed 3PA/FGA below this means the player never shoots threes. */
  threePointEvidenceMinimum: 0.02,
  /** Observed 3PA/FGA below this is "very low volume" (tight cap, weak era pull). */
  threePointLowVolumeThreshold: 0.06,
  /** Hard cap on the three-point rate for very-low-volume players. */
  threePointLowVolumeCap: 0.08,
  /** Era pull for very-low-volume players with some shooting evidence. */
  threePointLowVolumeEraPull: 0.05,
  /** Era pull for players with established three-point volume. */
  threePointEraPull: 0.3,

  /**
   * Usage hierarchy (usage.ts). The initiation exponent is soft (1.1 instead
   * of 1.5) so a high-usage star concentrates possession starts without
   * monopolizing every possession class.
   */
  usageExponent: 1.1,

  /**
   * Two-point efficiency anchor (shooting.ts). The player's observed
   * two-point percentage is a soft prior scaled against the expected
   * zone-base conversion for their shot mix; the factor is clamped so shot
   * zone, defender quality, spacing, and shot quality stay meaningful.
   */
  twoPointAnchorMin: 0.82,
  twoPointAnchorMax: 1.18,
  /** Residual zone-skill term for anchored two-point shots. */
  twoPointAnchorSkillScale: 0.3,

  /**
   * Shot-quality bonuses by action and zone (two-point shots only). These
   * translate play-type reality into conversion: transition and cut finishes
   * convert better than isolation pull-ups. Bounded so skill and contest stay
   * dominant.
   */
  shotQuality: {
    transition: { rim: 0.03, shortMid: 0.02 },
    cut: { rim: 0.03 },
    pickAndRollRoll: { rim: 0.02 },
    pickAndRoll: { rim: 0.01 },
    postUp: { rim: -0.005, shortMid: -0.005 },
    isolation: { longMid: -0.01, shortMid: -0.005 },
  } as const,
  /**
   * Lineup spacing moves two-point conversion by at most this much per unit
   * of team spacing above/below 0.5 (see shooting.ts teamSpacing). Softened
   * from 0.12 so spacing stays a lineup lever without inflating blowouts.
   */
  spacingBonusScale: 0.09,

  /** Rebounds: offensive rebound probability coefficient around team ratings. */
  offensiveReboundScale: 0.05,
  offensiveReboundRange: 50,
  offensiveReboundRimBonus: 0.04,
  offensiveReboundPerimeterPenalty: 0.04,
  /** Weight of observed per-game rebound production in player attribution. */
  observedReboundWeight: 6,

  /** Blocked shots resolve as misses; this chance a block also records the shot as made-free. */
  blockedShotMiss: true,
} as const;
