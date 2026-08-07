import type {
  EraSimulationProfile,
  ProjectionLedger,
  ProjectionTurnoverCauses,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '@hoop-rush/data-contracts';
import { creationScore, spacingScore } from '../domain/archetypes.ts';
import { ENGINE_CONSTANTS } from '../sim/constants.ts';
import {
  freeThrowProbability,
  freeThrowsForZone,
  nonShootingFoulProbability,
  shootingFoulProbability,
} from '../sim/fouls.ts';
import { assistProbabilityPure } from '../sim/possession.ts';
import type { TeamPrep } from '../sim/prepare.ts';
import { sameGroupMatchWeight } from '../sim/position-responsibilities.ts';
import { offensiveReboundProbability } from '../sim/rebounding.ts';
import { eraPossEstimatePerTrip, turnoverProbability } from '../sim/security.ts';
import {
  blockProbability,
  contestPenalty,
  makeProbability,
  shotQualityBonus,
  type ShotPrep,
} from '../sim/shooting.ts';
import {
  ACTION_TYPES,
  applyZonePulls,
  assisterWeights,
  passProbability,
  type ActionType,
} from '../sim/usage.ts';

/**
 * Deterministic expected ledger (projection milestone). One side's offense is
 * aggregated as the exact expectation over the possession engine's pure
 * probability functions, per 100 possessions, without any random draw. The
 * engine's sampled pipeline remains authoritative; this module adds only
 * deterministic expectation over the same formulas and constants.
 *
 * Neutral assumptions (documented, calibration-visible):
 * - every trip is a regulation non-buzzer trip (no late-clock penalty, no
 *   dead-ball team rebound from FGA misses);
 * - the defending team is never in the bonus (period foul state is a game
 *   flow effect; free-throw pressure components capture the draw separately);
 * - missed non-final free throws are declared dead-ball defensive team
 *   rebounds, folded into defensive rebounds;
 * - second-chance value uses a bounded analytic continuation correction that
 *   never loops or samples repeated rebounds.
 */

const ZONES: readonly ShotZone[] = SHOT_ZONES;

/** Regulation period seconds used for the make-probability late-clock term (no penalty). */
const REGULATION_START_SECONDS = 720;

/** Per-player ledger facts in team index order. */
export interface LedgerPlayerFacts {
  slotIndex: number;
  player: SimulationPlayer;
  /** Share of shot attempts taken. */
  usageShare: number;
  /** Share of initiations led. */
  initiatorShare: number;
  /** Normalized creation contribution (0-100). */
  creationShare: number;
  /** Spacing contribution (0-100). */
  spacingContribution: number;
  expectedShots: number;
  expectedMakes: number;
  expectedPoints: number;
  expectedAssists: number;
  expectedTurnovers: number;
  expectedRebounds: number;
  expectedFouls: number;
  /** Normalized defensive contribution (0-100). */
  defensiveContribution: number;
}

/** One side of the expected ledger (team index order throughout). */
export interface LedgerSide {
  ledger: ProjectionLedger;
  turnoverCauses: ProjectionTurnoverCauses;
  actions: Record<ActionType, number>;
  zones: Record<ShotZone, number>;
  /** Shooter distribution in team index order (sums to 1). */
  shooters: number[];
  players: LedgerPlayerFacts[];
  /** Aggregate make probability across shot mass. */
  aggregateMakePct: number;
  /** Expected passes per 100 possessions. */
  passOpportunity: number;
  /** Expected play-type shot-quality lift across shot mass (two-point only). */
  shotQualityLift: number;
  /** Expected defensive contest penalty applied across shot mass. */
  expectedContest: number;
}

export interface ExpectedLedgerResult {
  offense: LedgerSide;
  defense: LedgerSide;
}

/** Internal mutable ledger with rebound-chance denominators. */
interface LedgerInternal {
  fieldGoalAttempts: number;
  fieldGoalMakes: number;
  twoPointAttempts: number;
  twoPointMakes: number;
  threePointAttempts: number;
  threePointMakes: number;
  freeThrowAttempts: number;
  freeThrowMakes: number;
  points: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  turnovers: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  offensiveReboundChances: number;
  defensiveReboundChances: number;
}

/** Per-player accumulated expectation, aligned with `players` by index. */
interface PlayerAgg {
  shots: number;
  makes: number;
  points: number;
  turnovers: number;
  rebounds: number;
  fouls: number;
}

/**
 * Probability a turnover is credited as an opponent steal: the deterministic
 * expected value of the engine's `isSteal` draw.
 */
export function expectedStealShare(stealAbility: number, profile: EraSimulationProfile): number {
  return Math.min(
    0.9,
    Math.max(
      0.3,
      profile.parameters.stealShareOfTurnovers *
        (1 + (stealAbility - ENGINE_CONSTANTS.stealNeutralAbility) / 100),
    ),
  );
}

/**
 * The per-100 expected ledger of one five-man side against another. Computes
 * both directions so steals/blocks/fouls cross-terms reconcile exactly.
 */
export function projectExpectedLedger(input: {
  team: SimulationTeam;
  prep: TeamPrep;
  opponent: SimulationTeam;
  opponentPrep: TeamPrep;
  profile: EraSimulationProfile;
}): ExpectedLedgerResult {
  const { team, prep, opponent, opponentPrep, profile } = input;
  const eraPoss = eraPossEstimatePerTrip(profile) ?? 1;
  const passingAnchorFactor = 0.5 + (profile.parameters.assistAnchorRating - 50) / 100;

  const offense = computeSide({
    side: team,
    prep,
    opponentPrep,
    profile,
    eraPoss,
    passingAnchorFactor,
  });
  const defense = computeSide({
    side: opponent,
    prep: opponentPrep,
    opponentPrep: prep,
    profile,
    eraPoss,
    passingAnchorFactor,
  });

  // Cross terms: steals credited to each side's defense come from the
  // opponent's turnover mass converted at this side's steal ability.
  const offenseSteals = defense.ledger.turnovers * expectedStealShare(prep.stealAbility, profile);
  const defenseSteals =
    offense.ledger.turnovers * expectedStealShare(opponentPrep.stealAbility, profile);

  return {
    offense: { ...offense, ledger: { ...offense.ledger, steals: offenseSteals } },
    defense: { ...defense, ledger: { ...defense.ledger, steals: defenseSteals } },
  };
}

function computeSide(input: {
  side: SimulationTeam;
  prep: TeamPrep;
  opponentPrep: TeamPrep;
  profile: EraSimulationProfile;
  eraPoss: number;
  passingAnchorFactor: number;
}): LedgerSide {
  const { side, prep, opponentPrep, profile, eraPoss, passingAnchorFactor } = input;
  const players = side.players;

  // --- Turnover mass per initiator ---
  const initiatorShares = normalizedWeights(prep.initiatorWeights);
  const turnoverRates = players.map((player) =>
    turnoverProbability(player, opponentPrep.pressure, eraPoss, profile),
  );
  const turnoverMass = initiatorShares.reduce(
    (sum, share, index) => sum + share * (turnoverRates[index] ?? 0),
    0,
  );
  const turnoverRate = Math.min(1, Math.max(0, turnoverMass));

  // --- Shot mass after turnovers and non-shooting fouls ---
  // The engine checks for a non-shooting foul up to four times per trip and
  // continues the trip after non-bonus fouls (the neutral assumption here is
  // "never in the bonus", so a non-shooting foul never ends a trip). The
  // expected number of non-shooting fouls per trip is the truncated geometric
  // expectation p + p² + p³ + p⁴; the trip still ends in a shot unless it
  // turned over. All masses below are per 100 possessions.
  const noTurnover = 1 - turnoverRate;
  const nsfPerTrip = nonShootingFoulProbability(profile);
  const expectedNsfPerTrip =
    nsfPerTrip * (1 + nsfPerTrip + nsfPerTrip * nsfPerTrip + nsfPerTrip * nsfPerTrip * nsfPerTrip);
  const nonShootingFoulRate = noTurnover * expectedNsfPerTrip;
  const shotMass = noTurnover * 100;

  // --- Shot mass ---
  // Aggregated per distinct (shooter, zone, action, defender) key with cached
  // zone shares, defender distributions, and per-key shot probabilities, so
  // the expensive probability functions run at most once per key instead of
  // once per initiator path.
  const shotMassByKey = new Map<
    string,
    {
      shooterIndex: number;
      defenderIndex: number;
      zone: ShotZone;
      action: ActionType;
      mass: number;
      passedMass: number;
      /** Passed mass per initiator (for the initiator-weighted assister expectation). */
      passedByInitiator: number[];
    }
  >();
  const actionTotals: Record<string, number> = {};
  const zoneTotals: Record<string, number> = {};
  const shooterTotals = new Array<number>(players.length).fill(0);
  let passOpportunity = 0;
  const zoneShareCache = new Map<string, number[]>();
  const defenderCache = new Map<string, number[]>();

  for (let initiatorIndex = 0; initiatorIndex < players.length; initiatorIndex += 1) {
    const initiator = players[initiatorIndex];
    if (initiator === undefined) continue;
    const initiatorKey = engineKey(initiator);
    const initiatorShare = initiatorShares[initiatorIndex] ?? 0;
    const actionTable = prep.actionWeights.get(initiatorKey);
    if (actionTable === undefined) continue;
    const actionShares = normalizedWeights(actionTable);
    const teammateShots = prep.teammateShots.get(initiatorKey);

    for (let actionIndex = 0; actionIndex < ACTION_TYPES.length; actionIndex += 1) {
      const action = ACTION_TYPES[actionIndex];
      if (action === undefined) continue;
      const actionShare = actionShares[actionIndex] ?? 0;
      if (actionShare <= 0) continue;
      const passP = passProbability(initiator, action);
      const shooterShares = shooterSharesFor(players, initiatorIndex, action, teammateShots, passP);
      for (let shooterIndex = 0; shooterIndex < players.length; shooterIndex += 1) {
        const shooterShare = shooterShares[shooterIndex] ?? 0;
        if (shooterShare <= 0) continue;
        const shooter = players[shooterIndex];
        if (shooter === undefined) continue;
        const zoneShareKey = `${String(shooterIndex)}|${action}`;
        let zoneShares = zoneShareCache.get(zoneShareKey);
        if (zoneShares === undefined) {
          const zonePrep = prep.zonePrep.get(engineKey(shooter));
          if (zonePrep === undefined) continue;
          zoneShares = normalizedWeights(applyZonePulls(action, zonePrep.base, zonePrep.driveRate));
          zoneShareCache.set(zoneShareKey, zoneShares);
        }

        for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex += 1) {
          const zone = ZONES[zoneIndex];
          if (zone === undefined) continue;
          const zoneShare = zoneShares[zoneIndex] ?? 0;
          if (zoneShare <= 0) continue;
          const defenderKey = `${String(shooterIndex)}|${zone}`;
          let defenderProbs = defenderCache.get(defenderKey);
          if (defenderProbs === undefined) {
            defenderProbs = defenderDistribution(opponentPrep, zone, shooterIndex);
            defenderCache.set(defenderKey, defenderProbs);
          }
          for (let defenderIndex = 0; defenderIndex < players.length; defenderIndex += 1) {
            const defenderShare = defenderProbs[defenderIndex] ?? 0;
            if (defenderShare <= 0) continue;
            const mass =
              shotMass * initiatorShare * actionShare * shooterShare * zoneShare * defenderShare;
            if (mass <= 0) continue;
            const key = `${String(shooterIndex)}|${String(defenderIndex)}|${zone}|${action}`;
            const entry = shotMassByKey.get(key);
            if (entry === undefined) {
              shotMassByKey.set(key, {
                shooterIndex,
                defenderIndex,
                zone,
                action,
                mass,
                passedMass: shooterIndex !== initiatorIndex ? mass : 0,
                passedByInitiator:
                  initiatorIndex === shooterIndex
                    ? new Array<number>(players.length).fill(0)
                    : (() => {
                        const byInitiator = new Array<number>(players.length).fill(0);
                        byInitiator[initiatorIndex] = mass;
                        return byInitiator;
                      })(),
              });
            } else {
              entry.mass += mass;
              if (shooterIndex !== initiatorIndex) {
                entry.passedMass += mass;
                entry.passedByInitiator[initiatorIndex] =
                  (entry.passedByInitiator[initiatorIndex] ?? 0) + mass;
              }
            }
            actionTotals[action] = (actionTotals[action] ?? 0) + mass;
            zoneTotals[zone] = (zoneTotals[zone] ?? 0) + mass;
            shooterTotals[shooterIndex] = (shooterTotals[shooterIndex] ?? 0) + mass;
          }
        }
        if (passP > 0) {
          passOpportunity += shotMass * initiatorShare * actionShare * shooterShare * passP;
        }
      }
    }
  }

  // --- Aggregate per-shot expectations ---
  const internal: LedgerInternal = {
    fieldGoalAttempts: 0,
    fieldGoalMakes: 0,
    twoPointAttempts: 0,
    twoPointMakes: 0,
    threePointAttempts: 0,
    threePointMakes: 0,
    freeThrowAttempts: 0,
    freeThrowMakes: 0,
    points: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    turnovers: turnoverRate * 100,
    assists: 0,
    steals: 0,
    blocks: 0,
    fouls: 0,
    offensiveReboundChances: 0,
    defensiveReboundChances: 0,
  };

  const playerAgg = players.map((): PlayerAgg => ({
    shots: 0,
    makes: 0,
    points: 0,
    turnovers: 0,
    rebounds: 0,
    fouls: 0,
  }));
  const playerAssists = new Array<number>(players.length).fill(0);

  const playerAggAt = (index: number): PlayerAgg => {
    const agg = playerAgg[index];
    if (!agg) throw new Error(`projection: missing player aggregate at slot ${String(index)}`);
    return agg;
  };

  let qualityLiftTotal = 0;
  let contestTotal = 0;

  const offensiveRebounderShare = normalizedWeights(prep.rebounderWeights[0]);
  const defensiveRebounderShare = normalizedWeights(opponentPrep.rebounderWeights[1]);
  const orebPByZone = new Map<ShotZone, number>();
  const rimOrebP = offensiveReboundProbability(
    prep.offensiveReboundMean,
    opponentPrep.defensiveReboundMean,
    'rim',
    profile,
  );
  const shotPrepByShooter = new Map<string, ShotPrep>();
  const assistProbabilityCache = new Map<string, number>();
  const assisterShareCache = new Map<string, number[]>();

  for (const entry of shotMassByKey.values()) {
    const shooter = players[entry.shooterIndex];
    const defender = players[entry.defenderIndex];
    if (shooter === undefined || defender === undefined) continue;
    const makeP = makeProbability(
      shooter,
      defender,
      profile,
      entry.zone,
      entry.action,
      REGULATION_START_SECONDS,
      shotPrepForCached(shotPrepByShooter, prep, shooter),
    );
    const foulP = shootingFoulProbability(shooter, defender, entry.zone, profile);
    const blockP = blockProbability(defender, entry.zone, entry.action);
    const ftP = freeThrowProbability(shooter, profile);
    const ftCount = freeThrowsForZone(entry.zone);
    const makeGivenFoul = makeP * ENGINE_CONSTANTS.fouledShotMakeScale;
    const makeProb = foulP * makeGivenFoul + (1 - foulP) * (1 - blockP) * makeP;
    const missProb = 1 - makeProb;
    const blockProb = (1 - foulP) * blockP;
    const madeWithFoulProb = foulP * makeGivenFoul;
    const missedWithFoulProb = foulP * (1 - makeGivenFoul);
    const mass = entry.mass;
    const three = entry.zone === 'cornerThree' || entry.zone === 'aboveBreakThree';

    // Field goals and points.
    internal.fieldGoalAttempts += mass;
    internal.fieldGoalMakes += mass * makeProb;
    if (three) {
      internal.threePointAttempts += mass;
      internal.threePointMakes += mass * makeProb;
    } else {
      internal.twoPointAttempts += mass;
      internal.twoPointMakes += mass * makeProb;
    }
    internal.points += mass * (three ? 3 : 2) * makeProb;

    // Blocks against, fouls drawn.
    internal.blocks += mass * blockProb;
    internal.fouls += mass * foulP;

    // Free throws: and-one on made-with-foul, full set on miss-with-foul.
    const madeWithFoulShare = madeWithFoulProb / Math.max(1e-9, foulP);
    const missedWithFoulShare = missedWithFoulProb / Math.max(1e-9, foulP);
    const ftaMass = mass * foulP * (madeWithFoulShare * 1 + missedWithFoulShare * ftCount);
    const ftmMass = ftaMass * ftP;
    internal.freeThrowAttempts += ftaMass;
    internal.freeThrowMakes += ftmMass;
    internal.points += ftmMass;

    // Rebounds on missed field goals (live).
    let orebP = orebPByZone.get(entry.zone);
    if (orebP === undefined) {
      orebP = offensiveReboundProbability(
        prep.offensiveReboundMean,
        opponentPrep.defensiveReboundMean,
        entry.zone,
        profile,
      );
      orebPByZone.set(entry.zone, orebP);
    }
    const missMass = mass * missProb;
    internal.offensiveReboundChances += missMass;
    internal.defensiveReboundChances += missMass;
    const liveOreb = missMass * orebP;
    internal.offensiveRebounds += liveOreb;
    internal.defensiveRebounds += missMass * (1 - orebP);

    // Rebounds on missed free throws: the last attempt (and the and-one) are
    // live rim rebounds; non-final attempts are dead-ball defensive team
    // rebounds folded into defensive rebounds.
    const liveFtMiss = mass * (missedWithFoulProb + madeWithFoulProb) * (1 - ftP);
    internal.offensiveReboundChances += liveFtMiss;
    internal.defensiveReboundChances += liveFtMiss;
    internal.offensiveRebounds += liveFtMiss * rimOrebP;
    internal.defensiveRebounds += liveFtMiss * (1 - rimOrebP);
    internal.defensiveRebounds += mass * missedWithFoulProb * (ftCount - 1) * (1 - ftP);

    // Assists on made passed shots: expectation over the initiator-weighted
    // assister distribution (the passed mass per initiator is recorded).
    if (entry.passedMass > 0) {
      const totalPassed = entry.passedMass;
      const assisterProbKey = `${String(entry.shooterIndex)}|${entry.action}|${entry.zone}`;
      let assisterProbs = assisterShareCache.get(assisterProbKey);
      if (assisterProbs === undefined) {
        assisterProbs = initiatorWeightedAssisterDistribution(
          side,
          shooter,
          players,
          entry.passedByInitiator,
          totalPassed,
        );
        assisterShareCache.set(assisterProbKey, assisterProbs);
      }
      let expectedAssists = 0;
      for (let passerIndex = 0; passerIndex < players.length; passerIndex += 1) {
        const passer = players[passerIndex];
        if (passer === undefined || passerIndex === entry.shooterIndex) continue;
        const probKey = `${String(passerIndex)}|${entry.action}|${entry.zone}|${String(entry.shooterIndex)}`;
        let assistP = assistProbabilityCache.get(probKey);
        if (assistP === undefined) {
          assistP = assistProbabilityPure(
            profile,
            passingAnchorFactor,
            passer,
            entry.action,
            entry.zone,
            shooter,
          );
          assistProbabilityCache.set(probKey, assistP);
        }
        expectedAssists += (assisterProbs[passerIndex] ?? 0) * assistP;
      }
      const assists = entry.passedMass * makeProb * expectedAssists;
      internal.assists += assists;
      for (let passerIndex = 0; passerIndex < players.length; passerIndex += 1) {
        if (passerIndex === entry.shooterIndex) continue;
        playerAssists[passerIndex] =
          (playerAssists[passerIndex] ?? 0) +
          entry.passedMass * makeProb * (assisterProbs[passerIndex] ?? 0);
      }
    }

    // Per-player aggregation.
    const agg = playerAgg[entry.shooterIndex];
    if (agg === undefined) continue;
    agg.shots += mass;
    agg.makes += mass * makeProb;
    agg.points += mass * (three ? 3 : 2) * makeProb + ftmMass;
    agg.fouls += mass * foulP;
    agg.rebounds += liveOreb * (offensiveRebounderShare[entry.shooterIndex] ?? 0);
    agg.rebounds += missMass * (1 - orebP) * (defensiveRebounderShare[entry.shooterIndex] ?? 0);
    agg.rebounds += liveFtMiss * rimOrebP * (offensiveRebounderShare[entry.shooterIndex] ?? 0);
    agg.rebounds +=
      liveFtMiss * (1 - rimOrebP) * (defensiveRebounderShare[entry.shooterIndex] ?? 0);

    qualityLiftTotal += mass * (three ? 0 : shotQualityBonus(entry.action, entry.zone));
    contestTotal += mass * -contestPenalty(defender, entry.zone);
  }

  /** Per-player turnover attribution by initiator share. */
  for (let index = 0; index < players.length; index += 1) {
    playerAggAt(index).turnovers =
      (initiatorShares[index] ?? 0) * (turnoverRates[index] ?? 0) * 100;
  }

  // Bounded analytic continuation: a continuation only follows a miss that is
  // offensive-rebounded, so the geometric series ratio is q x (1 - makeAvg)
  // (the engine's continuation path skips security/foul checks; turnovers
  // stay base while shots, makes, free throws, and rebounds scale).
  const makeAvg =
    internal.fieldGoalAttempts > 0 ? internal.fieldGoalMakes / internal.fieldGoalAttempts : 0.45;
  const averageOrebRate =
    internal.offensiveRebounds / Math.max(1e-9, internal.offensiveReboundChances);
  const scale = Math.min(1 / Math.max(1e-9, 1 - averageOrebRate * (1 - makeAvg)), 4);

  const ledger: ProjectionLedger = {
    possessions: 100,
    turnoverRate,
    nonShootingFoulRate,
    shotRate: (shotMass * scale) / 100,
    fieldGoalAttempts: internal.fieldGoalAttempts * scale,
    fieldGoalMakes: internal.fieldGoalMakes * scale,
    twoPointAttempts: internal.twoPointAttempts * scale,
    twoPointMakes: internal.twoPointMakes * scale,
    threePointAttempts: internal.threePointAttempts * scale,
    threePointMakes: internal.threePointMakes * scale,
    freeThrowAttempts: internal.freeThrowAttempts * scale,
    freeThrowMakes: internal.freeThrowMakes * scale,
    fieldGoalPct: internal.fieldGoalMakes / Math.max(1e-9, internal.fieldGoalAttempts),
    twoPointPct: internal.twoPointMakes / Math.max(1e-9, internal.twoPointAttempts),
    threePointPct: internal.threePointMakes / Math.max(1e-9, internal.threePointAttempts),
    effectiveFieldGoalPct:
      (internal.fieldGoalMakes + 0.5 * internal.threePointMakes) /
      Math.max(1e-9, internal.fieldGoalAttempts),
    trueShootingPct:
      internal.points /
      Math.max(1e-9, 2 * (internal.fieldGoalAttempts + 0.44 * internal.freeThrowAttempts)),
    freeThrowRate: internal.freeThrowAttempts / Math.max(1e-9, internal.fieldGoalAttempts),
    points: internal.points * scale,
    offensiveReboundRate:
      internal.offensiveRebounds / Math.max(1e-9, internal.offensiveReboundChances),
    defensiveReboundRate:
      internal.defensiveRebounds / Math.max(1e-9, internal.defensiveReboundChances),
    offensiveRebounds: internal.offensiveRebounds * scale,
    defensiveRebounds: internal.defensiveRebounds * scale,
    turnovers: internal.turnovers,
    assists: internal.assists * scale,
    steals: internal.steals,
    blocks: internal.blocks * scale,
    // Shooting fouls drawn plus expected non-shooting fouls, per 100.
    fouls: internal.fouls * scale + nonShootingFoulRate,
    secondChancePoints: internal.points * (scale - 1),
  };

  const stealShare = expectedStealShare(opponentPrep.stealAbility, profile);
  const turnoverCauses: ProjectionTurnoverCauses = {
    stealShare,
    nonStealShare: 1 - stealShare,
    expectedSteals: ledger.turnovers * stealShare,
    expectedOther: ledger.turnovers * (1 - stealShare),
  };

  return {
    ledger,
    turnoverCauses,
    actions: Object.fromEntries(
      ACTION_TYPES.map((action) => [
        action,
        (actionTotals[action] ?? 0) / Math.max(1e-9, shotMass),
      ]),
    ) as Record<ActionType, number>,
    zones: Object.fromEntries(
      ZONES.map((zone) => [zone, (zoneTotals[zone] ?? 0) / Math.max(1e-9, shotMass)]),
    ) as Record<ShotZone, number>,
    shooters: shooterTotals.map((value) => value / Math.max(1e-9, shotMass)),
    players: players.map((player, index) => ({
      slotIndex: index,
      player,
      usageShare: (shooterTotals[index] ?? 0) / Math.max(1e-9, shotMass),
      initiatorShare: initiatorShares[index] ?? 0,
      creationShare: creationScore(player) * 100,
      spacingContribution: spacingScore(player) * 100,
      expectedShots: playerAggAt(index).shots * scale,
      expectedMakes: playerAggAt(index).makes * scale,
      expectedPoints: playerAggAt(index).points * scale,
      expectedAssists: (playerAssists[index] ?? 0) * scale,
      expectedTurnovers: playerAggAt(index).turnovers,
      expectedRebounds: playerAggAt(index).rebounds * scale,
      expectedFouls: playerAggAt(index).fouls * scale,
      defensiveContribution: defensiveContributionOf(player),
    })),
    aggregateMakePct:
      internal.fieldGoalAttempts > 0 ? internal.fieldGoalMakes / internal.fieldGoalAttempts : 0,
    passOpportunity,
    shotQualityLift: qualityLiftTotal / Math.max(1e-9, shotMass),
    expectedContest: contestTotal / Math.max(1e-9, shotMass),
  };
}

