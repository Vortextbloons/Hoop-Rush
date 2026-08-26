import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema, idSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { seasonPostseasonSummarySchema } from './season-postseason-summary.ts';
import { seasonCommandLogDigest, seasonCommandLogSchema } from './season-command-log.ts';
import { seasonEffectsStateSchema } from './season-effects.ts';
import { seasonRunSchema, seasonRunVersionsSchema } from './season-run.ts';
import { seasonAlmanacSchema } from './season-almanac.ts';
import { SEASON_REPLAY_EXPORT_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
export const seasonReplayExportSchema = z.object({
    schemaVersion: z.literal(1),
    replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),
    runId: z.string().min(1).max(64),
    gameId: postseasonGameIdSchema,
    summary: seasonPostseasonSummarySchema,
    digest: seasonCheckpointDigestSchema,
});
export type SeasonReplayExport = z.infer<typeof seasonReplayExportSchema>;
export function seasonReplayExportFacts(exportArtifact: SeasonReplayExport): unknown {
    const facts: Record<string, unknown> = { ...exportArtifact };
    delete facts.digest;
    return facts;
}
export function seasonReplayExportDigest(exportArtifact: SeasonReplayExport): string {
    return seasonDigestHex(canonicalJson(seasonReplayExportFacts(exportArtifact)));
}
export const seasonReplayAssetHashesSchema = z.object({
    league: contentHashSchema,
    schedule: contentHashSchema,
    draftCatalog: contentHashSchema,
    eraProfile: contentHashSchema,
    freeAgencyIndex: contentHashSchema.optional(),
    freeAgencyTargets: contentHashSchema.optional(),
});
export type SeasonReplayAssetHashes = z.infer<typeof seasonReplayAssetHashesSchema>;
export const seasonRunReplayExportSchema = z.object({
    schemaVersion: z.literal(1),
    replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),
    kind: z.literal('full-run'),
    runId: idSchema,
    rootSeed: seedSchema,
    eraId: eraIdSchema,
    versions: seasonRunVersionsSchema,
    assetHashes: seasonReplayAssetHashesSchema,
    initialRun: seasonRunSchema.optional(),
    initialEffects: seasonEffectsStateSchema.optional(),
    commandLog: seasonCommandLogSchema,
    postseasonSummaries: z.array(seasonPostseasonSummarySchema),
    almanac: seasonAlmanacSchema,
    championFranchiseId: franchiseIdSchema,
    finalStateDigest: seasonCheckpointDigestSchema,
    digest: seasonCheckpointDigestSchema,
});
export type SeasonRunReplayExport = z.infer<typeof seasonRunReplayExportSchema>;
export function seasonRunReplayExportFacts(exportArtifact: SeasonRunReplayExport): unknown {
    const facts: Record<string, unknown> = { ...exportArtifact };
    delete facts.digest;
    return facts;
}
export function seasonRunReplayExportDigest(exportArtifact: SeasonRunReplayExport): string {
    return seasonDigestHex(canonicalJson(seasonRunReplayExportFacts(exportArtifact)));
}
export interface SeasonRunReplayExportInput {
    runId: string;
    rootSeed: string;
    eraId: string;
    versions: SeasonRunReplayExport['versions'];
    assetHashes: SeasonReplayAssetHashes;
    initialRun?: SeasonRunReplayExport['initialRun'];
    initialEffects?: SeasonRunReplayExport['initialEffects'];
    commandLog: SeasonRunReplayExport['commandLog'];
    postseasonSummaries: SeasonRunReplayExport['postseasonSummaries'];
    almanac: SeasonRunReplayExport['almanac'];
    championFranchiseId: string;
    finalStateDigest: string;
}
export function buildSeasonRunReplayExport(input: SeasonRunReplayExportInput): SeasonRunReplayExport {
    const fail = (message: string): never => {
        throw new Error(`season run replay export: ${message}`);
    };
    const versions = seasonRunVersionsSchema.parse(input.versions);
    const commandLog = seasonCommandLogSchema.parse(input.commandLog);
    const postseasonSummaries = input.postseasonSummaries.map((summary) => seasonPostseasonSummarySchema.parse(summary));
    const almanac = seasonAlmanacSchema.parse(input.almanac);
    const assetHashes = seasonReplayAssetHashesSchema.parse(input.assetHashes);
    const initialRun = input.initialRun === undefined ? undefined : seasonRunSchema.parse(input.initialRun);
    const initialEffects = input.initialEffects === undefined
        ? undefined
        : seasonEffectsStateSchema.parse(input.initialEffects);
    if (commandLog.runId !== input.runId)
        fail('the command log targets a different run');
    if (almanac.runId !== input.runId)
        fail('the almanac targets a different run');
    if (almanac.rootSeed !== input.rootSeed)
        fail('the almanac root seed disagrees');
    if (almanac.championFranchiseId !== input.championFranchiseId) {
        fail('the almanac champion disagrees with the export champion');
    }
    if (almanac.commandLogDigest !== seasonCommandLogDigest(commandLog.entries)) {
        fail('the almanac command-log digest does not reconcile');
    }
    if (initialRun !== undefined) {
        if (initialRun.runId !== input.runId)
            fail('initialRun targets a different run');
        if (initialRun.rootSeed !== input.rootSeed)
            fail('initialRun root seed disagrees');
        for (const summary of postseasonSummaries) {
            if (summary.runId !== input.runId)
                fail('a postseason summary targets a different run');
        }
    }
    const facts: SeasonRunReplayExport = {
        schemaVersion: 1,
        replayExportVersion: SEASON_REPLAY_EXPORT_VERSION,
        kind: 'full-run',
        runId: input.runId,
        rootSeed: input.rootSeed,
        eraId: input.eraId,
        versions,
        assetHashes,
        ...(initialRun === undefined ? {} : { initialRun }),
        ...(initialEffects === undefined ? {} : { initialEffects }),
        commandLog,
        postseasonSummaries,
        almanac,
        championFranchiseId: input.championFranchiseId,
        finalStateDigest: seasonCheckpointDigestSchema.parse(input.finalStateDigest),
        digest: '',
    };
    return { ...facts, digest: seasonRunReplayExportDigest(facts) };
}
