import {
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
  fullCourtWatchedReplaySchema,
  type FullCourtPlayoffCheckpoint,
  type FullCourtPlayoffScore,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import { fullCourtPlayoffRecordSchema } from '../schemas/full-court-playoff-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { putWatchedReplayRecord, verifyWatchedReplayRetry } from './full-court-replay.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  parseRecord,
} from './support.ts';

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court playoff save: ${message}`);
}

function validatePlayoffWatchedReplay(
  checkpoint: FullCourtPlayoffCheckpoint,
  game: FullCourtPlayoffScore,
  replay: FullCourtWatchedReplay,
): void {
  if (replay.identity.phase !== 'playoff') {
    throw invalidSave('playoff watched replay must have playoff phase');
  }
  if (
    replay.identity.runId !== checkpoint.runId ||
    replay.identity.lockDigest !== checkpoint.lockDigest
  ) {
    throw invalidSave('playoff watched replay lock does not match checkpoint');
  }
  if (
    replay.identity.gameId !== game.gameId ||
    replay.identity.dayOffset !== game.dayOffset ||
    replay.identity.homeTeamId !== game.homeTeamId ||
    replay.identity.awayTeamId !== game.awayTeamId
  ) {
    throw invalidSave('playoff watched replay does not match the committed game');
  }
  if (game.outcome.kind !== 'played') {
    throw invalidSave('forfeit playoff game cannot carry a watched replay');
  }
  if (
    game.outcome.homePoints !== replay.result.home.box.points ||
    game.outcome.awayPoints !== replay.result.away.box.points
  ) {
    throw invalidSave('playoff watched replay score disagrees with committed score');
  }
  if (
    !canonicalEquals(checkpoint.healthByTeam[game.homeTeamId], replay.health.home) ||
    !canonicalEquals(checkpoint.healthByTeam[game.awayTeamId], replay.health.away)
  ) {
    throw invalidSave('playoff watched replay health disagrees with committed health');
  }
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
    async commitGame(
      input: FullCourtPlayoffCheckpoint,
      options?: { readonly watchedReplay?: FullCourtWatchedReplay },
    ): Promise<void> {
      const checkpoint = fullCourtPlayoffCheckpointSchema.parse(input);
      const validatedReplay =
        options?.watchedReplay === undefined
          ? undefined
          : fullCourtWatchedReplaySchema.parse(options.watchedReplay);
      const game = checkpoint.games.at(-1);
      if (game === undefined) throw invalidSave('missing playoff game');
      if (validatedReplay !== undefined) {
        validatePlayoffWatchedReplay(checkpoint, game, validatedReplay);
      }
      await db.transaction(
        'rw',
        [table, ...(validatedReplay === undefined ? [] : [db.fullCourtWatchedReplays])],
        async () => {
          const current = await load(checkpoint.runId);
          if (current === null || current.lockDigest !== checkpoint.lockDigest)
            throw invalidSave('playoff lock mismatch');
          if (canonicalEquals(current, checkpoint)) {
            if (validatedReplay !== undefined) {
              const conflict = await verifyWatchedReplayRetry(
                db.fullCourtWatchedReplays,
                validatedReplay,
              );
              if (conflict !== null) throw invalidSave(conflict);
            }
            return;
          }
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
          if (validatedReplay !== undefined) {
            await putWatchedReplayRecord(db.fullCourtWatchedReplays, validatedReplay);
          }
        },
      );
    },
  };
}
