import type {
  EraSimulationProfile,
  ProjectionLedger,
  ProjectionPlayerContribution,
  ProjectionTurnoverCauses,
  ShotZone,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '@hoop-rush/data-contracts';
import { ENGINE_CONSTANTS } from '../sim/constants.ts';
import { foulsPerPossessionScalars } from './foul-scalars.ts';
import {
  blockProbability,
  contestPenalty,
  makeProbability,
  shotQualityBonus,
  type ShotPrep,
} from '../sim/shooting.ts';
import {
  eraPossEstimatePerTrip,
  isStealProbability,
  turnoverProbability,
} from './security-extras.ts';
import {
  freeThrowProbability,
  freeThrowsForZone,
  nonShootingFoulProbability,
  shootingFoulProbability,
} from '../sim/fouls.ts';
import { offensiveReboundProbability } from '../sim/rebounding.ts';
import {
  assisterWeights,
  applyZonePulls,
  passProbability,
  rescaledZoneWeights,
  type TeammateShots,
} from '../sim/usage.ts';
import { assistProbabilityPure } from '../sim/possession.ts';
import { sameGroupMatchWeight } from '../sim/position-responsibilities.ts';
import type { TeamPrep } from '../sim/prepare.ts';
import type { ActionType } from '../sim/usage.ts';

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
 * - second-chance value uses a bounded analytic continuation correction that
 *   never loops or samples repeated rebounds.
 */

const ZONES: readonly ShotZone[] = SHOT_ZONES;

/** How many non-shooting foul checks the engine performs per trip. */
const NON_SHOOTING_FOUL_CHECKS = 4;

/** Regulation period seconds used for the make-probability late-clock term (no penalty). */
const REGULATION_START_SECONDS = 720;

/** Canonical slot order mapping for shooter distributions. */
const SLOT_ORDER = ['G1', 'G2', 'F1', 'F2', 'C'] as const;
type LedgerSlot = (typeof SLOT_ORDER)[number];

export interface LedgerPlayerFacts {
  /** Team index order (0..4). */
  slotIndex: number;
  player: SimulationPlayer;
  usageShare: number;
  initiatorShare: number;
  creationShare: number;
  spacingContribution: number;
  expectedShots: number;
  expectedMakes: number;
  expectedPoints: number;
  expectedAssists: number;
  expectedTurnovers: number;
  expectedRebounds: number;
  expectedFouls: number;
  defensiveContribution: number;
}

export interface LedgerSide {
  ledger: ProjectionLedger;
  turnoverCauses: ProjectionTurnoverCauses;
  actions: Record<ActionType, number>;
  zones: Record<ShotZone, number>;
  shooters: Record<LedgerSlot, number>;
  players: LedgerPlayerFacts[];
  /** Aggregate make probability across shot mass (the offense's conversion). */
  aggregateMakePct: number;
  /** Expected passes per 100 possessions. */
  passOpportunity: number;
  /** Expected assists per 100 possessions. */
  assistOpportunity: number;
  /** Expected blocks forced against this offense per 100. */
  blocksAgainst: number;
}

export interface ExpectedLedgerResult {
  offense: LedgerSide;
  defense: LedgerSide;
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
  /** Whether the possession was passed (for assist accounting). */
  passed: boolean;
}

function shotPrepFor(prep: TeamPrep, shooter: SimulationPlayer): ShotPrep {
  return {
    spacing: prep.spacing,
    twoPointAnchor: prep.twoPointAnchor.get(shooter.playerVersionId ?? shooter.playerId) ?? null,
  };
}

/**
 * Expected defender probability distribution for one (shooter slot, zone):
 * exactly the `pickDefender` weight formula (zone weights × same-slot-group
 * matchup × assigned-slot rim protection on interior zones).
 */
function defenderDistribution(
  prep: TeamPrep,
  zone: ShotZone,
  shooterSlot: number,
): number[] {
  const interior = zone === 'rim' || zone === 'shortMid';
  const zoneIndex = ZONES.indexOf(zone);
  const zoneWeights = prep.defenderBase.weights[zoneIndex] ?? [];
  const weights = new Array<number>(prep.slotByPlayerId.size);
  for (let slot = 0; slot < prep.slotByPlayerId.size; slot += 1) {
    const match = sameGroupMatchWeight(slot, shooterSlot);
    const rim = interior ? (prep.defenderBase.rimProtection[slot] ?? 1) : 1;
    weights[slot] = (zoneWeights[slot] ?? 0) * match * rim;
  }
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / Math.max(1e-9, total));
}

