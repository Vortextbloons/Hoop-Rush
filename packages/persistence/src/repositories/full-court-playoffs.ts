import {
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
  type FullCourtPlayoffCheckpoint,
} from '@hoop-rush/data-contracts';
import { fullCourtPlayoffRecordSchema } from '../schemas/full-court-playoff-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  parseRecord,
} from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court playoff save: ${message}`);
}

export function createFullCourtPlayoffRepository(db: HoopRushDatabase) {
  const table = db.fullCourtPlayoffs;
  async function load(runId: string) {
    const row = await getParsedRecord(table, runId, (data) => {
      assertSaveSchemaVersion(data, FULL_COURT_PLAYOFFS_VERSION, invalidSave);
      const parsed = parseRecord(fullCourtPlayoffRecordSchema, data, 'checkpoint', invalidSave);
      if (parsed.runId !== runId) throw invalidSave('checkpoint key mismatch');
      return parsed;
    });
    return row?.checkpoint ?? null;
  }
  async function write(checkpoint: FullCourtPlayoffCheckpoint): Promise<void> {
    await table.put({
      saveSchemaVersion: FULL_COURT_PLAYOFFS_VERSION,
      runId: checkpoint.runId,
      checkpoint,
    });
  }
  return {
    load,
    async create(input: FullCourtPlayoffCheckpoint): Promise<void> {
      const checkpoint = fullCourtPlayoffCheckpointSchema.parse(input);
      if (checkpoint.games.length !== 0) throw invalidSave('initial checkpoint already has games');
      await db.transaction('rw', table, async () => {
        const current = await load(checkpoint.runId);
        if (current === null) await write(checkpoint);
        else if (current.lockDigest !== checkpoint.lockDigest)
          throw invalidSave('playoff lock mismatch');
      });
    },
    async commitGame(input: FullCourtPlayoffCheckpoint): Promise<void> {
      const checkpoint = fullCourtPlayoffCheckpointSchema.parse(input);
      await db.transaction('rw', table, async () => {
        const current = await load(checkpoint.runId);
        if (current === null || current.lockDigest !== checkpoint.lockDigest)
          throw invalidSave('playoff lock mismatch');
        const game = checkpoint.games.at(-1);
        if (game === undefined) throw invalidSave('missing playoff game');
        if (canonicalEquals(current, checkpoint)) return;
        if (
          checkpoint.games.length !== current.games.length + 1 ||
          !canonicalEquals(checkpoint.games.slice(0, -1), current.games) ||
          current.games.some((entry) => entry.gameId === game.gameId)
        ) {
          throw invalidSave('game does not append to the saved playoff results');
        }
        for (const [id, previous] of Object.entries(current.healthByTeam)) {
          const health = checkpoint.healthByTeam[id];
          const played = id === game.homeTeamId || id === game.awayTeamId;
          if (
            played
              ? health?.throughDay !== game.dayOffset || game.dayOffset <= previous.throughDay
              : !canonicalEquals(previous, health)
          ) {
            throw invalidSave(`health does not match the game for ${id}`);
          }
        }
        if (
          current.healthByTeam[game.homeTeamId] === undefined ||
          current.healthByTeam[game.awayTeamId] === undefined ||
          game.homeTeamId === game.awayTeamId
        ) {
          throw invalidSave('game does not match the playoff teams');
        }
        await write(checkpoint);
      });
    },
  };
}
