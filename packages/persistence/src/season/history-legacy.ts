import { z } from 'zod';
import {
  SEASON_RUN_SAVE_SCHEMA_VERSION_V11,
  SEASON_RUN_SCHEMA_VERSION_V11,
  SEASON_RUN_SCHEMA_VERSION_V12,
  SEASON_RUN_SCHEMA_VERSION_V13,
  SEASON_COMMAND_LOG_VERSION_V1,
  SEASON_COMMAND_LOG_VERSION_V2,
  SEASON_REPLAY_EXPORT_VERSION_V1,
  SEASON_REPLAY_EXPORT_VERSION_V2,
  SEASON_BLOCK_VERSION_V5,
  SEASON_BLOCK_VERSION_V6,
  SEASON_CHECKPOINT_VERSION_V5,
  SEASON_CHECKPOINT_VERSION_V6,
  SEASON_RECAP_VERSION_V5,
  SEASON_CAMPAIGN_VERSION_V1,
  SEASON_CAMPAIGN_VERSION_V2,
  SEASON_INFLUENCE_VERSION_V1,
  SEASON_INFLUENCE_VERSION_V2,
  SEASON_OBJECTIVE_VERSION_V1,
  SEASON_OBJECTIVE_VERSION_V2,
  SEASON_INFLUENCE_TARGETS_VERSION_V1,
  SEASON_INFLUENCE_TARGETS_VERSION_V2,
  seasonRunCommandHistorySchema,
  seasonCommandLogSchema,
  seasonRunReplayExportSchema,
  seasonRunSchema,
} from '@hoop-rush/data-contracts';

export const LEGACY_RUN_SCHEMA_VERSIONS = [
  SEASON_RUN_SCHEMA_VERSION_V11,
  SEASON_RUN_SCHEMA_VERSION_V12,
  SEASON_RUN_SCHEMA_VERSION_V13,
] as const;

export const LEGACY_SAVE_SCHEMA_VERSIONS = [SEASON_RUN_SAVE_SCHEMA_VERSION_V11] as const;

export const LEGACY_COMMAND_LOG_VERSIONS = [
  SEASON_COMMAND_LOG_VERSION_V1,
  SEASON_COMMAND_LOG_VERSION_V2,
] as const;

export const LEGACY_REPLAY_EXPORT_VERSIONS = [
  SEASON_REPLAY_EXPORT_VERSION_V1,
  SEASON_REPLAY_EXPORT_VERSION_V2,
] as const;

export const LEGACY_BLOCK_VERSIONS = [SEASON_BLOCK_VERSION_V5, SEASON_BLOCK_VERSION_V6] as const;

export const LEGACY_CHECKPOINT_VERSIONS = [
  SEASON_CHECKPOINT_VERSION_V5,
  SEASON_CHECKPOINT_VERSION_V6,
] as const;

export const LEGACY_RECAP_VERSIONS = [SEASON_RECAP_VERSION_V5] as const;

export const LEGACY_CAMPAIGN_VERSIONS = [
  SEASON_CAMPAIGN_VERSION_V1,
  SEASON_CAMPAIGN_VERSION_V2,
] as const;

export const LEGACY_INFLUENCE_VERSIONS = [
  SEASON_INFLUENCE_VERSION_V1,
  SEASON_INFLUENCE_VERSION_V2,
] as const;

export const LEGACY_OBJECTIVE_VERSIONS = [
  SEASON_OBJECTIVE_VERSION_V1,
  SEASON_OBJECTIVE_VERSION_V2,
] as const;

export const LEGACY_INFLUENCE_TARGETS_VERSIONS = [
  SEASON_INFLUENCE_TARGETS_VERSION_V1,
  SEASON_INFLUENCE_TARGETS_VERSION_V2,
] as const;

export function parseLegacyCommandForHistory(input: unknown): boolean {
  return seasonRunCommandHistorySchema.safeParse(input).success;
}

export function parseLegacyCommandLogForHistory(input: unknown): boolean {
  return seasonCommandLogSchema.safeParse(input).success;
}

export function parseLegacyRunForHistory(input: unknown): boolean {
  return seasonRunSchema.safeParse(input).success;
}

export function parseLegacyReplayExportForHistory(input: unknown): boolean {
  return seasonRunReplayExportSchema.safeParse(input).success;
}

export const legacyHistoryMarkerSchema = z.object({
  runSchemaVersion: z.union([
    z.literal(SEASON_RUN_SCHEMA_VERSION_V11),
    z.literal(SEASON_RUN_SCHEMA_VERSION_V12),
    z.literal(SEASON_RUN_SCHEMA_VERSION_V13),
  ]),
  saveSchemaVersion: z.literal(SEASON_RUN_SAVE_SCHEMA_VERSION_V11),
});
export type LegacyHistoryMarker = z.infer<typeof legacyHistoryMarkerSchema>;

export function isLegacyHistoryRow(row: {
  saveSchemaVersion?: unknown;
  run?: { versions?: { runSchemaVersion?: unknown } };
}): boolean {
  const save = (row as { saveSchemaVersion?: unknown }).saveSchemaVersion;
  if (save === SEASON_RUN_SAVE_SCHEMA_VERSION_V11) return true;
  const runVersion = (row as { run?: { versions?: { runSchemaVersion?: unknown } } }).run?.versions
    ?.runSchemaVersion;
  return (
    runVersion === SEASON_RUN_SCHEMA_VERSION_V11 ||
    runVersion === SEASON_RUN_SCHEMA_VERSION_V12 ||
    runVersion === SEASON_RUN_SCHEMA_VERSION_V13
  );
}
