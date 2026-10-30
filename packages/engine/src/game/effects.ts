import type { SideIndex } from '../sim/recorder.ts';

export interface EffectsTripFacts {
  homeUnit: readonly string[];
  awayUnit: readonly string[];
  handler: string;
  shooter?: string;
  defender?: string;
  reboundContestCounts: readonly [number, number];
}

export interface EffectsHook {
  makeAdjustment(facts: {
    shooterVersion: string;
    offenseSide: SideIndex;
    defenseSide: SideIndex;
  }): number;
  turnoverAdjustment(facts: { handlerVersion: string; offenseSide: SideIndex }): number;
  assistAdjustment(facts: { offenseSide: SideIndex }): number;
  setActiveUnits(homeUnit: readonly string[], awayUnit: readonly string[]): void;
  recordStintSeconds(side: SideIndex, seconds: number, activeVersions: readonly string[]): void;
  recordTrip(facts: EffectsTripFacts): void;
  halftime(): void;
}