function engineKey(player: SimulationPlayer): string {
  return player.playerVersionId ?? player.playerId;
}

function shotPrepFor(prep: TeamPrep, shooter: SimulationPlayer): ShotPrep {
  return {
    spacing: prep.spacing,
    twoPointAnchor: prep.twoPointAnchor.get(engineKey(shooter)) ?? null,
  };
}

/** Cached per-shooter shot prep (pure per (prep, shooter)). */
function shotPrepForCached(
  cache: Map<string, ShotPrep>,
  prep: TeamPrep,
  shooter: SimulationPlayer,
): ShotPrep {
  const key = engineKey(shooter);
  let cached = cache.get(key);
  if (cached === undefined) {
    cached = shotPrepFor(prep, shooter);
    cache.set(key, cached);
  }
  return cached;
}

/**
 * Expected defender probability distribution for one (shooter slot, zone):
 * exactly the `pickDefender` weight formula (zone weights × same-slot-group
 * matchup × assigned-slot rim protection on interior zones).
 */
function defenderDistribution(prep: TeamPrep, zone: ShotZone, shooterSlot: number): number[] {
  const interior = zone === 'rim' || zone === 'shortMid';
  const zoneIndex = ZONES.indexOf(zone);
  const zoneWeights = prep.defenderBase.weights[zoneIndex] ?? [];
  const size = prep.defenderBase.weights[0]?.length ?? 5;
  const weights = new Array<number>(size).fill(0);
  for (let slot = 0; slot < size; slot += 1) {
    const match = sameGroupMatchWeight(slot, shooterSlot);
    const rim = interior ? (prep.defenderBase.rimProtection[slot] ?? 1) : 1;
    weights[slot] = (zoneWeights[slot] ?? 0) * match * rim;
  }
  return normalizedWeights(weights);
}

function normalizedWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / Math.max(1e-9, total));
}

/**
 * Shooter probability per team index for one (initiator, action): the
 * initiator keeps the shot with `1 - passProbability`; passed possessions
 * distribute through the engine's teammate shot weights (roll variant for
 * roll actions, pass variant otherwise).
 */
function shooterSharesFor(
  players: readonly SimulationPlayer[],
  initiatorIndex: number,
  action: ActionType,
  teammateShots:
    | {
        roll: { teammates: SimulationPlayer[]; weights: number[] };
        pass: { teammates: SimulationPlayer[]; weights: number[] };
      }
    | undefined,
  passP: number,
): number[] {
  const shares = new Array<number>(players.length).fill(0);
  shares[initiatorIndex] = 1 - passP;
  if (passP <= 0 || teammateShots === undefined) return shares;
  const selected = action === 'pickAndRollRoll' ? teammateShots.roll : teammateShots.pass;
  const probs = normalizedWeights(selected.weights);
  for (let index = 0; index < selected.teammates.length; index += 1) {
    const teammate = selected.teammates[index];
    if (teammate === undefined) continue;
    const teamIndex = players.findIndex((player) => player.playerId === teammate.playerId);
    if (teamIndex < 0) continue;
    shares[teamIndex] = (shares[teamIndex] ?? 0) + passP * (probs[index] ?? 0);
  }
  return shares;
}

