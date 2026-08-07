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
import {
  eraPossEstimatePerTrip,
  turnoverProbability,
} from '../sim/security.ts';
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

/** How many non-shooting foul checks the engine performs per trip. */
const NON_SHOOTING_FOUL_CHECKS = 4;

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

/** One (initiator, action, shooter, zone, defender) shot cell. */
interface ShotCell {
  initiatorIndex: number;
  shooterIndex: number;
  defenderIndex: number;
  zone: ShotZone;
  action: ActionType;
  /** Per-100-possession mass of the cell. */
  mass: number;
  /** Whether the shot came from a passed possession. */
  passed: boolean;
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
  const nsfPerTrip =
    1 - Math.pow(1 - nonShootingFoulProbability(profile), NON_SHOOTING_FOUL_CHECKS);

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
  const noTurnover = 1 - turnoverRate;
  const nonShootingFoulRate = noTurnover * nsfPerTrip;
  const shotMass = noTurnover * (1 - nsfPerTrip);

  // --- Shot cells ---
  const cells: ShotCell[] = [];
  const actionTotals: Record<string, number> = {};
  const zoneTotals: Record<string, number> = {};
  const shooterTotals = new Array<number>(players.length).fill(0);
  let passOpportunity = 0;

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
      const shooterShares = shooterSharesFor(
        players,
        initiatorIndex,
        action,
        teammateShots,
        passP,
      );
      for (let shooterIndex = 0; shooterIndex < players.length; shooterIndex += 1) {
        const shooterShare = shooterShares[shooterIndex] ?? 0;
        if (shooterShare <= 0) continue;
        const shooter = players[shooterIndex];
        if (shooter === undefined) continue;
        const zonePrep = prep.zonePrep.get(engineKey(shooter));
        if (zonePrep === undefined) continue;
        const zoneShares = normalizedWeights(applyZonePulls(action, zonePrep.base, zonePrep.driveRate));

        for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex += 1) {
          const zone = ZONES[zoneIndex];
          if (zone === undefined) continue;
          const zoneShare = zoneShares[zoneIndex] ?? 0;
          if (zoneShare <= 0) continue;
          const defenderProbs = defenderDistribution(opponentPrep, zone, shooterIndex);
          for (let defenderIndex = 0; defenderIndex < players.length; defenderIndex += 1) {
            const defenderShare = defenderProbs[defenderIndex] ?? 0;
            if (defenderShare <= 0) continue;
            const mass =
              shotMass * initiatorShare * actionShare * shooterShare * zoneShare * defenderShare;
            if (mass <= 0) continue;
            cells.push({
              initiatorIndex,
              shooterIndex,
              defenderIndex,
              zone,
              action,
              mass,
              passed: shooterIndex !== initiatorIndex,
            });
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

  const playerAgg = players.map(
    (): {
      shots: number;
      makes: number;
      points: number;
      turnovers: number;
      rebounds: number;
      fouls: number;
    } => ({ shots: 0, makes: 0, points: 0, turnovers: 0, rebounds: 0, fouls: 0 }),
  );
  const playerAssists = new Array<number>(players.length).fill(0);

  let qualityLiftTotal = 0;
  let contestTotal = 0;

  const offensiveRebounderShare = normalizedWeights(prep.rebounderWeights[0]);
  const defensiveRebounderShare = normalizedWeights(opponentPrep.rebounderWeights[1]);

  for (const cell of cells) {
    const shooter = players[cell.shooterIndex];
    const defender = players[cell.defenderIndex];
    if (shooter === undefined || defender === undefined) continue;
    const makeP = makeProbability(
      shooter,
      defender,
      profile,
      cell.zone,
      cell.action,
      REGULATION_START_SECONDS,
      shotPrepFor(prep, shooter),
    );
    const foulP = shootingFoulProbability(shooter, defender, cell.zone, profile);
    const blockP = blockProbability(defender, cell.zone, cell.action);
    const ftP = freeThrowProbability(shooter, profile);
    const ftCount = freeThrowsForZone(cell.zone);
    const makeGivenFoul = makeP * ENGINE_CONSTANTS.fouledShotMakeScale;
    const makeProb = foulP * makeGivenFoul + (1 - foulP) * (1 - blockP) * makeP;
    const missProb = 1 - makeProb;
    const blockProb = (1 - foulP) * blockP;
    const madeWithFoulProb = foulP * makeGivenFoul;
    const missedWithFoulProb = foulP * (1 - makeGivenFoul);
    const mass = cell.mass;
    const three = cell.zone === 'cornerThree' || cell.zone === 'aboveBreakThree';

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
    const orebP = offensiveReboundProbability(
      prep.offensiveReboundMean,
      opponentPrep.defensiveReboundMean,
      cell.zone,
      profile,
    );
    const missMass = mass * missProb;
    internal.offensiveReboundChances += missMass;
    internal.defensiveReboundChances += missMass;
    const liveOreb = missMass * orebP;
    internal.offensiveRebounds += liveOreb;
    internal.defensiveRebounds += missMass * (1 - orebP);

    // Rebounds on missed free throws: the last attempt (and the and-one) are
    // live rim rebounds; non-final attempts are dead-ball defensive team
    // rebounds folded into defensive rebounds.
    const rimOrebP = offensiveReboundProbability(
      prep.offensiveReboundMean,
      opponentPrep.defensiveReboundMean,
      'rim',
      profile,
    );
    const liveFtMiss = mass * (missedWithFoulProb + madeWithFoulProb) * (1 - ftP);
    internal.offensiveReboundChances += liveFtMiss;
    internal.defensiveReboundChances += liveFtMiss;
    internal.offensiveRebounds += liveFtMiss * rimOrebP;
    internal.defensiveRebounds += liveFtMiss * (1 - rimOrebP);
    internal.defensiveRebounds += mass * missedWithFoulProb * (ftCount - 1) * (1 - ftP);

    // Assists on made passed shots: expectation over the assister distribution.
    if (cell.passed) {
      const initiator = players[cell.initiatorIndex];
      const assisterProbs = assisterDistribution(side, shooter, initiator);
      let expectedAssists = 0;
      for (let passerIndex = 0; passerIndex < players.length; passerIndex += 1) {
        const passer = players[passerIndex];
        if (passer === undefined || passerIndex === cell.shooterIndex) continue;
        expectedAssists +=
          (assisterProbs[passerIndex] ?? 0) *
          assistProbabilityPure(
            profile,
            passingAnchorFactor,
            passer,
            cell.action,
            cell.zone,
            shooter,
          );
      }
      const assists = mass * makeProb * expectedAssists;
      internal.assists += assists;
      for (let passerIndex = 0; passerIndex < players.length; passerIndex += 1) {
        if (passerIndex === cell.shooterIndex) continue;
        playerAssists[passerIndex] =
          (playerAssists[passerIndex] ?? 0) + mass * makeProb * (assisterProbs[passerIndex] ?? 0);
      }
    }

    // Per-player aggregation.
    const agg = playerAgg[cell.shooterIndex];
    if (agg === undefined) continue;
    agg.shots += mass;
    agg.makes += mass * makeProb;
    agg.points += mass * (three ? 3 : 2) * makeProb + ftmMass;
    agg.fouls += mass * foulP;
    agg.rebounds += liveOreb * (offensiveRebounderShare[cell.shooterIndex] ?? 0);
    agg.rebounds +=
      missMass * (1 - orebP) * (defensiveRebounderShare[cell.shooterIndex] ?? 0);
    agg.rebounds +=
      liveFtMiss * rimOrebP * (offensiveRebounderShare[cell.shooterIndex] ?? 0);
    agg.rebounds +=
      liveFtMiss * (1 - rimOrebP) * (defensiveRebounderShare[cell.shooterIndex] ?? 0);

    qualityLiftTotal += mass * (three ? 0 : shotQualityBonus(cell.action, cell.zone));
    contestTotal += mass * -contestPenalty(defender, cell.zone);
  }

  // Per-player turnover attribution by initiator share.
  for (let index = 0; index < players.length; index += 1) {
    playerAgg[index]!.turnovers = (initiatorShares[index] ?? 0) * (turnoverRates[index] ?? 0) * 100;
  }

  const ledger: ProjectionLedger = {
    possessions: 100,
    turnoverRate,
    nonShootingFoulRate,
    shotRate: shotMass,
    fieldGoalAttempts: internal.fieldGoalAttempts,
    fieldGoalMakes: internal.fieldGoalMakes,
    twoPointAttempts: internal.twoPointAttempts,
    twoPointMakes: internal.twoPointMakes,
    threePointAttempts: internal.threePointAttempts,
    threePointMakes: internal.threePointMakes,
    freeThrowAttempts: internal.freeThrowAttempts,
    freeThrowMakes: internal.freeThrowMakes,
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
    points: internal.points,
    offensiveReboundRate: internal.offensiveRebounds / Math.max(1e-9, internal.offensiveReboundChances),
    defensiveReboundRate:
      internal.defensiveRebounds / Math.max(1e-9, internal.defensiveReboundChances),
    offensiveRebounds: internal.offensiveRebounds,
    defensiveRebounds: internal.defensiveRebounds,
    turnovers: internal.turnovers,
    assists: internal.assists,
    steals: internal.steals,
    blocks: internal.blocks,
    fouls: internal.fouls,
    secondChancePoints:
      internal.points *
      (Math.min(1 / Math.max(1e-9, 1 - ledgerOrebRate(internal)), 4) - 1),
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
      ACTION_TYPES.map((action) => [action, (actionTotals[action] ?? 0) / Math.max(1e-9, shotMass)]),
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
      expectedShots: playerAgg[index]!.shots,
      expectedMakes: playerAgg[index]!.makes,
      expectedPoints: playerAgg[index]!.points,
      expectedAssists: playerAssists[index] ?? 0,
      expectedTurnovers: playerAgg[index]!.turnovers,
      expectedRebounds: playerAgg[index]!.rebounds,
      expectedFouls: playerAgg[index]!.fouls,
      defensiveContribution: defensiveContributionOf(player),
    })),
    aggregateMakePct:
      internal.fieldGoalAttempts > 0 ? internal.fieldGoalMakes / internal.fieldGoalAttempts : 0,
    passOpportunity,
    shotQualityLift: qualityLiftTotal / Math.max(1e-9, shotMass),
    expectedContest: contestTotal / Math.max(1e-9, shotMass),
  };
}

function ledgerOrebRate(internal: LedgerInternal): number {
  return internal.offensiveRebounds / Math.max(1e-9, internal.offensiveReboundChances);
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
  teammateShots: { roll: { teammates: SimulationPlayer[]; weights: number[] }; pass: { teammates: SimulationPlayer[]; weights: number[] } } | undefined,
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
 * Assister probability per team index for one made basket: the `pickAssister`
 * weight formula normalized over the four non-shooter candidates.
 */
function assisterDistribution(
  team: SimulationTeam,
  shooter: SimulationPlayer,
  initiator: SimulationPlayer | undefined,
): number[] {
  const weights = assisterWeights(team, shooter, initiator ?? shooter);
  const normalized = normalizedWeights(weights);
  const perIndex = new Array<number>(team.players.length).fill(0);
  let candidateIndex = 0;
  for (let index = 0; index < team.players.length; index += 1) {
    if (team.players[index]?.playerId === shooter.playerId) continue;
    perIndex[index] = normalized[candidateIndex] ?? 0;
    candidateIndex += 1;
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
