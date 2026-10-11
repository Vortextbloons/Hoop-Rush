import type {
  HavocAuthoritativeChannel,
  HavocShotKind,
  ShotZone,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { SideIndex } from './recorder.ts';
import type { ActionType } from './usage.ts';

/**
 * Absent-by-default Havoc runtime seam for the shared possession machinery.
 *
 * When `TripContext.havoc` is undefined every hook site takes the ordinary
 * path and consumes exactly the same RNG draws as before this file existed.
 * Only the Havoc controller supplies an implementation.
 */
export interface HavocEvidence {
  isAuthoritative(channel: HavocAuthoritativeChannel): boolean;
}

export interface HavocCoveragePlan {
  /** Contest penalty scale: 1 ordinary, 0.35 for an uncovered shooter. */
  contestScale: number;
  /** Signed probability delta added to the contest term (fractions). */
  contestPointDelta: number;
  /** Signed probability delta added to the make term (fractions). */
  makePointDelta: number;
  /** Signed probability delta added to block probability (fractions). */
  blockPointDelta: number;
}

export interface HavocShotPlan {
  /** Defender used for contest pressure and blocks. */
  defender: SimulationPlayer;
  /** Coverage/physical adjustments for this shot. */
  coverage: HavocCoveragePlan;
  shotKind: HavocShotKind;
  /** True when this attempt is an immediate own-rebound putback. */
  putback: boolean;
}

export interface HavocFoulResult {
  /** Ordinary attempts the shooter takes (1|2|3); includes And-One bonus. */
  freeThrowsAwarded: number;
  /** Number of trailing attempts among `freeThrowsAwarded` flagged bonus. */
  bonusAttempts: number;
  /** Extra technical attempts appended after the ordinary attempts. */
  technicalFreeThrows: number;
  /** Technical free throw is taken by the non-fouling side (offensive foul). */
  technicalForDefense: boolean;
}

export interface HavocRuntimeHooks {
  /** Runtime participant identity key (instance id), never a source id. */
  keyOf(player: SimulationPlayer): string;
  /** Base slot 0..4 used for position responsibilities (clones inherit). */
  responsibilitySlotOf(player: SimulationPlayer): number;
  /** Evidence flags for the blend-bypass of authoritative channels. */
  evidenceOf(player: SimulationPlayer): HavocEvidence | undefined;
  /** Individual rebounder weight multiplier (wingspan reach). */
  reboundWeightScale(player: SimulationPlayer): number;
  /** Additive reach contribution to team rebound strength. */
  reboundMeanReach(player: SimulationPlayer): number;
  /** Divisor for team aggregates (Havoc uses five, not the active count). */
  aggregateDivisor(): number;

  fullShotClock(side: SideIndex): number;
  reboundShotClock(side: SideIndex): number;
  onShotClockViolation(side: SideIndex, limitSeconds: number): void;

  /** Returns true when the runtime cancels this turnover (Possession Refund). */
  cancelTurnover(offense: SideIndex, handler: SimulationPlayer): boolean;
  onTurnover(offense: SideIndex, handler: SimulationPlayer, cancelled: boolean): void;
  onSteal(defense: SideIndex, stealer: SimulationPlayer): void;

  planShot(args: {
    offense: SideIndex;
    defense: SideIndex;
    shooter: SimulationPlayer;
    zone: ShotZone;
    action: ActionType;
    passed: boolean;
  }): HavocShotPlan;

  onFoul(args: {
    fouler: SimulationPlayer;
    foulerSide: SideIndex;
    offenseSide: SideIndex;
    shooter: SimulationPlayer | null;
    shooting: boolean;
    madeShot: boolean;
    inBonus: boolean;
    zone: ShotZone | null;
  }): HavocFoulResult;

  onFieldGoal(args: {
    offense: SideIndex;
    shooter: SimulationPlayer;
    made: boolean;
    three: boolean;
    passed: boolean;
    shotKind: HavocShotKind;
    putback: boolean;
    zone: ShotZone;
  }): void;

  onFreeThrow(args: {
    side: SideIndex;
    shooter: SimulationPlayer;
    made: boolean;
    bonus: boolean;
  }): void;

  onAssist(offense: SideIndex, assister: SimulationPlayer, scorer: SimulationPlayer): void;
  onRebound(side: SideIndex, rebounder: SimulationPlayer, offensive: boolean): void;
  onBlock(defense: SideIndex, blocker: SimulationPlayer, shooter: SimulationPlayer): void;
}
