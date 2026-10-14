import type {
  HavocAuthoritativeChannel,
  HavocShotKind,
  ShotZone,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { SideIndex } from './recorder.ts';
import type { ActionType } from './usage.ts';

export interface HavocEvidence {
  isAuthoritative(channel: HavocAuthoritativeChannel): boolean;
}

export interface HavocCoveragePlan {
  contestScale: number;
  contestPointDelta: number;
  makePointDelta: number;
  blockPointDelta: number;
}

export interface HavocShotPlan {
  defender: SimulationPlayer;
  coverage: HavocCoveragePlan;
  shotKind: HavocShotKind;
  putback: boolean;
}

export interface HavocFoulResult {
  freeThrowsAwarded: number;
  bonusAttempts: number;
  technicalFreeThrows: number;
  technicalForDefense: boolean;
  doubleOrNothingFreeThrows: number;
}

export interface HavocRuntimeHooks {
  keyOf(player: SimulationPlayer): string;
  responsibilitySlotOf(player: SimulationPlayer): number;
  evidenceOf(player: SimulationPlayer): HavocEvidence | undefined;
  reboundWeightScale(player: SimulationPlayer): number;
  reboundMeanReach(player: SimulationPlayer): number;
  aggregateDivisor(): number;

  fullShotClock(side: SideIndex): number;
  reboundShotClock(side: SideIndex): number;
  onShotClockViolation(side: SideIndex, limitSeconds: number): void;

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
