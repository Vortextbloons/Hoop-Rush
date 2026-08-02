/**
 * Era simulation profile derivation (port of scripts/import-nba/compute_era_sim_profile.py).
 *
 * Each profile is derived from the era's raw packaged season data
 * (`raw-data/nba/<season>/stints.json` per season), plus the packaged Lakers pool
 * for that era, which provides population anchor ratings and shot-mix priors.
 *
 * Targets are emitted as initial estimates from the same source aggregates with
 * wide tolerances; the calibration baseline freezes the final gates.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NBA_ROOT, PUBLIC_DATA } from '../config.js';
import { readJson } from '../json.js';
import { deriveLeagueAggregates } from './aggregates.js';
import { poolShotMixAndAnchors, type ZoneMix } from './shot-mix.js';

export const ESTIMATE_TO_TRIPS_FACTOR = 0.93;
// Engine conversion from the league possessions-per-game estimate to the
// real trip rate the box scores account (engine constant `estimateToTripsFactor`).
export const PROFILE_VERSION_PREFIX = 'm3';
export const ERA_PROFILE_DATA_VERSION = 'm1.6';
export const ERA_SIM_DIR = join(PUBLIC_DATA, 'era-sim');

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

export function computeEraProfile(era: EraDef): EraSimProfile {
  const eraId = era.eraId;
  const seasons = eraSeasons(era);
  if (seasons.length === 0) {
    throw new Error(`no packaged seasons for era ${eraId}`);
  }

  const a = deriveLeagueAggregates(seasons);
  const threeRate = a.tpa / Math.max(1.0, a.fga);
  const { mix, ftAnchor, passAnchor } = poolShotMixAndAnchors(eraId, threeRate);

  const pace = a.possessions / a.teamGames; // league possessions estimate per team per game
  // The engine accounts real trips, not the league estimate: the estimate
  // over-counts trips by the offensive-rebound continuation adjustment
  // (engine constant `estimateToTripsFactor`). The possession gate targets
  // the trip rate the engine actually produces.
  const tripPace = pace * ESTIMATE_TO_TRIPS_FACTOR;
  const ppg = a.points / a.teamGames;
  const tsPct = a.points / (2.0 * a.possessions);
  const fgPct = a.fgm / Math.max(1.0, a.fga);
  const efgPct = (a.fgm + 0.5 * a.tpm) / Math.max(1.0, a.fga);
  const threePct = a.tpm / Math.max(1.0, a.tpa);
  const ftaPerFga = a.fta / Math.max(1.0, a.fga);
  const ftPct = a.ftm / Math.max(1.0, a.fta);
  const tovPerPoss = a.tov / Math.max(1.0, a.possessions);
  // The engine applies the turnover probability per real trip; the stint
  // turnoverPerPossession above is per league-ESTIMATE possession. Convert
  // to the per-trip rate the engine consumes.
  const tovPerTrip = tovPerPoss / ESTIMATE_TO_TRIPS_FACTOR;
  const stealShare = a.stl / Math.max(1.0, a.tov);
  const orebRate = a.oreb / Math.max(1.0, a.oreb + a.dreb);
  const assistRate = a.ast / Math.max(1.0, a.fgm);
  const foulsPerPoss = a.pf / Math.max(1.0, a.possessions);
  const orebPerGame = a.oreb / a.teamGames;
  const astPerGame = a.ast / a.teamGames;
  const tovPerGame = a.tov / a.teamGames;
  const ftaPerGame = a.fta / a.teamGames;
  const pfPerGame = a.pf / a.teamGames;

  const first = seasons[0] as string;
  const last = seasons[seasons.length - 1] as string;
  return {
    schemaVersion: 1,
    eraId,
    profileVersion: `${PROFILE_VERSION_PREFIX}-${eraId}-v1`,
    dataVersion: ERA_PROFILE_DATA_VERSION,
    seasons,
    baselineReport: `derived from packaged ${first}..${last} stints; targets frozen after calibration baseline`,
    parameters: {
      pace: round3(pace),
      league3PARate: round4(threeRate),
      leagueTsPct: round4(tsPct),
      leagueFtaPerFga: round4(ftaPerFga),
      leagueFtPct: round4(ftPct),
      turnoverPerPossession: round4(tovPerTrip),
      stealShareOfTurnovers: round4(stealShare),
      offensiveReboundRate: round4(orebRate),
      assistRate: round4(assistRate),
      foulsPerPossession: round4(foulsPerPoss),
      shootingFoulShare: 0.55, // documented estimate; not derivable from box scores
      freeThrowAnchorRating: ftAnchor,
      assistAnchorRating: passAnchor,
      zoneMix: mix,
      source: `packaged stints ${first}..${last} + Lakers ${eraId} pool rating anchors; zone-mix three-point share normalized to the league 3P rate`,
    },
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
      turnoversPerGame: target(tovPerGame, 1.5),
      turnoversPerPossession: target(tovPerPoss, 0.012),
      offensiveReboundsPerGame: target(orebPerGame, 1.5),
      offensiveReboundRate: target(orebRate, 0.02),
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
