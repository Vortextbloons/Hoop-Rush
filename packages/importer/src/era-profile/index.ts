/**
 * Build-time derivation of era simulation profiles (port of the
 * `main`/`--era` flow from scripts/import-nba/compute_era_sim_profile.py).
 *
 * Output: `apps/web/static/data/era-sim/<era>.json` (EraSimulationProfile).
 */
import { parseEraSimulationProfile } from '@hoop-rush/data-contracts';
import { join } from 'node:path';
import { ensureDir, writeJsonRetry } from '../json.ts';
import { computeEraProfile, ERA_SIM_DIR, erasWithData, type EraDef } from './profile.ts';

export { computeEraProfile, eraSeasons, erasWithData, packagedSeasons, target } from './profile.ts';
export type {
  CalibrationTarget,
  EraDef,
  EraProfileTargets,
  EraSimParameters,
  EraSimProfile,
} from './profile.ts';
export { deriveLeagueAggregates, deriveLeagueAggregatesFromStints } from './aggregates.ts';
export type { LeagueAggregates, StintRow } from './aggregates.ts';
export { computePoolShotMix, poolShotMixAndAnchors } from './shot-mix.ts';
export type { PoolPlayerLike, ShotMixAndAnchors, ZoneMix } from './shot-mix.ts';

export function run(eras?: readonly string[]): void {
  let selected: EraDef[] = erasWithData();
  if (eras !== undefined) {
    const byId = new Map(selected.map((era) => [era.eraId, era]));
    const missing = eras.filter((eraId) => !byId.has(eraId));
    if (missing.length > 0) {
      throw new Error(`no packaged data for era(s): ${missing.join(', ')}`);
    }
    selected = eras.map((eraId) => byId.get(eraId) as EraDef);
  }

  ensureDir(ERA_SIM_DIR);
  for (const era of selected) {
    const profile = computeEraProfile(era);
    // Validate the finished profile against the packaged schema before
    // writing; a schema failure aborts the build instead of shipping a
    // corrupt artifact.
    parseEraSimulationProfile(profile);
    const out = join(ERA_SIM_DIR, `${era.eraId}.json`);
    writeJsonRetry(out, profile, true);
    console.log(`[OK] ${era.eraId} profile validates as EraSimulationProfile`);
    console.log(`wrote ${out} pace=${profile.parameters.pace.toFixed(2)}`);
  }
}
