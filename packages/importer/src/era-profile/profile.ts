/**
 * Era simulation profile derivation (port of scripts/import-nba/compute_era_sim_profile.py).
 *
 * Each profile is derived from the era's raw packaged season data
 * (`raw-data/nba/<season>/stints.json` per season), plus the packaged Lakers pool
 * for that era, which provides population anchor ratings and shot-mix priors.
 *
 * Field families that the era's league evidence does not publish (rebound
 * splits before 1973-74, turnovers before 1977-78, threes before 1979-80)
 * never become zero-filled aggregates: their parameters are estimated from
 * documented league rules or priors and carry their own provenance (spec/12).
 *
 * Targets are emitted as initial estimates from the same source aggregates with
 * wide tolerances; the calibration baseline freezes the final gates.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NBA_ROOT, PUBLIC_DATA } from '../config.ts';
import { readJson } from '../json.ts';
import { deriveLeagueAggregates, type LeagueAggregates } from './aggregates.ts';
import { poolShotMixAndAnchors, type ZoneMix } from './shot-mix.ts';
import { getEra } from '../ratings/era.ts';
import {
  DERIVATION_METHOD_VERSION,
  SOURCE_VERSION,
  type ProvenanceKind,
} from '@hoop-rush/data-contracts';

export const ESTIMATE_TO_TRIPS_FACTOR = 0.93;
// Engine conversion from the league possessions-per-game estimate to the
// real trip rate the box scores account (engine constant `estimateToTripsFactor`).
export const PROFILE_VERSION_PREFIX = 'm3';
export const ERA_PROFILE_DATA_VERSION = 'm3.5';
export const ERA_SIM_DIR = join(PUBLIC_DATA, 'era-sim');

/** Documented estimates for families the league did not publish (spec/12). */
export const ERA_RULE_ESTIMATES = {
  /** League turnovers per possession before turnover tracking (1977-78). */
  turnoverPerPossessionBeforeTracking: 0.17,
  /** League steals share of turnovers before tracking. */
  stealShareBeforeTracking: 0.3,
  /** League offensive rebound rate before rebound splits (1973-74). */
  offensiveReboundRateBeforeSplits: 0.28,
  /** Share of personal fouls that are shooting fouls (not derivable from box scores). */
  shootingFoulShare: 0.55,
  /** Free-throw anchor when no pool exists for the era. */
  defaultFreeThrowAnchor: 74,
  /** Assist anchor when no pool exists for the era. */
  defaultAssistAnchor: 70,
} as const;

export interface EraDef {
  eraId: string;
  label?: string;
  fromSeasonKey: string;
  toSeasonKey: string;
}

export interface CalibrationTarget {
  value: number;
  tolerance: number;
  minimumSample: number;
}

export interface ParameterProvenance {
  kind: ProvenanceKind;
  confidence: 'high' | 'medium' | 'low';
  methodVersion: string;
  sourceVersion: string;
  sourceFields: string[];
  sourceStatus?: 'available' | 'unavailable' | 'not-applicable';
  notesCode?: string;
}

export interface EraSimParameters {
  pace: number;
  league3PARate: number;
  leagueTsPct: number;
  leagueFtaPerFga: number;
  leagueFtPct: number;
  turnoverPerPossession: number;
  stealShareOfTurnovers: number;
  offensiveReboundRate: number;
  assistRate: number;
  foulsPerPossession: number;
  shootingFoulShare: number;
  freeThrowAnchorRating: number;
  assistAnchorRating: number;
  zoneMix: ZoneMix;
  source: string;
  parameterProvenance?: Record<string, ParameterProvenance>;
}

export interface EraProfileTargets {
  possessionsPerGame: CalibrationTarget;
  pointsPerGame: CalibrationTarget;
  offensiveRating: CalibrationTarget;
  fieldGoalPct: CalibrationTarget;
  efgPct: CalibrationTarget;
  tsPct: CalibrationTarget;
  threePointRate: CalibrationTarget;
  threePointPct: CalibrationTarget;
  freeThrowsAttemptedPerGame: CalibrationTarget;
  freeThrowPct: CalibrationTarget;
  turnoversPerGame: CalibrationTarget;
  turnoversPerPossession: CalibrationTarget;
  offensiveReboundsPerGame: CalibrationTarget;
  offensiveReboundRate: CalibrationTarget;
  assistsPerGame: CalibrationTarget;
  assistRate: CalibrationTarget;
  personalFoulsPerGame: CalibrationTarget;
  zoneMix: Record<
    'rim' | 'shortMid' | 'longMid' | 'cornerThree' | 'aboveBreakThree',
    CalibrationTarget
  >;
  closeGameRate: CalibrationTarget;
  blowoutRate: CalibrationTarget;
  overtimeRate: CalibrationTarget;
  strongVsWeakWinRate: CalibrationTarget;
  equalLineupHomeWinRate: CalibrationTarget;
}

