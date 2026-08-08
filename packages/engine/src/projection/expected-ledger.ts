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
import { REGULATION_PERIOD_SECONDS } from '../sim/periods.ts';
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
const REGULATION_START_SECONDS = REGULATION_PERIOD_SECONDS;

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
  // once per initiator path. Caches are flat typed arrays over the small
  // (player x zone x action) domains; `keyOrder` preserves first-seen key
  // order so the aggregation pass accumulates exactly as the Map did.
  const playerCount = players.length;
  const actionCount = ACTION_TYPES.length;
  const zoneCount = ZONES.length;
  const totalKeys = playerCount * playerCount * zoneCount * actionCount;
  const massByKey = new Float64Array(totalKeys);
  const passedMassByKey = new Float64Array(totalKeys);
  const passedByInitiatorByKey = new Float64Array(totalKeys * playerCount);
  const seenByKey = new Uint8Array(totalKeys);
  const keyOrder: number[] = [];
  const actionTotals: Record<string, number> = {};
  const zoneTotals: Record<string, number> = {};
  const shooterTotals = new Array<number>(playerCount).fill(0);
  let passOpportunity = 0;
  const zoneShareFlat = new Float64Array(playerCount * actionCount * zoneCount);
  const zoneShareSeen = new Uint8Array(playerCount * actionCount);
  const defenderFlat = new Float64Array(playerCount * zoneCount * playerCount);
  const defenderSeen = new Uint8Array(playerCount * zoneCount);
  const playerIdToIndex = new Map<string, number>();
  for (let index = 0; index < playerCount; index += 1) {
    const player = players[index];
    if (player === undefined) continue;
    if (!playerIdToIndex.has(player.playerId)) playerIdToIndex.set(player.playerId, index);
  }

  for (let initiatorIndex = 0; initiatorIndex < playerCount; initiatorIndex += 1) {
    const initiator = players[initiatorIndex];
    if (initiator === undefined) continue;
    const initiatorKey = engineKey(initiator);
    const initiatorShare = initiatorShares[initiatorIndex] ?? 0;
    const actionTable = prep.actionWeights.get(initiatorKey);
    if (actionTable === undefined) continue;
    const actionShares = normalizedWeights(actionTable);
    const teammateShots = prep.teammateShots.get(initiatorKey);
    // The roll/pass teammate weights are per initiator, not per action;
    // normalize each variant once and reuse it across actions.
    const normalizedRollShots =
      teammateShots === undefined
        ? undefined
        : normalizeTeammateShots(teammateShots.roll, playerIdToIndex);
    const normalizedPassShots =
      teammateShots === undefined
        ? undefined
        : normalizeTeammateShots(teammateShots.pass, playerIdToIndex);

    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      const action = ACTION_TYPES[actionIndex];
      if (action === undefined) continue;
      const actionShare = actionShares[actionIndex] ?? 0;
      if (actionShare <= 0) continue;
      const passP = passProbability(initiator, action);
      const selectedShots =
        action === 'pickAndRollRoll' ? normalizedRollShots : normalizedPassShots;
      const shooterShares = shooterSharesFor(players, initiatorIndex, passP, selectedShots);
      for (let shooterIndex = 0; shooterIndex < playerCount; shooterIndex += 1) {
        const shooterShare = shooterShares[shooterIndex] ?? 0;
        if (shooterShare <= 0) continue;
        const shooter = players[shooterIndex];
        if (shooter === undefined) continue;
        const zoneShareSlot = shooterIndex * actionCount + actionIndex;
        if (zoneShareSeen[zoneShareSlot] === 0) {
          const shooterZonePrep = prep.zonePrep.get(engineKey(shooter));
          if (shooterZonePrep === undefined) continue;
          const shares = normalizedWeights(
            applyZonePulls(action, shooterZonePrep.base, shooterZonePrep.driveRate),
          );
          for (let z = 0; z < zoneCount; z += 1) {
            zoneShareFlat[zoneShareSlot * zoneCount + z] = shares[z] ?? 0;
          }
          zoneShareSeen[zoneShareSlot] = 1;
        }

        for (let zoneIndex = 0; zoneIndex < zoneCount; zoneIndex += 1) {
          const zone = ZONES[zoneIndex];
          if (zone === undefined) continue;
          const zoneShare = zoneShareFlat[zoneShareSlot * zoneCount + zoneIndex] ?? 0;
          if (zoneShare <= 0) continue;
          const defenderSlot = shooterIndex * zoneCount + zoneIndex;
          if (defenderSeen[defenderSlot] === 0) {
            const probs = defenderDistribution(opponentPrep, zone, shooterIndex);
            for (let d = 0; d < playerCount; d += 1) {
              defenderFlat[defenderSlot * playerCount + d] = probs[d] ?? 0;
            }
            defenderSeen[defenderSlot] = 1;
          }
          // Prefix shared by every defender: same left-associative multiply
          // order as the sampled pipeline, so the values are unchanged.
          const keyBase =
            (shooterIndex * playerCount * zoneCount + zoneIndex) * actionCount + actionIndex;
          const keyStride = zoneCount * actionCount;
          const massPrefix = shotMass * initiatorShare * actionShare * shooterShare * zoneShare;
          for (let defenderIndex = 0; defenderIndex < playerCount; defenderIndex += 1) {
            const defenderShare = defenderFlat[defenderSlot * playerCount + defenderIndex] ?? 0;
            if (defenderShare <= 0) continue;
            const mass = massPrefix * defenderShare;
            if (mass <= 0) continue;
            const keyIndex = keyBase + defenderIndex * keyStride;
            if (seenByKey[keyIndex] === 0) {
              seenByKey[keyIndex] = 1;
              keyOrder.push(keyIndex);
              massByKey[keyIndex] = mass;
              passedMassByKey[keyIndex] = shooterIndex !== initiatorIndex ? mass : 0;
              if (shooterIndex !== initiatorIndex) {
                passedByInitiatorByKey[keyIndex * playerCount + initiatorIndex] = mass;
              }
            } else {
              massByKey[keyIndex] = (massByKey[keyIndex] ?? 0) + mass;
              if (shooterIndex !== initiatorIndex) {
                passedMassByKey[keyIndex] = (passedMassByKey[keyIndex] ?? 0) + mass;
                passedByInitiatorByKey[keyIndex * playerCount + initiatorIndex] =
                  (passedByInitiatorByKey[keyIndex * playerCount + initiatorIndex] ?? 0) + mass;
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
  const orebPFlat = new Float64Array(zoneCount);
  const orebPSeen = new Uint8Array(zoneCount);
  const rimOrebP = offensiveReboundProbability(
    prep.offensiveReboundMean,
    opponentPrep.defensiveReboundMean,
    'rim',
    profile,
  );
  const shotPrepByIndex: Array<ShotPrep | undefined> = new Array<ShotPrep | undefined>(playerCount);
  // Pure per-key probability functions are memoized over the subset of their
  // inputs that actually vary across keys: shootingFoulProbability does not
  // depend on the action, blockProbability not on the shooter, and so on.
  const foulPFlat = new Float64Array(playerCount * playerCount * zoneCount);
  const foulPSeen = new Uint8Array(playerCount * playerCount * zoneCount);
  const blockPFlat = new Float64Array(playerCount * zoneCount * actionCount);
  const blockPSeen = new Uint8Array(playerCount * zoneCount * actionCount);
  const ftPFlat = new Float64Array(playerCount);
  const ftPSeen = new Uint8Array(playerCount);
  const contestFlat = new Float64Array(playerCount * zoneCount);
  const contestSeen = new Uint8Array(playerCount * zoneCount);
  const shotQualityFlat = new Float64Array(actionCount * zoneCount);
  const shotQualitySeen = new Uint8Array(actionCount * zoneCount);
  const assistPFlat = new Float64Array(playerCount * actionCount * zoneCount * playerCount);
  const assistPSeen = new Uint8Array(playerCount * actionCount * zoneCount * playerCount);
  const assisterFlat = new Float64Array(playerCount * actionCount * zoneCount * playerCount);
  const assisterSeen = new Uint8Array(playerCount * actionCount * zoneCount);
  // Normalized assister weights depend only on the (shooter, initiator) pair,
  // so each pair is computed at most once per side instead of once per key.
  const assisterWeightByPair: Array<number[] | undefined> = new Array<number[] | undefined>(
    playerCount * playerCount,
  );

  for (const keyIndex of keyOrder) {
    const actionIndex = keyIndex % actionCount;
    const zoneIndex = Math.floor(keyIndex / actionCount) % zoneCount;
    const defenderIndex = Math.floor(keyIndex / (actionCount * zoneCount)) % playerCount;
    const shooterIndex = Math.floor(keyIndex / (actionCount * zoneCount * playerCount));
    const shooter = players[shooterIndex];
    const defender = players[defenderIndex];
    if (shooter === undefined || defender === undefined) continue;
    const zone = ZONES[zoneIndex];
    const action = ACTION_TYPES[actionIndex];
    if (zone === undefined || action === undefined) continue;
    const makeP = makeProbability(
      shooter,
      defender,
      profile,
      zone,
      action,
      REGULATION_START_SECONDS,
      shotPrepAt(shotPrepByIndex, prep, shooter, shooterIndex),
    );
    const foulPKey = (shooterIndex * playerCount + defenderIndex) * zoneCount + zoneIndex;
    let foulP = foulPSeen[foulPKey] === 1 ? foulPFlat[foulPKey] : undefined;
    if (foulP === undefined) {
      foulP = shootingFoulProbability(shooter, defender, zone, profile);
      foulPFlat[foulPKey] = foulP;
      foulPSeen[foulPKey] = 1;
    }
    const blockPKey = (defenderIndex * zoneCount + zoneIndex) * actionCount + actionIndex;
    let blockP = blockPSeen[blockPKey] === 1 ? blockPFlat[blockPKey] : undefined;
    if (blockP === undefined) {
      blockP = blockProbability(defender, zone, action);
      blockPFlat[blockPKey] = blockP;
      blockPSeen[blockPKey] = 1;
    }
    let ftP = ftPSeen[shooterIndex] === 1 ? ftPFlat[shooterIndex] : undefined;
    if (ftP === undefined) {
      ftP = freeThrowProbability(shooter, profile);
      ftPFlat[shooterIndex] = ftP;
      ftPSeen[shooterIndex] = 1;
    }
    const ftCount = freeThrowsForZone(zone);
    const makeGivenFoul = makeP * ENGINE_CONSTANTS.fouledShotMakeScale;
    const makeProb = foulP * makeGivenFoul + (1 - foulP) * (1 - blockP) * makeP;
    const missProb = 1 - makeProb;
    const blockProb = (1 - foulP) * blockP;
    const madeWithFoulProb = foulP * makeGivenFoul;
    const missedWithFoulProb = foulP * (1 - makeGivenFoul);
    const mass = massByKey[keyIndex] ?? 0;
    const three = zone === 'cornerThree' || zone === 'aboveBreakThree';

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
    let orebP = orebPSeen[zoneIndex] === 1 ? orebPFlat[zoneIndex] : undefined;
    if (orebP === undefined) {
      orebP = offensiveReboundProbability(
        prep.offensiveReboundMean,
        opponentPrep.defensiveReboundMean,
        zone,
        profile,
      );
      orebPFlat[zoneIndex] = orebP;
      orebPSeen[zoneIndex] = 1;
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
    const passedMass = passedMassByKey[keyIndex] ?? 0;
    if (passedMass > 0) {
      const totalPassed = passedMass;
      const assisterSlot =
        ((shooterIndex * actionCount + actionIndex) * zoneCount + zoneIndex) * playerCount;
      if (assisterSeen[assisterSlot / playerCount] === 0) {
        const distribution = initiatorWeightedAssisterDistribution(
          side,
          shooter,
          players,
          passedByInitiatorByKey.subarray(keyIndex * playerCount, (keyIndex + 1) * playerCount),
          totalPassed,
          assisterWeightByPair,
        );
        for (let passerIndex = 0; passerIndex < playerCount; passerIndex += 1) {
          assisterFlat[assisterSlot + passerIndex] = distribution[passerIndex] ?? 0;
        }
        assisterSeen[assisterSlot / playerCount] = 1;
      }
      let expectedAssists = 0;
      for (let passerIndex = 0; passerIndex < playerCount; passerIndex += 1) {
        const passer = players[passerIndex];
        if (passer === undefined || passerIndex === shooterIndex) continue;
        const probKey =
          ((passerIndex * actionCount + actionIndex) * zoneCount + zoneIndex) * playerCount +
          shooterIndex;
        let assistP = assistPSeen[probKey] === 1 ? assistPFlat[probKey] : undefined;
        if (assistP === undefined) {
          assistP = assistProbabilityPure(
            profile,
            passingAnchorFactor,
            passer,
            action,
            zone,
            shooter,
          );
          assistPFlat[probKey] = assistP;
          assistPSeen[probKey] = 1;
        }
        expectedAssists += (assisterFlat[assisterSlot + passerIndex] ?? 0) * assistP;
      }
      const assists = passedMass * makeProb * expectedAssists;
      internal.assists += assists;
      for (let passerIndex = 0; passerIndex < playerCount; passerIndex += 1) {
        if (passerIndex === shooterIndex) continue;
        playerAssists[passerIndex] =
          (playerAssists[passerIndex] ?? 0) +
          passedMass * makeProb * (assisterFlat[assisterSlot + passerIndex] ?? 0);
      }
    }

    const agg = playerAgg[shooterIndex];
    if (agg === undefined) continue;
    agg.shots += mass;
    agg.makes += mass * makeProb;
    agg.points += mass * (three ? 3 : 2) * makeProb + ftmMass;
    agg.fouls += mass * foulP;
    agg.rebounds += liveOreb * (offensiveRebounderShare[shooterIndex] ?? 0);
    agg.rebounds += missMass * (1 - orebP) * (defensiveRebounderShare[shooterIndex] ?? 0);
    agg.rebounds += liveFtMiss * rimOrebP * (offensiveRebounderShare[shooterIndex] ?? 0);
    agg.rebounds += liveFtMiss * (1 - rimOrebP) * (defensiveRebounderShare[shooterIndex] ?? 0);

    qualityLiftTotal +=
      mass *
      (three
        ? 0
        : shotQualityAt(shotQualityFlat, shotQualitySeen, action, actionIndex, zone, zoneIndex));
    contestTotal +=
      mass * -contestAt(contestFlat, contestSeen, defender, defenderIndex, zone, zoneIndex);
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

/** Cached per-shooter shot prep, indexed by team index (pure per (prep, shooter)). */
function shotPrepAt(
  cache: Array<ShotPrep | undefined>,
  prep: TeamPrep,
  shooter: SimulationPlayer,
  shooterIndex: number,
): ShotPrep {
  let cached = cache[shooterIndex];
  if (cached === undefined) {
    cached = shotPrepFor(prep, shooter);
    cache[shooterIndex] = cached;
  }
  return cached;
}

/** Memoized play-type conversion bonus (pure per (action, zone)). */
function shotQualityAt(
  flat: Float64Array,
  seen: Uint8Array,
  action: ActionType,
  actionIndex: number,
  zone: ShotZone,
  zoneIndex: number,
): number {
  const key = actionIndex * SHOT_ZONES.length + zoneIndex;
  if (seen[key] === 1) return flat[key] ?? 0;
  const value = shotQualityBonus(action, zone);
  flat[key] = value;
  seen[key] = 1;
  return value;
}

/** Memoized defensive contest adjustment (pure per (defender, zone)). */
function contestAt(
  flat: Float64Array,
  seen: Uint8Array,
  defender: SimulationPlayer,
  defenderIndex: number,
  zone: ShotZone,
  zoneIndex: number,
): number {
  const key = defenderIndex * SHOT_ZONES.length + zoneIndex;
  if (seen[key] === 1) return flat[key] ?? 0;
  const value = contestPenalty(defender, zone);
  flat[key] = value;
  seen[key] = 1;
  return value;
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
 * Normalized teammate shot shares mapped to team indices, for one variant
 * (roll or pass). Pure per (teammate weights, team); computed once per
 * initiator and reused across every action that shares the variant.
 */
function normalizeTeammateShots(
  shots: { teammates: SimulationPlayer[]; weights: number[] },
  playerIdToIndex: ReadonlyMap<string, number>,
): { teammates: SimulationPlayer[]; shares: number[] } | undefined {
  if (shots.teammates.length === 0) return undefined;
  const probs = normalizedWeights(shots.weights);
  const shares = new Array<number>(probs.length).fill(0);
  for (let index = 0; index < shots.teammates.length; index += 1) {
    const teammate = shots.teammates[index];
    if (teammate === undefined) continue;
    const teamIndex = playerIdToIndex.get(teammate.playerId);
    if (teamIndex === undefined) continue;
    shares[teamIndex] = (shares[teamIndex] ?? 0) + (probs[index] ?? 0);
  }
  return { teammates: shots.teammates, shares };
}

/**
 * Shooter probability per team index for one (initiator, action): the
 * initiator keeps the shot with `1 - passProbability`; passed possessions
 * distribute through the pre-normalized teammate shot shares.
 */
function shooterSharesFor(
  players: readonly SimulationPlayer[],
  initiatorIndex: number,
  passP: number,
  selectedShots: { teammates: SimulationPlayer[]; shares: number[] } | undefined,
): number[] {
  const shares = new Array<number>(players.length).fill(0);
  shares[initiatorIndex] = 1 - passP;
  if (passP <= 0 || selectedShots === undefined) return shares;
  for (let index = 0; index < players.length; index += 1) {
    const share = selectedShots.shares[index] ?? 0;
    if (share <= 0) continue;
    shares[index] = (shares[index] ?? 0) + passP * share;
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
  passedByInitiator: Float64Array,
  totalPassed: number,
  assisterWeightByPair: Array<number[] | undefined>,
): number[] {
  const perIndex = new Array<number>(team.players.length).fill(0);
  const shooterIndex = players.findIndex((player) => player.playerId === shooter.playerId);
  for (let initiatorIndex = 0; initiatorIndex < players.length; initiatorIndex += 1) {
    const share = (passedByInitiator[initiatorIndex] ?? 0) / Math.max(1e-9, totalPassed);
    if (share <= 0) continue;
    const initiator = players[initiatorIndex];
    if (initiator === undefined) continue;
    const pairKey = shooterIndex * players.length + initiatorIndex;
    let normalized = assisterWeightByPair[pairKey];
    if (normalized === undefined) {
      normalized = normalizedWeights(assisterWeights(team, shooter, initiator));
      assisterWeightByPair[pairKey] = normalized;
    }
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
