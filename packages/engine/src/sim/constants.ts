import type { ShotZone } from '@hoop-rush/data-contracts';

/**
 * Frozen possession-engine constants (spec/03). Every value is a deliberate
 * basketball rule; era-level context (pace, efficiency, shot mix, turnover and
 * foul rates) comes from the versioned era simulation profile, never from
 * hidden difficulty modifiers. Constants change only through a versioned
 * engine bump accompanied by a calibration report.
 */

export const ENGINE_VERSION = 'm2-engine-v1';

export const ENGINE_CONSTANTS = {
  version: ENGINE_VERSION,

  /** Base make probability by zone before any player or era adjustment. */
  zoneBaseMake: {
    rim: 0.66,
    shortMid: 0.45,
    longMid: 0.43,
    cornerThree: 0.48,
    aboveBreakThree: 0.45,
  } as const satisfies Record<ShotZone, number>,

  /** Player skill deviates make chance by at most this much around the 70 anchor. */
  skillRange: 0.18,
  /** Defensive contest can reduce make chance by at most this much. */
  contestMax: 0.18,
  /** Era efficiency anchor blends league TS% into the final make chance. */
  eraEfficiencyWeight: 0.35,

  /** Turnover probability coefficients (V1 turnoverModel, revalidated). */
  turnoverBase: 0.038,
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
  shootingFoulScale: 1.45,
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
  threePointRateWeight: 0.5,
  /** Blend of league 3PA rate into player shot-mix selection. */
  eraThreePointBlend: 0.7,

  /** Rebounds: offensive rebound probability coefficient around team ratings. */
  offensiveReboundScale: 0.05,
  offensiveReboundRange: 50,
  offensiveReboundRimBonus: 0.04,
  offensiveReboundPerimeterPenalty: 0.04,

  /** Blocked shots resolve as misses; this chance a block also records the shot as made-free. */
  blockedShotMiss: true,
} as const;