/**
 * Initiator-weighted assister probability per team index: the `pickAssister`
 * weight formula normalized over the four non-shooter candidates, averaged
 * over the passed-mass share each initiator led (the initiator earns a 1.35
 * bonus in the sampled pipeline, so the expectation must weight it the same
 * way).
 */
function initiatorWeightedAssisterDistribution(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  players: readonly SimulationPlayer[],
  passedByInitiator: readonly number[],
  totalPassed: number,
): number[] {
  const perIndex = new Array<number>(team.players.length).fill(0);
  for (let initiatorIndex = 0; initiatorIndex < players.length; initiatorIndex += 1) {
    const share = (passedByInitiator[initiatorIndex] ?? 0) / Math.max(1e-9, totalPassed);
    if (share <= 0) continue;
    const initiator = players[initiatorIndex];
    if (initiator === undefined) continue;
    const weights = assisterWeights(team, shooter, initiator);
    const normalized = normalizedWeights(weights);
    let candidateIndex = 0;
    for (let index = 0; index < team.players.length; index += 1) {
      if (team.players[index]?.playerId === shooter.playerId) continue;
      perIndex[index] = (perIndex[index] ?? 0) + share * (normalized[candidateIndex] ?? 0);
      candidateIndex += 1;
    }
  }
  return perIndex;
}

/** Defensive contribution: pressure blend over possession inputs (0-100). */
function defensiveContributionOf(player: SimulationPlayer): number {
  const pressure =
    player.ratings.perimeterDefense * 0.5 +
    player.ratings.steal * 0.3 +
    player.ratings.defensiveIq * 0.2;
  return Math.min(100, Math.max(0, pressure));
}