export interface EraSimProfile {
  schemaVersion: 1;
  eraId: string;
  profileVersion: string;
  dataVersion: string;
  seasons: string[];
  baselineReport: string;
  parameters: EraSimParameters;
  targets: EraProfileTargets;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export function target(value: number, tolerance: number, minimumSample = 200): CalibrationTarget {
  return { value: round4(value), tolerance, minimumSample };
}

/** Season keys with packaged data under raw-data/nba, sorted. */
export function packagedSeasons(): string[] {
  return readdirSync(NBA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        existsSync(join(NBA_ROOT, name, 'stints.json')) ||
        existsSync(join(NBA_ROOT, name, 'roster.json')),
    )
    .sort();
}

/** Packaged seasons that fall inside the era's documented season range. */
export function eraSeasons(era: EraDef): string[] {
  return packagedSeasons().filter(
    (season) => era.fromSeasonKey <= season && season <= era.toSeasonKey,
  );
}

/** Every era from the packaged manifest that has at least one packaged season. */
export function erasWithData(): EraDef[] {
  const manifest = readJson(join(PUBLIC_DATA, 'manifest.json')) as { eras: EraDef[] };
  return manifest.eras.filter((era) => eraSeasons(era).length > 0);
}

/** Provenance for a parameter produced from fully observed league evidence. */
function derivedProvenance(fields: string[]): ParameterProvenance {
  return {
    kind: 'derived',
    confidence: 'medium',
    methodVersion: DERIVATION_METHOD_VERSION,
    sourceVersion: SOURCE_VERSION,
    sourceFields: fields,
  };
}

/** Provenance for a parameter estimated from a documented league rule or prior. */
function estimatedProvenance(
  fields: string[],
  sourceStatus: 'unavailable' | 'not-applicable' | 'available' = 'unavailable',
  notesCode?: string,
): ParameterProvenance {
  return {
    kind: 'estimated',
    confidence: 'low',
    methodVersion: DERIVATION_METHOD_VERSION,
    sourceVersion: SOURCE_VERSION,
    sourceFields: fields,
    sourceStatus,
    notesCode,
  };
}

/** Provenance for a league-rule value (e.g. no three-point line before 1979-80). */
function ruleProvenance(fields: string[], notesCode: string): ParameterProvenance {
  return {
    kind: 'derived',
    confidence: 'high',
    methodVersion: DERIVATION_METHOD_VERSION,
    sourceVersion: SOURCE_VERSION,
    sourceFields: fields,
    sourceStatus: 'not-applicable',
    notesCode,
  };
}

function eraRulePace(season: string): number {
  return getEra(season).pace;
}

export function computeEraProfile(era: EraDef): EraSimProfile {
  const eraId = era.eraId;
  const seasons = eraSeasons(era);
  if (seasons.length === 0) {
    throw new Error(`no packaged seasons for era ${eraId}`);
  }

  const a: LeagueAggregates = deriveLeagueAggregates(seasons);
  const threeRate = a.tpa !== null ? a.tpa / Math.max(1.0, a.fga) : 0;
  const parameterProvenance: Record<string, ParameterProvenance> = {};

  // Zone mix and anchors come from the packaged Lakers pool when available;
  // otherwise documented defaults (estimated). Three-point shares normalize
  // to the league 3PA rate (0 before 1979-80 by league rule).
  let mix: ZoneMix;
  let ftAnchor: number;
  let passAnchor: number;
  let anchorKind: ParameterProvenance;
  try {
    const anchors = poolShotMixAndAnchors(eraId, threeRate);
    mix = anchors.mix;
    ftAnchor = anchors.ftAnchor;
    passAnchor = anchors.passAnchor;
    anchorKind = derivedProvenance(['lakers-pool', 'stints']);
  } catch {
    const era = getEra(seasons[0] as string);
    const twoShare = 1 - threeRate;
    mix = {
      rim: round4(twoShare * 0.46),
      shortMid: round4(twoShare * 0.25),
      longMid: round4(twoShare * 0.29),
      cornerThree: round4(threeRate * 0.35),
      aboveBreakThree: round4(threeRate * 0.65),
    };
    ftAnchor = ERA_RULE_ESTIMATES.defaultFreeThrowAnchor;
    passAnchor = ERA_RULE_ESTIMATES.defaultAssistAnchor;
    void era;
    anchorKind = estimatedProvenance(['prior'], 'unavailable', 'no-packaged-pool');
  }

  const paceRaw = a.possessions !== null ? a.possessions / a.teamGames : null;
  const pace = paceRaw !== null ? paceRaw : eraRulePace(seasons[0] as string);
  const tripPace = pace * ESTIMATE_TO_TRIPS_FACTOR;
  const ppg = a.points / a.teamGames;
  const standardPossessions = a.fga + 0.44 * a.fta;
  const tsPct =
    a.possessions !== null
      ? a.points / (2.0 * a.possessions)
      : a.points / (2.0 * standardPossessions);
  const fgPct = a.fgm / Math.max(1.0, a.fga);
  const efgPct = a.tpm !== null ? (a.fgm + 0.5 * a.tpm) / Math.max(1.0, a.fga) : fgPct;
  const threePct = a.tpm !== null && a.tpa !== null ? a.tpm / Math.max(1.0, a.tpa) : 0;
  const ftaPerFga = a.fta / Math.max(1.0, a.fga);
  const ftPct = a.ftm / Math.max(1.0, a.fta);
  // Ratio families derive over their common-support seasons (spec/12):
  // mixed-support eras (steals from 1973-74, turnovers from 1977-78) never
  // distort a ratio; absent support falls back to documented estimates.
  const tovPerPoss =
    a.pairs.turnoverPerPossession !== null
      ? a.pairs.turnoverPerPossession.tov / Math.max(1.0, a.pairs.turnoverPerPossession.possessions)
      : null;
  const tovPerTrip = tovPerPoss !== null ? tovPerPoss / ESTIMATE_TO_TRIPS_FACTOR : null;
  const stealShare =
    a.pairs.stealShare !== null && a.pairs.stealShare.tov > 0
      ? a.pairs.stealShare.stl / a.pairs.stealShare.tov
      : null;
  const orebRate =
    a.pairs.reboundSplit !== null
      ? a.pairs.reboundSplit.oreb /
        Math.max(1.0, a.pairs.reboundSplit.oreb + a.pairs.reboundSplit.dreb)
      : null;
  const assistRate = a.ast / Math.max(1.0, a.fgm);
  const foulsPerPoss =
    a.possessions !== null
      ? a.pf / Math.max(1.0, a.possessions)
      : a.pf / Math.max(1.0, standardPossessions);
  const orebPerGame = a.oreb !== null ? a.oreb / a.teamGames : null;
  const astPerGame = a.ast / a.teamGames;
  const tovPerGame = a.tov !== null ? a.tov / a.teamGames : null;
  const ftaPerGame = a.fta / a.teamGames;
  const pfPerGame = a.pf / a.teamGames;

  // Parameter provenance (spec/12): estimated inputs are explicit.
  parameterProvenance['pace'] =
    paceRaw !== null
      ? derivedProvenance(['fga', 'fta', 'oreb', 'tov'])
      : estimatedProvenance(['prior']);
  parameterProvenance['league3PARate'] =
    a.tpa !== null
      ? derivedProvenance(['tpa', 'fga'])
      : ruleProvenance(['prior'], 'league-rule-no-three-point-line');
  parameterProvenance['leagueTsPct'] = derivedProvenance(['points', 'fga', 'fta', 'oreb', 'tov']);
  parameterProvenance['leagueFtaPerFga'] = derivedProvenance(['fta', 'fga']);
  parameterProvenance['leagueFtPct'] = derivedProvenance(['ftm', 'fta']);
  parameterProvenance['turnoverPerPossession'] =
    tovPerPoss !== null
      ? derivedProvenance(['tov', 'possessions'])
      : estimatedProvenance(['prior']);
  parameterProvenance['stealShareOfTurnovers'] =
    stealShare !== null ? derivedProvenance(['stl', 'tov']) : estimatedProvenance(['prior']);
  parameterProvenance['offensiveReboundRate'] =
    orebRate !== null ? derivedProvenance(['oreb', 'dreb']) : estimatedProvenance(['prior']);
  parameterProvenance['assistRate'] = derivedProvenance(['ast', 'fgm']);
  parameterProvenance['foulsPerPossession'] = derivedProvenance(['pf', 'possessions']);
  parameterProvenance['shootingFoulShare'] = estimatedProvenance(
    ['prior'],
    'unavailable',
    'not-derivable-from-box-scores',
  );
  parameterProvenance['freeThrowAnchorRating'] = anchorKind;
  parameterProvenance['assistAnchorRating'] = anchorKind;
  parameterProvenance['zoneMix'] =
    a.tpa !== null
      ? derivedProvenance(['pool-tendencies', 'tpa', 'fga'])
      : ruleProvenance(['prior'], 'league-rule-no-three-point-line');

  const first = seasons[0] as string;
  const last = seasons[seasons.length - 1] as string;
  const parameters: EraSimParameters = {
    pace: round3(pace),
    league3PARate: round4(threeRate),
    leagueTsPct: round4(tsPct),
    leagueFtaPerFga: round4(ftaPerFga),
    leagueFtPct: round4(ftPct),
    turnoverPerPossession:
      tovPerTrip !== null
        ? round4(tovPerTrip)
        : ERA_RULE_ESTIMATES.turnoverPerPossessionBeforeTracking,
    stealShareOfTurnovers:
      stealShare !== null ? round4(stealShare) : ERA_RULE_ESTIMATES.stealShareBeforeTracking,
    offensiveReboundRate:
      orebRate !== null ? round4(orebRate) : ERA_RULE_ESTIMATES.offensiveReboundRateBeforeSplits,
    assistRate: round4(assistRate),
    foulsPerPossession: round4(foulsPerPoss),
    shootingFoulShare: ERA_RULE_ESTIMATES.shootingFoulShare,
    freeThrowAnchorRating: ftAnchor,
    assistAnchorRating: passAnchor,
    zoneMix: mix,
    source: `packaged stints ${first}..${last} + Lakers ${eraId} pool rating anchors; zone-mix three-point share normalized to the league 3P rate`,
    parameterProvenance,
  };

  return {
    schemaVersion: 1,
    eraId,
    profileVersion: `${PROFILE_VERSION_PREFIX}-${eraId}-v1`,
    dataVersion: ERA_PROFILE_DATA_VERSION,
    seasons,
    baselineReport: `derived from packaged ${first}..${last} stints; targets frozen after calibration baseline`,
    parameters,
    targets: {
      possessionsPerGame: target(tripPace, 3),
      pointsPerGame: target(ppg, 5),
      offensiveRating: target(ppg / (pace / 100.0), 5),
      fieldGoalPct: target(fgPct, 0.02),
      efgPct: target(efgPct, 0.02),
      tsPct: target(tsPct, 0.02),
      threePointRate: target(threeRate, 0.02),
      threePointPct: target(threePct, 0.02),
      freeThrowsAttemptedPerGame: target(ftaPerGame, 3),
      freeThrowPct: target(ftPct, 0.02),
      turnoversPerGame: target(
        tovPerGame ?? pace * ERA_RULE_ESTIMATES.turnoverPerPossessionBeforeTracking,
        1.5,
      ),
      turnoversPerPossession: target(
        tovPerPoss ?? ERA_RULE_ESTIMATES.turnoverPerPossessionBeforeTracking,
        0.012,
      ),
      offensiveReboundsPerGame: target(
        orebPerGame ?? pace * ERA_RULE_ESTIMATES.offensiveReboundRateBeforeSplits * 0.5,
        1.5,
      ),
      offensiveReboundRate: target(
        orebRate ?? ERA_RULE_ESTIMATES.offensiveReboundRateBeforeSplits,
        0.02,
      ),
      assistsPerGame: target(astPerGame, 2.5),
      assistRate: target(assistRate, 0.03),
      personalFoulsPerGame: target(pfPerGame, 2.5),
      zoneMix: {
        rim: target(mix.rim, 0.02),
        shortMid: target(mix.shortMid, 0.02),
        longMid: target(mix.longMid, 0.02),
        cornerThree: target(mix.cornerThree, 0.015),
        aboveBreakThree: target(mix.aboveBreakThree, 0.02),
      },
      // Game-level randomness gates. These are not derivable from stint
      // box aggregates; the values below are the measured engine
      // distribution, which matches the real NBA margin distribution
      // (about 28% of games decided by 5 or fewer, 19% by 20 or more).
      // Overtime is lower than the real ~5% because sandbox v1 has no
      // end-game clock management (spec/03), which reduces tie endings.
      closeGameRate: target(0.28, 0.04, 2000),
      blowoutRate: target(0.19, 0.04, 2000),
      overtimeRate: target(0.027, 0.012, 2000),
      strongVsWeakWinRate: target(0.88, 0.07, 2000),
      equalLineupHomeWinRate: target(0.5, 0.05, 2000),
    },
  };
}