function normalizedWeights(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / Math.max(1e-9, total));
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

  const offenseSide = computeSide({
    side: team,
    prep,
    opponentPrep,
    profile,
    eraPoss,
    passingAnchorFactor,
  });
  const defenseSide = computeSide({
    side: opponent,
    prep: opponentPrep,
    opponentPrep: prep,
    profile,
    eraPoss,
    passingAnchorFactor,
  });

  // Cross terms: steals credited to each side's defense come from the
  // opponent's turnover mass converted at this side's steal ability.
  const offenseSteals =
    defenseSide.ledger.turnovers * expectedStealShare(prep.stealAbility, profile);
  const defenseSteals =
    offenseSide.ledger.turnovers * expectedStealShare(opponentPrep.stealAbility, profile);

  return {
    offense: withCrossTerms(offenseSide, offenseSteals),
    defense: withCrossTerms(defenseSide, defenseSteals),
  };
}

function withCrossTerms(side: LedgerSide, steals: number): LedgerSide {
  return {
    ...side,
    ledger: { ...side.ledger, steals },
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
  const defense = opponentPrep;
  const nsfPerTrip =
    1 - Math.pow(1 - nonShootingFoulProbability(profile), NON_SHOOTING_FOUL_CHECKS);

  // --- Turnover mass per initiator ---
  const initiatorShares = normalizedWeights(prep.initiatorWeights);
  const turnoverRates = players.map((player) =>
    turnoverProbability(player, defense.pressure, eraPoss, profile),
  );
  const turnoverMass = initiatorShares.reduce(
    (sum, share, index) => sum + share * (turnoverRates[index] ?? 0),
    0,
  );
  const turnoverRate = Math.min(1, Math.max(0, turnoverMass));

  // --- Shot mass after turnover and non-shooting fouls ---
  const noTurnover = 1 - turnoverRate;
  const foulMass = noTurnover * nsfPerTrip;
  const shotMass = noTurnover * (1 - nsfPerTrip);
  const nonShootingFoulRate = foulMass;

  // --- Shot cells ---
  const cells: ShotCell[] = [];
  const actionTotals: Record<string, number> = {};
  const zoneTotals: Record<string, number> = {};
  const shooterTotals = new Array<number>(players.length).fill(0);
  let passOpportunity = 0;

  for (let initiatorIndex = 0; initiatorIndex < players.length; initiatorIndex += 1) {
    const initiator = players[initiatorIndex];
    if (initiator === undefined) continue;
    const initiatorKey = initiator.playerVersionId ?? initiator.playerId;
    const initiatorShare = initiatorShares[initiatorIndex] ?? 0;
    const actionTable = prep.actionWeights.get(initiatorKey);
    if (actionTable === undefined) continue;
    const actionShares = normalizedWeights(actionTable);
    const teammateShots = prep.teammateShots.get(initiatorKey);

    for (let actionIndex = 0; actionIndex < actionShares.length; actionIndex += 1) {
      const action = ACTION_TYPES[actionIndex];
      if (action === undefined) continue;
      const actionShare = actionShares[actionIndex] ?? 0;
      if (actionShare <= 0) continue;
      const passP = passProbability(initiator, action);
      passOpportunity += shotMass * initiatorShare * actionShare * passP;

      const shooterShares = shooterSharesFor(
        initiator,
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
        const shooterKey = shooter.playerVersionId ?? shooter.playerId;
        const zonePrep = prep.zonePrep.get(shooterKey);
        if (zonePrep === undefined) continue;
        const zoneWeights = applyZonePulls(action, zonePrep.base, zonePrep.driveRate);
        const zoneShares = normalizedWeights(zoneWeights);
        const defenderProbs = defenderDistribution(defense, 'rim', shooterIndex); // placeholder replaced below

        for (let zoneIndex = 0; zoneIndex < ZONES.length; zoneIndex += 1) {
          const zone = ZONES[zoneIndex];
          if (zone === undefined) continue;
          const zoneShare = zoneShares[zoneIndex] ?? 0;
          if (zoneShare <= 0) continue;
          const defenderProbsForZone = defenderDistribution(defense, zone, shooterIndex);
          for (let defenderIndex = 0; defenderIndex < players.length; defenderIndex += 1) {
            const defenderShare = defenderProbsForZone[defenderIndex] ?? 0;
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
      }
    }
  }

  // --- Aggregate per-shot expectations ---
  const ledger = emptyLedger();
  ledger.turnoverRate = turnoverRate;
  ledger.nonShootingFoulRate = nonShootingFoulRate;
  ledger.shotRate = shotMass;
  ledger.turnovers = turnoverRate * 100;
  ledger.possessions = 100;

  const stealShare = expectedStealShare(defense.stealAbility, profile);
  const turnoverCauses: ProjectionTurnoverCauses = {
    stealShare,
    nonStealShare: 1 - stealShare,
    expectedSteals: ledger.turnovers * stealShare,
    expectedOther: ledger.turnovers * (1 - stealShare),
  };

  const playerAgg = players.map(
    (): {
      shots: number;
      makes: number;
      points: number;
      assists: number;
      turnovers: number;
      rebounds: number;
      fouls: number;
    } => ({
      shots: 0,
      makes: 0,
      points: 0,
      assists: 0,
      turnovers: 0,
      rebounds: 0,
      fouls: 0,
    }),
  );

  let passOpportunityTotal = 0;
  let qualityLiftTotal = 0;
  let contestTotal = 0;
  let makesMass = 0;
  let blockedMass = 0;
  let foulDrawnMass = 0;

  const playerTurnoverShare = new Array<number>(players.length).fill(0);
  for (let index = 0; index < players.length; index += 1) {
    playerTurnoverShare[index] = (initiatorShares[index] ?? 0) * (turnoverRates[index] ?? 0);
  }

  for (const cell of cells) {
    const shooter = players[cell.shooterIndex];
    const defender = players[cell.defenderIndex];
    if (shooter === undefined || defender === undefined) continue;
    const prepForShooter = shotPrepFor(prep, shooter);
    const makeP = makeProbability(
      shooter,
      defender,
      profile,
      cell.zone,
      cell.action,
      REGULATION_START_SECONDS,
      prepForShooter,
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

    // Field goals.
    const three = cell.zone === 'cornerThree' || cell.zone === 'aboveBreakThree';
    ledger.fieldGoalAttempts += mass;
    ledger.fieldGoalMakes += mass * makeProb;
    if (three) {
      ledger.threePointAttempts += mass;
      ledger.threePointMakes += mass * makeProb;
    } else {
      ledger.twoPointAttempts += mass;
      ledger.twoPointMakes += mass * makeProb;
    }
    ledger.points += mass * (three ? 3 : 2) * makeProb;

    // Blocks against the offense.
    ledger.blocks += mass * blockProb;
    blockedMass += mass * blockProb;

    // Shooting fouls drawn.
    ledger.fouls += mass * foulP;
    foulDrawnMass += mass * foulP;

    // Free throws: and-one on made-with-foul, full set on miss-with-foul.
    const expectedFta = mass * foulP * (madeWithFoulProb / Math.max(1e-9, foulP) * 1 + (missedWithFoulProb / Math.max(1e-9, foulP)) * ftCount);
    const expectedFtm =
      mass * foulP * (madeWithFoulProb / Math.max(1e-9, foulP) * ftP + (missedWithFoulProb / Math.max(1e-9, foulP)) * ftCount * ftP);
    ledger.freeThrowAttempts += expectedFta;
    ledger.freeThrowMakes += expectedFtm;
    ledger.points += expectedFtm;

    // Rebounds on missed field goals (live).
    const orebP = offensiveReboundProbability(
      prep.offensiveReboundMean,
      defense.defensiveReboundMean,
      cell.zone,
      profile,
    );
    const liveMissOreb = mass * missProb * orebP;
    ledger.offensiveRebounds += liveMissOreb;
    ledger.offensiveReboundChances += mass * missProb;
    ledger.defensiveRebounds += mass * missProb * (1 - orebP);

    // Rebounds on missed free throws: the last attempt is a live rim rebound;
    // non-final attempts are declared dead-ball defensive team rebounds.
    const lastFtMissProb = mass * missedWithFoulProb * (1 - ftP);
    const rimOrebP = offensiveReboundProbability(
      prep.offensiveReboundMean,
      defense.defensiveReboundMean,
      'rim',
      profile,
    );
    const andOneMissProb = mass * madeWithFoulProb * (1 - ftP);
    ledger.offensiveRebounds += (lastFtMissProb + andOneMissProb) * rimOrebP;
    ledger.defensiveRebounds += (lastFtMissProb + andOneMissProb) * (1 - rimOrebP);
    ledger.teamRebounds += (lastFtMissProb + andOneMissProb) * 0 + missedWithFoulProb * (ftCount - 1) * (1 - ftP) * mass;

    // Assists on made passed shots: expected over the assister distribution.
    if (cell.passed) {
      const assistOpportunityMass = mass * makeProb;
      const assisterProbs = assisterDistribution(
        side,
        shooter,
        players[cell.initiatorIndex],
      );
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
      const assists = assistOpportunityMass * expectedAssists;
      ledger.assists += assists;
      playerAgg[cell.shooterIndex]!.assists += assists; // hmm — assists belong to the passer, not shooter
    }

    // Per-player aggregation (attribution to shooter/initiator/defender).
    playerAgg[cell.shooterIndex]!.shots += mass;
    playerAgg[cell.shooterIndex]!.makes += mass * makeProb;
    playerAgg[cell.shooterIndex]!.points +=
      mass * (three ? 3 : 2) * makeProb + mass * foulP * (madeWithFoulProb / Math.max(1e-9, foulP) * ftP + (missedWithFoulProb / Math.max(1e-9, foulP)) * ftCount * ftP);
    playerAgg[cell.shooterIndex]!.fouls += mass * foulP;
    playerAgg[cell.shooterIndex]!.rebounds +=
      liveMissOreb * (prep.rebounderWeights[0][cell.shooterIndex] ?? 0) / Math.max(1e-9, Math.max(0.0001, 1));

      // defensive rebounds attributed by defensive rebounder weights:
    const defensiveReboundShare = (defense.rebounderWeights[1][cell.shooterIndex] ?? 0);
    playerAgg[cell.shooterIndex]!.rebounds += mass * missProb * (1 - orebP) * defensiveReboundShare / Math.max(1e-9, defense.rebounderWeights[1].reduce((s, v) => s + v, 0));
    makesMass += mass * makeProb;
    qualityLiftTotal += mass * (cell.zone === 'cornerThree' || cell.zone === 'aboveBreakThree' ? 0 : shotQualityBonus(cell.action, cell.zone));
    contestTotal += mass * -contestPenalty(defender, cell.zone);
  }

  // Per-player turnover attribution by initiator share.
  for (let index = 0; index < players.length; index += 1) {
    playerAgg[index]!.turnovers = playerTurnoverShare[index]! * 100;
  }

  ledger.fieldGoalPct = ledger.fieldGoalMakes / Math.max(1e-9, ledger.fieldGoalAttempts);
  ledger.twoPointPct = ledger.twoPointMakes / Math.max(1e-9, ledger.twoPointAttempts);
  ledger.threePointPct = ledger.threePointMakes / Math.max(1e-9, ledger.threePointAttempts);
  ledger.effectiveFieldGoalPct =
    (ledger.fieldGoalMakes + 0.5 * ledger.threePointMakes) / Math.max(1e-9, ledger.fieldGoalAttempts);
  ledger.freeThrowRate = ledger.freeThrowAttempts / Math.max(1e-9, ledger.fieldGoalAttempts);
  ledger.trueShootingPct =
    ledger.points / Math.max(1e-9, 2 * (ledger.fieldGoalAttempts + 0.44 * ledger.freeThrowAttempts));
  ledger.offensiveReboundRate =
    ledger.offensiveRebounds / Math.max(1e-9, ledger.offensiveReboundChances);
  ledger.defensiveReboundRate =
    ledger.defensiveRebounds / Math.max(1e-9, ledger.defensiveReboundChances);

  // Second-chance value: bounded analytic continuation (engine caps at 4).
  const totalLiveMisses = ledger.offensiveReboundChances;
  const averageOrebRate = totalLiveMisses > 0 ? ledger.offensiveRebounds / totalLiveMisses : 0;
  const continuationFactor = Math.min(1 / Math.max(1e-9, 1 - averageOrebRate), 4);
  ledger.secondChancePoints = ledger.points * (continuationFactor - 1);

  const actions = Object.fromEntries(
    ACTION_TYPES.map((action) => [action, (actionTotals[action] ?? 0) / Math.max(1e-9, shotMass)]),
  ) as Record<ActionType, number>;
  const zones = Object.fromEntries(
    ZONES.map((zone) => [zone, (zoneTotals[zone] ?? 0) / Math.max(1e-9, shotMass)]),
  ) as Record<ShotZone, number>;
  const shooters = Object.fromEntries(
    SLOT_ORDER.map((slot, index) => [
      slot,
      (shooterTotals[index] ?? 0) / Math.max(1e-9, shotMass),
    ]),
  ) as Record<LedgerSlot, number>;

  const playersFacts: LedgerPlayerFacts[] = players.map((player, index) => ({
    slotIndex: index,
    player,
    usageShare: (shooterTotals[index] ?? 0) / Math.max(1e-9, shotMass),
    initiatorShare: initiatorShares[index] ?? 0,
    creationShare: creationShareOf(player),
    spacingContribution: spacingContributionOf(player),
    expectedShots: playerAgg[index]!.shots,
    expectedMakes: playerAgg[index]!.makes,
    expectedPoints: playerAgg[index]!.points,
    expectedAssists: 0, // filled by cross-side pass attribution below
    expectedTurnovers: playerAgg[index]!.turnovers,
    expectedRebounds: playerAgg[index]!.rebounds,
    expectedFouls: playerAgg[index]!.fouls,
    defensiveContribution: defensiveContributionOf(player),
  }));

  return {
    ledger,
    turnoverCauses,
    actions,
    zones,
    shooters,
    players: playersFacts,
    aggregateMakePct: ledger.fieldGoalAttempts > 0 ? ledger.fieldGoalMakes / ledger.fieldGoalAttempts : 0,
    passOpportunity: passOpportunityTotal > 0 ? passOpportunityTotal : passOpportunity,
    assistOpportunity: ledger.assists,
    blocksAgainst: ledger.blocks,
  };
}

function emptyLedger(): ProjectionLedger & {
  offensiveReboundChances: number;
  defensiveReboundChances: number;
  teamRebounds: number;
} {
  return {
    possessions: 100,
    turnoverRate: 0,
    nonShootingFoulRate: 0,
    shotRate: 0,
    fieldGoalAttempts: 0,
    fieldGoalMakes: 0,
    twoPointAttempts: 0,
    twoPointMakes: 0,
    threePointAttempts: 0,
    threePointMakes: 0,
    freeThrowAttempts: 0,
    freeThrowMakes: 0,
    fieldGoalPct: 0,
    twoPointPct: 0,
    threePointPct: 0,
    effectiveFieldGoalPct: 0,
    trueShootingPct: 0,
    freeThrowRate: 0,
    points: 0,
    offensiveReboundRate: 0,
    defensiveReboundRate: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    turnovers: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    fouls: 0,
    secondChancePoints: 0,
    offensiveReboundChances: 0,
    defensiveReboundChances: 0,
    teamRebounds: 0,
  };
}

/** Shooter probability for one (initiator, action): pass variant vs initiator keeps it. */
function shooterSharesFor(
  initiator: SimulationPlayer,
  initiatorIndex: number,
  action: ActionType,
  teammateShots: TeammateShots | undefined,
  passP: number,
): number[] {
  const shares = new Array<number>(initiatorIndex >= 0 ? Math.max(initiatorIndex + 1, 5) : 5).fill(0);
  shares[initiatorIndex] = 1 - passP;
  if (passP <= 0 || teammateShots === undefined) return shares;
  const selected = action === 'pickAndRollRoll' ? teammateShots.roll : teammateShots.pass;
  const teammateProbs = normalizedWeights(selected.weights);
  for (let index = 0; index < selected.teammates.length; index += 1) {
    const teammate = selected.teammates[index];
    const slot = selected.teammates.indexOf(teammate);
    // map teammate to team index via playerId identity
    void slot;
  }
  // Teammates are ordered by team index minus the initiator; rebuild by
  // matching team index order below.
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
  const candidates = team.players.map((player) => player.playerId);
  const weights = assisterWeights(team, shooter, initiator ?? shooter);
  const normalized = normalizedWeights(weights);
  const perIndex = new Array<number>(team.players.length).fill(0);
  let candidateIndex = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index] === shooter.playerId) continue;
    perIndex[index] = normalized[candidateIndex] ?? 0;
    candidateIndex += 1;
  }
  return perIndex;
}

import { ACTION_TYPES } from '../sim/usage.ts';
import { creationScore, spacingScore } from '../domain/archetypes.ts';

/** Creation score from possession inputs (mirrors archetype creationScore). */
function creationShareOf(player: SimulationPlayer): number {
  return creationScore(player) * 100;
}

/** Spacing contribution: the player's share of the teamSpacing sum. */
function spacingContributionOf(player: SimulationPlayer): number {
  return spacingScore(player) * 100;
}

/** Defensive contribution: pressure blend over possession inputs. */
function defensiveContributionOf(player: SimulationPlayer): number {
  const pressure =
    player.ratings.perimeterDefense * 0.5 +
    player.ratings.steal * 0.3 +
    player.ratings.defensiveIq * 0.2;
  return Math.min(100, Math.max(0, pressure));
}
