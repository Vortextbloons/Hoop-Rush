import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  type FullCourtHistoryRecord,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtAwards,
  buildFullCourtPlayerSeasonStats,
  buildFullCourtRegularSeason,
  fullCourtPlayoffView,
  fullCourtStandings,
  lockFullCourtPlayoffs,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import { getPersistence } from '#lib/persistence.js';
import { loadFullCourtAssets } from './full-court-assets.ts';
import { loadFullCourtHealthProfiles } from './full-court-health-profiles.ts';
import { resolveFullCourtSeasonLock } from './full-court-season-lock.ts';

/** Everything a finished run can still prove from its own saved records. */
export interface FullCourtReportData {
  readonly record: FullCourtHistoryRecord;
  readonly seasonLock: FullCourtSeasonLock;
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly regularScores: readonly FullCourtSeasonScore[];
  readonly playoffCheckpoint: FullCourtPlayoffCheckpoint | null;
  readonly standings: ReturnType<typeof fullCourtStandings>;
  readonly playerRows: ReturnType<typeof buildFullCourtPlayerSeasonStats>;
  readonly awards: ReturnType<typeof buildFullCourtAwards>;
  readonly bracket: ReturnType<typeof fullCourtPlayoffView> | null;
}

/**
 * Rebuilds a completed run from its archived history record plus the season and
 * playoff rows that stay on disk after archiving. Every derived value comes from
 * the saved scores, so the report never re-simulates a game or invents a stat
 * line. Returns null when the packaged data version no longer matches the run.
 */
export async function loadFullCourtReport(runId: string): Promise<FullCourtReportData | null> {
  const persistence = getPersistence();
  const record = await persistence.fullCourtHistoryRepository.load(runId);
  if (record === null) return null;

  const checkpoint = await persistence.fullCourtSeasonRepository.load(runId);
  if (checkpoint === null) return null;

  const assets = await loadFullCourtAssets();
  const season = buildFullCourtRegularSeason({
    draft: record.draft,
    catalog: assets.catalog,
    catalogSource: assets.catalogSource,
    field: assets.field,
    profile: assets.profile,
  });

  let seasonLock: FullCourtSeasonLock;
  try {
    seasonLock = await resolveFullCourtSeasonLock({
      season,
      checkpoint,
      catalogAssetHash: assets.catalogAssetHash,
      loadProfiles: () => loadFullCourtHealthProfiles(assets.catalogAssetHash),
    });
  } catch {
    return null;
  }

  const regularScores = (await persistence.fullCourtSeasonRepository.listScores(runId)).filter(
    (score) => score.slot <= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  );
  if (regularScores.length === 0) return null;

  const playoffCheckpoint = await persistence.fullCourtPlayoffRepository.load(runId);

  const standings = fullCourtStandings(seasonLock.season.teams, regularScores);
  const playerRows = buildFullCourtPlayerSeasonStats({
    teams: seasonLock.season.teams,
    scores: regularScores,
  });
  const awards = buildFullCourtAwards({
    teams: seasonLock.season.teams,
    regularScores,
    standings,
    completedSlots: checkpoint.completedThroughSlot,
  });

  let bracket: ReturnType<typeof fullCourtPlayoffView> | null = null;
  if (playoffCheckpoint !== null) {
    try {
      bracket = fullCourtPlayoffView(
        lockFullCourtPlayoffs(seasonLock, checkpoint, regularScores),
        playoffCheckpoint,
      );
    } catch {
      bracket = null;
    }
  }

  return {
    record,
    seasonLock,
    checkpoint,
    regularScores,
    playoffCheckpoint,
    standings,
    playerRows,
    awards,
    bracket,
  };
}
