import {
  SEASON_COURT_INNOVATION_VERSION,
  seasonDigestHex,
  type EraSimulationProfile,
  type ProjectionLedger,
  type SeasonCourtInnovationId,
  type SeasonGameRule,
  type SimulationPlayer,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import { meanTripSeconds } from '../sim/timing.ts';
import { shootingFoulProbability } from '../sim/fouls.ts';
import { prepareTeam } from '../sim/prepare.ts';
import {
  DEEP_FOUR_MAKE_SCALE,
  DEEP_FOUR_SPLIT,
  FIRST_TO_SEVEN_TARGET,
  TWENTY_SECOND_CLOCK,
  TWENTY_SECOND_LATE_PRESSURE,
  TWENTY_SECOND_LATE_WINDOW,
  twentySecondClockPressure,
} from '../sim/evolution-rules.ts';
import { projectExpectedLedger } from './expected-ledger.ts';

export const EVOLUTION_PROJECTION_ADAPTER_VERSION = SEASON_COURT_INNOVATION_VERSION;

export interface DeepFourAdjustment {
  deepAttempts: number;
  deepMakes: number;
  pointsDelta: number;
  threePointAttemptsDelta: number;
  threePointMakesDelta: number;
  freeThrowAttemptsDelta: number;
  freeThrowMakesDelta: number;
  foulShare: number;
  facts: Record<string, number>;
}

export function adjustLedgerForDeepFour(input: {
  ledger: ProjectionLedger;
  aboveBreakShareOfThrees: number;
  unit: readonly SimulationPlayer[];
  opponent: readonly SimulationPlayer[];
  profile: EraSimulationProfile;
}): DeepFourAdjustment {
  const { ledger, aboveBreakShareOfThrees, unit, opponent, profile } = input;
  const moved = ledger.threePointAttempts * aboveBreakShareOfThrees * DEEP_FOUR_SPLIT;
  if (moved <= 0) {
    return {
      deepAttempts: 0,
      deepMakes: 0,
      pointsDelta: 0,
      threePointAttemptsDelta: 0,
      threePointMakesDelta: 0,
      freeThrowAttemptsDelta: 0,
      freeThrowMakesDelta: 0,
      foulShare: 0,
      facts: { movedAttempts: 0 },
    };
  }
  const usageTotal = unit.reduce((sum, p) => sum + Math.max(0.5, p.tendencies.usageRate), 0);
  let foulShare = 0;
  for (const shooter of unit) {
    const usageWeight = Math.max(0.5, shooter.tendencies.usageRate) / Math.max(1e-9, usageTotal);
    let defenderMean = 0;
    for (const defender of opponent) {
      defenderMean += shootingFoulProbability(shooter, defender, 'aboveBreakThree', profile);
    }
    defenderMean /= Math.max(1, opponent.length);
    foulShare += usageWeight * defenderMean;
  }
  foulShare = Math.min(0.25, Math.max(0, foulShare));
  const threePct = ledger.threePointPct;
  const freeThrowPct =
    ledger.freeThrowAttempts > 0 ? ledger.freeThrowMakes / ledger.freeThrowAttempts : 0.75;
  const deepMakeP = threePct * DEEP_FOUR_MAKE_SCALE;
  const fouledDeepMakeP = Math.min(0.97, deepMakeP * 0.95);
  const fouledThreeMakeP = Math.min(0.97, threePct * 0.95);
  const fouled = moved * foulShare;
  const clean = moved - fouled;
  const deepMakes = clean * deepMakeP + fouled * fouledDeepMakeP;
  const oldMakes = clean * threePct + fouled * fouledThreeMakeP;
  const oldPoints =
    clean * threePct * 3 +
    fouled * fouledThreeMakeP * 3 +
    (fouled * fouledThreeMakeP * 1 + fouled * (1 - fouledThreeMakeP) * 3) * freeThrowPct;
  const newPoints =
    clean * deepMakeP * 4 +
    fouled * fouledDeepMakeP * 4 +
    (fouled * fouledDeepMakeP * 1 + fouled * (1 - fouledDeepMakeP) * 4) * freeThrowPct;
  const oldFreeThrows = fouled * fouledThreeMakeP * 1 + fouled * (1 - fouledThreeMakeP) * 3;
  const newFreeThrows = fouled * fouledDeepMakeP * 1 + fouled * (1 - fouledDeepMakeP) * 4;
  return {
    deepAttempts: moved,
    deepMakes,
    pointsDelta: newPoints - oldPoints,
    threePointAttemptsDelta: -moved,
    threePointMakesDelta: -oldMakes,
    freeThrowAttemptsDelta: newFreeThrows - oldFreeThrows,
    freeThrowMakesDelta: (newFreeThrows - oldFreeThrows) * freeThrowPct,
    foulShare,
    facts: {
      movedAttempts: moved,
      aboveBreakShareOfThrees: aboveBreakShareOfThrees,
      deepMakeProbability: deepMakeP,
      foulShare,
    },
  };
}

export interface TwentySecondAdjustment {
  violationsPer100: number;
  turnoversDelta: number;
  makeMultiplier: number;
  pointsDelta: number;
  facts: Record<string, number>;
}

export function twentySecondViolationRate(meanTrip: number): number {
  const lo = meanTrip * 0.6;
  const hi = meanTrip * 1.4;
  if (hi <= TWENTY_SECOND_CLOCK) return 0;
  if (lo >= TWENTY_SECOND_CLOCK) return 1;
  return (hi - TWENTY_SECOND_CLOCK) / Math.max(1e-9, hi - lo);
}

export function twentySecondExpectedMultiplier(meanTrip: number): number {
  const lo = Math.max(1, (meanTrip * 0.6 * TWENTY_SECOND_CLOCK) / 24);
  const hi = (meanTrip * 1.4 * TWENTY_SECOND_CLOCK) / 24;
  const top = Math.min(hi, TWENTY_SECOND_CLOCK);
  if (top <= lo) return twentySecondClockPressure(top);
  const lateStart = Math.max(lo, TWENTY_SECOND_CLOCK - TWENTY_SECOND_LATE_WINDOW);
  if (top <= lateStart) return 1;
  const fullWeight = Math.max(0, lateStart - lo);
  const lateWeight = top - lateStart;
  let lateMean = 1;
  if (lateWeight > 0) {
    const a = TWENTY_SECOND_CLOCK - top;
    const b = TWENTY_SECOND_CLOCK - lateStart;
    const meanRemaining = (a + b) / 2;
    lateMean = 1 - TWENTY_SECOND_LATE_PRESSURE * (1 - meanRemaining / TWENTY_SECOND_LATE_WINDOW);
  }
  return (fullWeight * 1 + lateWeight * lateMean) / Math.max(1e-9, top - lo);
}

export function adjustLedgerForTwentySecondClock(input: {
  ledger: ProjectionLedger;
  profile: EraSimulationProfile;
}): TwentySecondAdjustment {
  const meanTrip = meanTripSeconds(input.profile);
  const ledger = input.ledger;
  const violationRate = twentySecondViolationRate(meanTrip);
  const violationsPer100 = 100 * violationRate;
  const makeMultiplier = twentySecondExpectedMultiplier(meanTrip);
  const twoMakes = ledger.fieldGoalMakes - ledger.threePointMakes;
  const pointsPerMake =
    ledger.fieldGoalMakes > 0
      ? (2 * twoMakes + 3 * ledger.threePointMakes) / ledger.fieldGoalMakes
      : 2.2;
  const pointsDelta = ledger.fieldGoalMakes * (makeMultiplier - 1) * pointsPerMake;
  return {
    violationsPer100,
    turnoversDelta: violationsPer100,
    makeMultiplier,
    pointsDelta,
    facts: {
      meanTripSeconds: meanTrip,
      violationRate,
      makeMultiplier,
      lateShare: Math.max(
        0,
        Math.min(
          1,
          ((meanTrip * 1.4 * TWENTY_SECOND_CLOCK) / 24 -
            (TWENTY_SECOND_CLOCK - TWENTY_SECOND_LATE_WINDOW)) /
            Math.max(1e-9, meanTrip * 0.8 * (TWENTY_SECOND_CLOCK / 24)),
        ),
      ),
    },
  };
}

export interface PossessionScoring {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export function scoringDistributionOf(ledger: ProjectionLedger): PossessionScoring {
  const p3 = Math.min(0.9, ledger.threePointMakes / 100);
  const p2 = Math.min(0.9, Math.max(0, ledger.fieldGoalMakes - ledger.threePointMakes) / 100);
  const p1 = Math.min(0.9, Math.max(0, ledger.freeThrowMakes - ledger.fieldGoalMakes * 0.2) / 100);
  const p0 = Math.max(0, 1 - p1 - p2 - p3);
  return { p0, p1, p2, p3 };
}

export interface FirstToSevenEstimate {
  homeWinProb: number;
  expectedPossessions: number;
  target: typeof FIRST_TO_SEVEN_TARGET;
}

export function estimateFirstToSevenRace(
  home: PossessionScoring,
  away: PossessionScoring,
): FirstToSevenEstimate {
  const maxSweeps = 5000;
  const size = FIRST_TO_SEVEN_TARGET;
  const win: number[][][] = [];
  const length: number[][][] = [];
  for (let i = 0; i < size; i += 1) {
    win.push([[0.5], [0.5]]);
    length.push([[0], [0]]);
  }
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      (win[i] as number[][])[j] = [0.5, 0.5];
      (length[i] as number[][])[j] = [20, 20];
    }
  }
  const dist = [home, away];
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let maxWinDelta = 0;
    let maxLengthDelta = 0;
    for (let total = 2 * (size - 1); total >= 0; total -= 1) {
      for (let i = Math.min(size - 1, total); i >= 0; i -= 1) {
        const j = total - i;
        if (j < 0 || j >= size) continue;
        for (let side = 0; side < 2; side += 1) {
          const scoring = dist[side] ?? { p0: 1, p1: 0, p2: 0, p3: 0 };
          const nextSide = 1 - side;
          let winValue = 0;
          let lengthValue = 1;
          const outcomes: Array<[number, number]> = [
            [0, scoring.p0],
            [1, scoring.p1],
            [2, scoring.p2],
            [3, scoring.p3],
          ];
          for (const [points, probability] of outcomes) {
            if (probability <= 0) continue;
            const ni = side === 0 ? i + points : i;
            const nj = side === 1 ? j + points : j;
            if (ni >= size && nj >= size) {
              winValue += probability * (ni > nj ? 1 : nj > ni ? 0 : 0.5);
              lengthValue += probability * 0;
            } else if (ni >= size) {
              winValue += probability * 1;
            } else if (nj >= size) {
              winValue += probability * 0;
            } else {
              const nextWin = (win[ni] as number[][])[nj]?.[nextSide] ?? 0.5;
              const nextLength = (length[ni] as number[][])[nj]?.[nextSide] ?? 0;
              winValue += probability * nextWin;
              lengthValue += probability * nextLength;
            }
          }
          const currentWin = (win[i] as number[][])[j]?.[side] ?? 0.5;
          const currentLength = (length[i] as number[][])[j]?.[side] ?? 0;
          maxWinDelta = Math.max(maxWinDelta, Math.abs(winValue - currentWin));
          maxLengthDelta = Math.max(maxLengthDelta, Math.abs(lengthValue - currentLength));
          const targetWin = (win[i] as number[][])[j];
          if (targetWin !== undefined) targetWin[side] = winValue;
          const targetLength = (length[i] as number[][])[j];
          if (targetLength !== undefined) targetLength[side] = lengthValue;
        }
      }
    }
    if (maxWinDelta < 1e-12 && maxLengthDelta < 1e-9) break;
  }
  const homeWinProb =
    (((win[0] as number[][])[0]?.[0] ?? 0.5) + ((win[0] as number[][])[0]?.[1] ?? 0.5)) / 2;
  const expectedPossessions =
    (((length[0] as number[][])[0]?.[0] ?? 0) + ((length[0] as number[][])[0]?.[1] ?? 0)) / 2;
  return { homeWinProb, expectedPossessions, target: FIRST_TO_SEVEN_TARGET };
}

