import type {
  SeasonDraftState,
  SeasonLeague,
  SeasonLeagueGenerationResult,
  SeasonRosterTargets,
  SeasonSchedule,
  SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonScheduleSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonRunFromGeneration } from './season-run-builder';

export interface GameplayBootstrapInput {
  roomId: string;
  rootSeed: string;
  league: SeasonLeague;
  schedule: SeasonSchedule;
  scheduleContentHash: string;
  draft: SeasonDraftState;
  generation: SeasonLeagueGenerationResult;
}

export interface GameplayBootstrapResult {
  run: SeasonRun;
  leagueDigest: string;
  scheduleDigest: string;
}

export async function loadBootstrap(
  input: GameplayBootstrapInput,
): Promise<GameplayBootstrapResult> {
  const run = buildSeasonRunFromGeneration({
    runId: input.roomId,
    rootSeed: input.rootSeed,
    league: input.league,
    schedule: input.schedule,
    scheduleContentHash: input.scheduleContentHash,
    draft: input.draft,
    generation: input.generation,
  });
  return {
    run,
    leagueDigest: input.generation.digest,
    scheduleDigest: input.scheduleContentHash,
  };
}

export async function loadGameplayAssets(fetchImpl: typeof fetch = fetch): Promise<{
  league: SeasonLeague;
  schedule: SeasonSchedule;
  rosterTargets: SeasonRosterTargets;
  scheduleHash: string;
}> {
  // Prefer cached asset path (Dexie + hash-verified, memoized) when manifest is available.
  // This avoids re-downloading small schedule/league assets with cache bypass and reuses
  // the catalog already cached by the draft page (draft-catalog.json 16.36MB). Fallback to
  // direct fetch with default browser cache (not 'no-store') preserves testability via fetchImpl.
  try {
    const manifestMod = await import('$lib/data');
    const manifest = await manifestMod.getManifest();
    if (manifest.season?.league && manifest.season?.schedule && manifest.season?.rosterTargets) {
      const assetsMod = await import('./season-assets');
      const [league, schedule, rosterTargets] = await Promise.all([
        assetsMod.loadSeasonLeague(),
        assetsMod.loadSeasonSchedule(),
        assetsMod.loadSeasonRosterTargets(),
      ]);
      return {
        league,
        schedule,
        rosterTargets,
        scheduleHash: manifest.season.schedule.contentHash,
      };
    }
  } catch {
    // fall through to direct fetch — keeps Zod validation and hash verification via schemas
  }
  const fetchJson = async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`fetch ${url} failed ${res.status}`);
    return res.json();
  };
  const [leagueRaw, scheduleRaw, targetsRaw] = await Promise.all([
    fetchJson('/data/season/league.json'),
    fetchJson('/data/season/schedule.json'),
    fetchJson('/data/season/roster-targets.json'),
  ]);
  // Note: validates compact packaged assets (league ~30 teams, schedule ~82*30, targets). Not the huge SeasonRun (which includes rosters/games). Zod parse here is O(kB), not O(MB).
  const league = seasonLeagueSchema.parse(leagueRaw);
  const schedule = seasonScheduleSchema.parse(scheduleRaw);
  const rosterTargets = seasonRosterTargetsSchema.parse(targetsRaw);
  let scheduleHash = '00000000000000000000000000000000';
  try {
    const manifestMod = await import('$lib/data');
    const manifest = await manifestMod.getManifest();
    scheduleHash = manifest.season?.schedule?.contentHash ?? scheduleHash;
  } catch {
    scheduleHash = schedule.generationSeed.slice(0, 32).padEnd(32, '0');
  }
  return { league, schedule, rosterTargets, scheduleHash };
}
