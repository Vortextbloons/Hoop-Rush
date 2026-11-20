import { z } from 'zod';
import {
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  capRushLeagueGameId,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const fullCourtSeasonCheckpointRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_SEASON_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    checkpoint: fullCourtSeasonCheckpointSchema,
  })
  .refine((row) => row.runId === row.checkpoint.runId, {
    message: 'Full Court season checkpoint run ID differs from its key',
  });
export type StoredFullCourtSeasonCheckpoint = z.infer<typeof fullCourtSeasonCheckpointRecordSchema>;

export const fullCourtSeasonScoreRecordSchema = z
  .object({
    saveSchemaVersion: z.literal(FULL_COURT_SEASON_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    gameId: z.string().min(1),
    score: fullCourtSeasonScoreSchema,
  })
  .refine(
    ({ gameId, score }) =>
      gameId === score.gameId &&
      score.gameId === capRushLeagueGameId(score.slot, score.homeTeamId, score.awayTeamId),
    { message: 'Full Court season game ID does not match its fixture' },
  );
export type StoredFullCourtSeasonScore = z.infer<typeof fullCourtSeasonScoreRecordSchema>;