export interface RuleGameProjection {
  rule: SeasonGameRule;
  adapterVersion: typeof EVOLUTION_PROJECTION_ADAPTER_VERSION;
  homePointsPer100: number;
  awayPointsPer100: number;
  homeWinProb: number;
  inputDigest: string;
  overtime:
    | { kind: 'timed' }
    | { kind: 'first-to-seven'; homeWinProb: number; expectedPossessions: number };
  facts: Record<string, number>;
}

export function winProbabilityFromDiff(diffPointsPer100: number): number {
  return 1 / (1 + Math.exp(-diffPointsPer100 / 10));
}

export function projectGameWithRule(input: {
  homeUnit: readonly SimulationPlayer[];
  awayUnit: readonly SimulationPlayer[];
  profile: EraSimulationProfile;
  rule: SeasonGameRule;
}): RuleGameProjection {
  const homeTeam: SimulationTeam = {
    teamId: 'projection-home',
    displayName: 'Projection Home',
    players: [...input.homeUnit],
  };
  const awayTeam: SimulationTeam = {
    teamId: 'projection-away',
    displayName: 'Projection Away',
    players: [...input.awayUnit],
  };
  const homePrep = prepareTeam(homeTeam, input.profile);
  const awayPrep = prepareTeam(awayTeam, input.profile);
  const ledger = projectExpectedLedger({
    team: homeTeam,
    prep: homePrep,
    opponent: awayTeam,
    opponentPrep: awayPrep,
    profile: input.profile,
  });
  let homePoints = ledger.offense.ledger.points;
  let awayPoints = ledger.defense.ledger.points;
  const facts: Record<string, number> = {};
  let overtime: RuleGameProjection['overtime'] = { kind: 'timed' };
  if (input.rule === 'deep-four') {
    const zones = ledger.offense.zones;
    const threeZone = zones.cornerThree + zones.aboveBreakThree;
    const abShare = threeZone > 0 ? zones.aboveBreakThree / threeZone : 0;
    const homeAdjust = adjustLedgerForDeepFour({
      ledger: ledger.offense.ledger,
      aboveBreakShareOfThrees: abShare,
      unit: input.homeUnit,
      opponent: input.awayUnit,
      profile: input.profile,
    });
    const awayZones = ledger.defense.zones;
    const awayThreeZone = awayZones.cornerThree + awayZones.aboveBreakThree;
    const awayAbShare = awayThreeZone > 0 ? awayZones.aboveBreakThree / awayThreeZone : 0;
    const awayAdjust = adjustLedgerForDeepFour({
      ledger: ledger.defense.ledger,
      aboveBreakShareOfThrees: awayAbShare,
      unit: input.awayUnit,
      opponent: input.homeUnit,
      profile: input.profile,
    });
    homePoints += homeAdjust.pointsDelta;
    awayPoints += awayAdjust.pointsDelta;
    facts['homeDeepAttempts'] = homeAdjust.deepAttempts;
    facts['homeDeepMakes'] = homeAdjust.deepMakes;
    facts['awayDeepAttempts'] = awayAdjust.deepAttempts;
    facts['awayDeepMakes'] = awayAdjust.deepMakes;
  } else if (input.rule === 'twenty-second-clock') {
    const homeAdjust = adjustLedgerForTwentySecondClock({
      ledger: ledger.offense.ledger,
      profile: input.profile,
    });
    const awayAdjust = adjustLedgerForTwentySecondClock({
      ledger: ledger.defense.ledger,
      profile: input.profile,
    });
    homePoints += homeAdjust.pointsDelta;
    awayPoints += awayAdjust.pointsDelta;
    facts['homeViolationsPer100'] = homeAdjust.violationsPer100;
    facts['awayViolationsPer100'] = awayAdjust.violationsPer100;
    facts['makeMultiplier'] = homeAdjust.makeMultiplier;
  } else if (input.rule === 'first-to-seven-overtime') {
    const race = estimateFirstToSevenRace(
      scoringDistributionOf(ledger.offense.ledger),
      scoringDistributionOf(ledger.defense.ledger),
    );
    overtime = {
      kind: 'first-to-seven',
      homeWinProb: race.homeWinProb,
      expectedPossessions: race.expectedPossessions,
    };
    facts['overtimeHomeWinProb'] = race.homeWinProb;
    facts['overtimeExpectedPossessions'] = race.expectedPossessions;
  }
  const diff = homePoints - awayPoints;
  let homeWinProb = winProbabilityFromDiff(diff);
  if (overtime.kind === 'first-to-seven') {
    const tieProb = 0.06;
    homeWinProb = homeWinProb * (1 - tieProb) + tieProb * overtime.homeWinProb;
    facts['regulationTieProb'] = tieProb;
  }
  const digestInput = [
    EVOLUTION_PROJECTION_ADAPTER_VERSION,
    input.rule,
    input.profile.profileVersion,
    ...input.homeUnit.map((p) => p.playerVersionId ?? p.playerId),
    ...input.awayUnit.map((p) => p.playerVersionId ?? p.playerId),
  ].join('|');
  return {
    rule: input.rule,
    adapterVersion: EVOLUTION_PROJECTION_ADAPTER_VERSION,
    homePointsPer100: homePoints,
    awayPointsPer100: awayPoints,
    homeWinProb,
    inputDigest: seasonDigestHex(digestInput),
    overtime,
    facts,
  };
}

export function innovationIdOfRule(rule: SeasonGameRule): SeasonCourtInnovationId | null {
  if (rule === 'deep-four') return 'deep-four';
  if (rule === 'twenty-second-clock') return 'twenty-second-clock';
  if (rule === 'first-to-seven-overtime') return 'first-to-seven-overtime';
  return null;
}
