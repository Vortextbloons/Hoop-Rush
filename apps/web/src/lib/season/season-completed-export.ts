import {
  buildSeasonRunReplayExport,
  humanFranchiseIdOf,
  type HoopRushManifest,
  type SeasonReplayAssetHashes,
  type SeasonRunReplayExport,
} from '@hoop-rush/data-contracts';
import type { SeasonCompletedSeason } from '@hoop-rush/persistence';
import { deriveSeasonTradeGrades } from '@hoop-rush/engine';
export function seasonReplayAssetHashesOf(
  manifest: HoopRushManifest,
  eraId: string,
): SeasonReplayAssetHashes {
  const season = manifest.season;
  if (season === undefined) {
    throw new Error('manifest is missing the season artifact index');
  }
  const eraProfileEntry = manifest.eraSimulationProfiles.find((entry) => entry.eraId === eraId);
  if (eraProfileEntry === undefined) {
    throw new Error(`manifest is missing the era profile for ${eraId}`);
  }
  const eraProfile = eraProfileEntry.contentHash;
  return {
    league: season.league.contentHash,
    schedule: season.schedule.contentHash,
    draftCatalog: season.draftCatalog.contentHash,
    eraProfile,
    ...(season.freeAgencyIndex === undefined
      ? {}
      : { freeAgencyIndex: season.freeAgencyIndex.contentHash }),
    ...(season.freeAgencyTargets === undefined
      ? {}
      : { freeAgencyTargets: season.freeAgencyTargets.contentHash }),
  };
}
function seasonEraIdOf(season: SeasonCompletedSeason): string {
  const humanFranchiseId = humanFranchiseIdOf(season.run.league);
  const roster =
    humanFranchiseId === null
      ? null
      : season.run.rosters.find((entry) => entry.franchiseId === humanFranchiseId);
  const eraId = roster?.players[0]?.eraId;
  if (eraId === undefined) {
    throw new Error('cannot derive the season era from the completed run');
  }
  return eraId;
}
export function deriveCompletedSeasonTradeGrades(season: SeasonCompletedSeason) {
  return deriveSeasonTradeGrades({
    runId: season.run.runId,
    run: season.run,
    summaries: season.summaries,
    postseasonSummaries: season.postseasonSummaries,
  });
}
export function buildCompletedSeasonRunReplayExport(
  season: SeasonCompletedSeason,
  manifest: HoopRushManifest,
): SeasonRunReplayExport {
  const eraId = seasonEraIdOf(season);
  const championFranchiseId = season.run.completion?.championFranchiseId;
  if (championFranchiseId === undefined) {
    throw new Error('the completed run has no champion');
  }
  return buildSeasonRunReplayExport({
    runId: season.run.runId,
    rootSeed: season.run.rootSeed,
    eraId,
    versions: season.run.versions,
    assetHashes: seasonReplayAssetHashesOf(manifest, eraId),
    commandLog: season.commandLog,
    postseasonSummaries: season.postseasonSummaries,
    almanac: season.almanac,
    championFranchiseId,
    finalStateDigest: season.run.stateDigest,
  });
}
