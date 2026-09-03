import type { SeasonDraftState, SeasonLeague, SeasonLeagueGenerationResult, SeasonRosterTargets, SeasonSchedule, SeasonRun, } from '@hoop-rush/data-contracts';
import { seasonLeagueSchema, seasonRosterTargetsSchema, seasonScheduleSchema, } from '@hoop-rush/data-contracts';
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
export async function loadBootstrap(input: GameplayBootstrapInput): Promise<GameplayBootstrapResult> {
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
    }
    catch {
    }
    const fetchJson = async (url: string): Promise<unknown> => {
        const res = await fetchImpl(url);
        if (!res.ok)
            throw new Error(`fetch ${url} failed ${res.status}`);
        return res.json();
    };
    const [leagueRaw, scheduleRaw, targetsRaw] = await Promise.all([
        fetchJson('/data/season/league.json'),
        fetchJson('/data/season/schedule.json'),
        fetchJson('/data/season/roster-targets.json'),
    ]);
    const league = seasonLeagueSchema.parse(leagueRaw);
    const schedule = seasonScheduleSchema.parse(scheduleRaw);
    const rosterTargets = seasonRosterTargetsSchema.parse(targetsRaw);
    let scheduleHash = '00000000000000000000000000000000';
    try {
        const manifestMod = await import('$lib/data');
        const manifest = await manifestMod.getManifest();
        scheduleHash = manifest.season?.schedule?.contentHash ?? scheduleHash;
    }
    catch {
        scheduleHash = schedule.generationSeed.slice(0, 32).padEnd(32, '0');
    }
    return { league, schedule, rosterTargets, scheduleHash };
}
