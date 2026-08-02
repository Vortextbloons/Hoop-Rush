/**
 * Pool shot-mix priors and rating anchors for era profiles (port of
 * `pool_shot_mix_and_anchors` from scripts/import-nba/compute_era_sim_profile.py).
 *
 * The packaged Lakers pool for the era provides population anchor ratings and
 * a usage-weighted zone-mix prior; the three-point component is normalized to
 * the league 3PA rate derived from the packaged stints.
 */
import { join } from 'node:path';
import { PUBLIC_DATA } from '../config.js';
import { fileExists, readJson } from '../json.js';

export interface ZoneMix {
  rim: number;
  shortMid: number;
  longMid: number;
  cornerThree: number;
  aboveBreakThree: number;
}

export interface ShotMixAndAnchors {
  mix: ZoneMix;
  ftAnchor: number;
  passAnchor: number;
}

/** The subset of a pool player record the shot-mix derivation reads. */
export interface PoolPlayerLike {
  tendencies: {
    usageRate?: number;
    rimFrequency?: number;
    shortMidFrequency?: number;
    longMidFrequency?: number;
    cornerThreeFrequency?: number;
    aboveBreakThreeFrequency?: number;
  };
  detailedRatings: {
    freeThrow?: number;
    passing?: number;
  };
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * Usage-weighted zone mix over the pool population. Each player's zone
 * frequencies are weighted by their usage tendency, so high-usage players
 * dominate the population shot mix.
 */
export function computePoolShotMix(
  players: readonly PoolPlayerLike[],
  leagueThreeRate: number,
): ZoneMix {
  const totalUsage = players.reduce((sum, p) => sum + (p.tendencies.usageRate ?? 0), 0) || 1.0;
  const weighted = (
    zone:
      | 'rimFrequency'
      | 'shortMidFrequency'
      | 'longMidFrequency'
      | 'cornerThreeFrequency'
      | 'aboveBreakThreeFrequency',
  ) =>
    players.reduce((sum, p) => sum + (p.tendencies[zone] ?? 0) * (p.tendencies.usageRate ?? 0), 0) /
    totalUsage;
  const weightedRim = weighted('rimFrequency');
  const weightedShortMid = weighted('shortMidFrequency');
  const weightedLongMid = weighted('longMidFrequency');
  const weightedCorner = weighted('cornerThreeFrequency');
  const weightedAbove = weighted('aboveBreakThreeFrequency');
  const total =
    weightedRim + weightedShortMid + weightedLongMid + weightedCorner + weightedAbove || 1.0;

  let mix: ZoneMix = {
    rim: weightedRim / total,
    shortMid: weightedShortMid / total,
    longMid: weightedLongMid / total,
    cornerThree: weightedCorner / total,
    aboveBreakThree: weightedAbove / total,
  };

  // The pool mix's three-point share reflects rating-derived tendency
  // priors for one franchise, not the league's actual three-point volume.
  // Normalize the three-point component to the league 3PA rate (from the
  // packaged stints) so the zone-mix gates stay consistent with the
  // league three-point-rate parameter. Two-point ratios are preserved and
  // rescaled so the mix still sums to one.
  const poolThree = mix.cornerThree + mix.aboveBreakThree;
  if (poolThree > 0) {
    const threeScale = leagueThreeRate / poolThree;
    const corner = mix.cornerThree * threeScale;
    const above = mix.aboveBreakThree * threeScale;
    const currentTwo = mix.rim + mix.shortMid + mix.longMid;
    const twoScale = (1.0 - leagueThreeRate) / Math.max(1e-9, currentTwo);
    mix = {
      rim: mix.rim * twoScale,
      shortMid: mix.shortMid * twoScale,
      longMid: mix.longMid * twoScale,
      cornerThree: corner,
      aboveBreakThree: above,
    };
  }

  return {
    rim: round4(mix.rim),
    shortMid: round4(mix.shortMid),
    longMid: round4(mix.longMid),
    cornerThree: round4(mix.cornerThree),
    aboveBreakThree: round4(mix.aboveBreakThree),
  };
}

/** Load the packaged Lakers pool and derive zone mix plus rating anchors. */
export function poolShotMixAndAnchors(eraId: string, leagueThreeRate: number): ShotMixAndAnchors {
  const poolPath = join(PUBLIC_DATA, 'pools', `lakers-${eraId}.json`);
  if (!fileExists(poolPath)) {
    throw new Error(`anchor pool missing: ${poolPath} (run compute_pools first)`);
  }
  const pool = readJson(poolPath) as { players: PoolPlayerLike[] };
  const players = pool.players;
  const mix = computePoolShotMix(players, leagueThreeRate);

  // Population-mean anchor ratings: a player at the anchor converts at the
  // league rate, and deviations move outcomes (see eraSimulationParametersSchema).
  const ftMean =
    players.reduce((sum, p) => sum + (p.detailedRatings.freeThrow ?? 50), 0) / players.length;
  const passMean =
    players.reduce((sum, p) => sum + (p.detailedRatings.passing ?? 50), 0) / players.length;
  return { mix, ftAnchor: Math.round(ftMean), passAnchor: Math.round(passMean) };
}
