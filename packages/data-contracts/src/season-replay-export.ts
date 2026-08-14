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

/**
 * Replay exports (M2.6, replay-export-v1): self-contained exports of
 * recorded Season Run facts so a later replay phase can reproduce or present
 * them from recorded facts. The digest is a deterministic function of the
 * export facts; timestamps are never part of it.
 *
 * Two shapes share the frozen `replay-export-v1` version literal:
 * - `SeasonReplayExport` (below): one postseason game's compact summary
 *   (the original per-game contract).
 * - `SeasonRunReplayExport`: the full-run export (root seed, material
 *   versions, asset hashes, the accepted command log, the completed almanac,
 *   and the recorded postseason summaries), consumed by `season run
 *   reproduce` and produced by the same pure builder the web history export
 *   uses.
 */

export const seasonReplayExportSchema = z.object({
  schemaVersion: z.literal(1),
  replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),
  runId: z.string().min(1).max(64),
  gameId: postseasonGameIdSchema,
  summary: seasonPostseasonSummarySchema,
  /** Canonical 32-hex digest of the export facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonReplayExport = z.infer<typeof seasonReplayExportSchema>;

/** The digest material of a replay export (every fact except `digest`). */
export function seasonReplayExportFacts(exportArtifact: SeasonReplayExport): unknown {
  const facts: Record<string, unknown> = { ...exportArtifact };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the replay-export facts. */
export function seasonReplayExportDigest(exportArtifact: SeasonReplayExport): string {
  return seasonDigestHex(canonicalJson(seasonReplayExportFacts(exportArtifact)));
}

/**
 * The asset content hashes a full-run export freezes. Every hash is the
 * SHA-256 content hash recorded in the build-time manifest for the packaged
 * artifact the run simulated against, so reproduction can verify the loaded
 * artifacts byte-for-byte. `eraId` names the era profile the run used (the
 * run snapshot does not freeze an era, so the export freezes it explicitly).
 */
export const seasonReplayAssetHashesSchema = z.object({
  league: contentHashSchema,
  schedule: contentHashSchema,
  draftCatalog: contentHashSchema,
  eraProfile: contentHashSchema,
  /**
   * M2.6.5: the free-agent eligibility index the run's markets drew from.
   * Optional so pre-M2.6.5 exports stay valid.
   */
  freeAgencyIndex: contentHashSchema.optional(),
  /**
   * M2.6.5: the frozen free-agency calibration targets artifact. Optional so
   * pre-M2.6.5 exports stay valid.
   */
  freeAgencyTargets: contentHashSchema.optional(),
});
export type SeasonReplayAssetHashes = z.infer<typeof seasonReplayAssetHashesSchema>;

/**
 * The full-run replay export (M2.6, replay-export-v1, kind `full-run`):
 * self-contained reproduction inputs for one completed Season Run. It
 * carries the run identity, root seed, every material version the run
 * freezes (`versions`, identical to the run snapshot's set), the asset
 * content hashes, the accepted command log (command-log-v1, every accepted
 * command with its ordinal and per-command pre/post state revision/digest
 * facts), the recorded postseason summaries through the champion, the
 * completed almanac, and the final state digest.
 *
 * `initialRun` is the schema-9 run snapshot at the first logged command's
 * pre-state. It is OPTIONAL because the persistence layer cannot reconstruct
 * it from completed-history rows (only the final snapshot is stored): when
 * present, `season run reproduce` replays every command from it and fails at
 * the first divergence; when absent, reproduce verifies the log chain facts
 * (ordinal density, hash chain, pre/post monotonicity, run identity, almanac
 * digests, champion, final digest) that need no replay.
 *
 * `initialEffects` is the recorded M2.4 effects state (player loads + pair
 * chemistries) BESIDE the run snapshot at the same pre-state. The run state
 * digest canonicalizes effects, and trade application mutates them, so a
 * byte-exact reproduction of any command that touches effects requires the
 * recorded effects facts (the persistence layer stores them beside the
 * snapshot; they are not derivable from the command log because block
 * submissions — which fold window effects — are not logged). Optional like
 * `initialRun`: without either, reproduce verifies the chain facts only.
 *
 * The builder accepts both shapes; the web history export and the CLI
 * reproduce command call the same `buildSeasonRunReplayExport`.
 */
export const seasonRunReplayExportSchema = z.object({
  schemaVersion: z.literal(1),
  replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),
  kind: z.literal('full-run'),
  runId: idSchema,
  rootSeed: seedSchema,
  eraId: eraIdSchema,
  /** The material versions the run freezes (mirror of the run snapshot). */
  versions: seasonRunVersionsSchema,
  assetHashes: seasonReplayAssetHashesSchema,
  /** Run snapshot at the first logged command's pre-state (see docstring). */
  initialRun: seasonRunSchema.optional(),
  /** Recorded effects state beside the snapshot at the same pre-state. */
  initialEffects: seasonEffectsStateSchema.optional(),
  /** Every accepted command with ordinals and per-command state facts. */
  commandLog: seasonCommandLogSchema,
  /** Recorded postseason summaries through the champion, in play order. */
  postseasonSummaries: z.array(seasonPostseasonSummarySchema),
  /** The completed-season almanac (almanac-v1). */
  almanac: seasonAlmanacSchema,
  championFranchiseId: franchiseIdSchema,
  /** The run state digest after the final logged command applied. */
  finalStateDigest: seasonCheckpointDigestSchema,
  /** Canonical 32-hex digest of the export facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonRunReplayExport = z.infer<typeof seasonRunReplayExportSchema>;

/** The digest material of a full-run export (every fact except `digest`). */
export function seasonRunReplayExportFacts(exportArtifact: SeasonRunReplayExport): unknown {
  const facts: Record<string, unknown> = { ...exportArtifact };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the full-run export facts. */
export function seasonRunReplayExportDigest(exportArtifact: SeasonRunReplayExport): string {
  return seasonDigestHex(canonicalJson(seasonRunReplayExportFacts(exportArtifact)));
}

/** The pure builder inputs of the full-run export (see the schema docstring). */
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

/**
 * The single authoritative full-run export construction path (shared by the
 * web history export and the CLI reproduce command): validates every input
 * through its contract, verifies the recorded identity facts (run ids, root
 * seed, versions, almanac reconciliation, champion), and computes the
 * self-excluded digest. Throws a typed error with the first failure.
 */
export function buildSeasonRunReplayExport(
  input: SeasonRunReplayExportInput,
): SeasonRunReplayExport {
  const fail = (message: string): never => {
    throw new Error(`season run replay export: ${message}`);
  };
  const versions = seasonRunVersionsSchema.parse(input.versions);
  const commandLog = seasonCommandLogSchema.parse(input.commandLog);
  const postseasonSummaries = input.postseasonSummaries.map((summary) =>
    seasonPostseasonSummarySchema.parse(summary),
  );
  const almanac = seasonAlmanacSchema.parse(input.almanac);
  const assetHashes = seasonReplayAssetHashesSchema.parse(input.assetHashes);
  const initialRun =
    input.initialRun === undefined ? undefined : seasonRunSchema.parse(input.initialRun);
  const initialEffects =
    input.initialEffects === undefined
      ? undefined
      : seasonEffectsStateSchema.parse(input.initialEffects);
  if (commandLog.runId !== input.runId) fail('the command log targets a different run');
  if (almanac.runId !== input.runId) fail('the almanac targets a different run');
  if (almanac.rootSeed !== input.rootSeed) fail('the almanac root seed disagrees');
  if (almanac.championFranchiseId !== input.championFranchiseId) {
    fail('the almanac champion disagrees with the export champion');
  }
  if (almanac.commandLogDigest !== seasonCommandLogDigest(commandLog.entries)) {
    fail('the almanac command-log digest does not reconcile');
  }
  if (initialRun !== undefined) {
    if (initialRun.runId !== input.runId) fail('initialRun targets a different run');
    if (initialRun.rootSeed !== input.rootSeed) fail('initialRun root seed disagrees');
    for (const summary of postseasonSummaries) {
      if (summary.runId !== input.runId) fail('a postseason summary targets a different run');
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
