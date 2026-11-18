import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  havocMultiplayerCommandSchema,
  havocMultiplayerVerificationReceiptSchema,
  type HavocMultiplayerCommand,
  type HavocMultiplayerSeriesGame,
  type HavocMultiplayerVerificationReceipt,
  profileBindingSchema,
} from '@hoop-rush/data-contracts';
import { evaluateSeriesAchievements, type SeriesAchievementFacts } from '@hoop-rush/engine';
import {
  havocMultiplayerCompletionRecapSchema,
  havocMultiplayerGameOutputSchema,
  storedHavocMultiplayerActiveSchema,
  storedHavocMultiplayerCommandRowSchema,
  storedHavocMultiplayerCompletedSchema,
  storedHavocMultiplayerHistoryIndexSchema,
  storedHavocMultiplayerResultRowSchema,
  type HavocMultiplayerActiveState,
  type HavocMultiplayerCommandEntry,
  type HavocMultiplayerCompletionRecap,
  type HavocMultiplayerGameOutput,
  type StoredHavocMultiplayerActive,
  type StoredHavocMultiplayerCommandRow,
  type StoredHavocMultiplayerCompleted,
  type StoredHavocMultiplayerHistoryIndex,
  type StoredHavocMultiplayerResultRow,
} from '../schemas/havoc-multiplayer-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  commandReceiptMatches,
  commandRowsToAppend,
  deleteWhereEquals,
  getParsedRecord,
  listCompletedHistory,
  putResultPreservingVerified,
  rowsWhereEquals,
} from './support.ts';

function commandRowMatches(
  stored: StoredHavocMultiplayerCommandRow,
  incoming: StoredHavocMultiplayerCommandRow,
): boolean {
  return commandReceiptMatches(
    {
      commandId: stored.commandId,
      actorParticipantId: stored.actorParticipantId,
      payload: stored.payload,
    },
    {
      commandId: incoming.commandId,
      actorParticipantId: incoming.actorParticipantId,
      payload: incoming.payload,
    },
  );
}

const SERIES_ACHIEVEMENT_LABEL = 'Havoc Multiplayer';

function averageOriginalOverall(draft: StoredHavocMultiplayerActive['snapshot']['draft']): {
  p1: number;
  p2: number;
} {
  if (!draft || draft.status !== 'complete') {
    return { p1: Number.NaN, p2: Number.NaN };
  }
  const totals = { p1: 0, p2: 0 };
  const counts = { p1: 0, p2: 0 };
  for (const pick of draft.picks) {
    totals[pick.participantId] += pick.card.source.originalOverall;
    counts[pick.participantId] += 1;
  }
  return {
    p1: counts.p1 === 5 ? totals.p1 / 5 : Number.NaN,
    p2: counts.p2 === 5 ? totals.p2 / 5 : Number.NaN,
  };
}

// A room marks a game verified only after both participants confirm the same
// result digest, so the stored score is trusted only when it matches that digest.
function verifiedScores(
  game: HavocMultiplayerSeriesGame,
  row: StoredHavocMultiplayerResultRow | undefined,
): { homeScore: number; awayScore: number } | null {
  if (!row || game.status !== 'verified' || game.resultDigest === null) return null;
  if (row.resultDigest !== game.resultDigest) return null;
  return { homeScore: row.result.home.points, awayScore: row.result.away.points };
}

export class DexieHavocMultiplayerRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }
  async saveActive(state: HavocMultiplayerActiveState): Promise<void> {
    const record: StoredHavocMultiplayerActive = storedHavocMultiplayerActiveSchema.parse({
      ...state,
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      updatedAtIso: new Date().toISOString(),
    });
    await this.db.havocMultiplayerActive.put(record);
  }
  async loadActive(roomId: string): Promise<StoredHavocMultiplayerActive | null> {
    return getParsedRecord(this.db.havocMultiplayerActive, roomId, (record) =>
      storedHavocMultiplayerActiveSchema.parse(record),
    );
  }
  async appendCommands(
    roomId: string,
    entries: readonly HavocMultiplayerCommandEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const storedAtIso = new Date().toISOString();
    const rows = entries
      .map((entry) => {
        if (entry.command.roomId !== roomId) {
          throw new Error(
            `appendCommands: command ${String(entry.command.commandId)} does not belong to room ${roomId}`,
          );
        }
        return storedHavocMultiplayerCommandRowSchema.parse({
          saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          roomId,
          ordinal: entry.ordinal,
          commandId: entry.command.commandId,
          actorParticipantId: entry.command.actorParticipantId,
          payload: entry.command.payload,
          storedAtIso,
        });
      })
      .sort((a, b) => a.ordinal - b.ordinal);
    await this.db.transaction('rw', this.db.havocMultiplayerCommands, async () => {
      const existingRows = await rowsWhereEquals(
        this.db.havocMultiplayerCommands,
        'roomId',
        roomId,
      );
      const append = commandRowsToAppend({
        existing: existingRows.map((row) => storedHavocMultiplayerCommandRowSchema.parse(row)),
        incoming: rows,
        ordinalOf: (row) => row.ordinal,
        identityOf: (row) => row.commandId,
        matches: commandRowMatches,
        conflict: (kind, row) =>
          kind === 'identity'
            ? new Error(
                `appendCommands: conflicting command ${String(row.commandId)} in room ${roomId}`,
              )
            : new Error(
                `appendCommands: conflicting command at ordinal ${String(row.ordinal)} in room ${roomId}`,
              ),
      });
      for (const row of append) await this.db.havocMultiplayerCommands.put(row);
    });
  }
  async loadCommands(roomId: string): Promise<HavocMultiplayerCommand[]> {
    const rows = await this.db.havocMultiplayerCommands
      .where('roomId')
      .equals(roomId)
      .sortBy('ordinal');
    return rows.map((row) => {
      const parsed = storedHavocMultiplayerCommandRowSchema.parse(row);
      return havocMultiplayerCommandSchema.parse({
        schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        commandId: parsed.commandId,
        roomId: parsed.roomId,
        actorParticipantId: parsed.actorParticipantId,
        payload: parsed.payload,
      });
    });
  }
  async saveResult(output: HavocMultiplayerGameOutput): Promise<void> {
    const validated = havocMultiplayerGameOutputSchema.parse(output);
    const key: [string, number] = [validated.roomId, validated.gameNumber];
    await this.db.transaction('rw', this.db.havocMultiplayerResults, async () => {
      await putResultPreservingVerified({
        table: this.db.havocMultiplayerResults,
        key,
        parse: (row) => storedHavocMultiplayerResultRowSchema.parse(row),
        build: (verified) =>
          storedHavocMultiplayerResultRowSchema.parse({
            saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
            roomId: validated.roomId,
            gameNumber: validated.gameNumber,
            winner: validated.winner,
            result: validated.result,
            tape: validated.tape,
            inputDigest: validated.inputDigest,
            resultDigest: validated.resultDigest,
            tapeDigest: validated.tapeDigest,
            verified,
            storedAtIso: new Date().toISOString(),
          }),
      });
    });
  }
  async loadResults(roomId: string): Promise<StoredHavocMultiplayerResultRow[]> {
    const rows = await this.db.havocMultiplayerResults
      .where('roomId')
      .equals(roomId)
      .sortBy('gameNumber');
    return rows.map((row) => storedHavocMultiplayerResultRowSchema.parse(row));
  }
  async saveVerification(
    roomId: string,
    entries: readonly HavocMultiplayerVerificationReceipt[],
  ): Promise<void> {
    const verification = havocMultiplayerVerificationReceiptSchema.array().parse(entries);
    await this.db.transaction(
      'rw',
      [this.db.havocMultiplayerActive, this.db.havocMultiplayerResults],
      async () => {
        const active = await this.db.havocMultiplayerActive.get(roomId);
        if (active !== undefined) {
          const parsed = storedHavocMultiplayerActiveSchema.parse(active);
          await this.db.havocMultiplayerActive.put({
            ...parsed,
            verification,
            updatedAtIso: new Date().toISOString(),
          });
        }
        const verifiedDigests = new Set(verification.map((entry) => entry.resultDigest));
        const rows = await rowsWhereEquals(this.db.havocMultiplayerResults, 'roomId', roomId);
        for (const row of rows) {
          const parsedRow = storedHavocMultiplayerResultRowSchema.parse(row);
          const verified = verifiedDigests.has(parsedRow.resultDigest);
          if (parsedRow.verified === verified) continue;
          await this.db.havocMultiplayerResults.put({ ...parsedRow, verified });
        }
      },
    );
  }
  async complete(recap: HavocMultiplayerCompletionRecap): Promise<void> {
    const validated = havocMultiplayerCompletionRecapSchema.parse(recap);
    const completedAtIso = new Date().toISOString();
    const completed: StoredHavocMultiplayerCompleted = storedHavocMultiplayerCompletedSchema.parse({
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: validated.roomId,
      champion: validated.champion,
      series: validated.series,
      mvp: validated.mvp,
      games: validated.games,
      completedAtIso,
    });
    const index: StoredHavocMultiplayerHistoryIndex =
      storedHavocMultiplayerHistoryIndexSchema.parse({
        saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        recordId: `hvm-${validated.roomId}`,
        roomId: validated.roomId,
        championParticipantId: validated.champion,
        wins: validated.series.wins[validated.champion],
        completedAtIso,
      });
    await this.db.transaction(
      'rw',
      [
        this.db.havocMultiplayerActive,
        this.db.havocMultiplayerCommands,
        this.db.havocMultiplayerCompleted,
        this.db.havocMultiplayerHistory,
        this.db.havocMultiplayerResults,
        this.db.profileBindings,
        this.db.profileGames,
        this.db.profiles,
        this.db.archivedProfiles,
      ],
      async () => {
        const bindingId = `havoc-multiplayer:${validated.roomId}`;
        const binding = await this.db.profileBindings.get(bindingId);
        const participant = binding ? profileBindingSchema.parse(binding).participantId : undefined;
        if (participant) {
          const activeRow = await this.db.havocMultiplayerActive.get(validated.roomId);
          const active = activeRow ? storedHavocMultiplayerActiveSchema.parse(activeRow) : null;
          const profileRepo = new DexieProfileRepository(this.db);
          const achievementGames: SeriesAchievementFacts['games'][number][] = [];
          for (const game of validated.games) {
            if (game.winner === null) continue;
            const row = await this.db.havocMultiplayerResults.get([
              validated.roomId,
              game.gameNumber,
            ]);
            const parsedRow = row ? storedHavocMultiplayerResultRowSchema.parse(row) : undefined;
            const result = parsedRow?.result ?? null;
            const side = game.homeParticipantId === participant ? 'home' : 'away';
            await profileRepo.recordGame(bindingId, String(game.gameNumber), {
              won: game.winner === participant,
              multiplayer: true,
              players: result?.[side].participants ?? [],
            });
            const scores = verifiedScores(game, parsedRow);
            achievementGames.push({
              gameNumber: game.gameNumber,
              winner: game.winner,
              homeScore: scores?.homeScore ?? Number.NaN,
              awayScore: scores?.awayScore ?? Number.NaN,
            });
          }
          await profileRepo.recordMatch(bindingId, validated.champion === participant);
          await profileRepo.awardAchievements(
            bindingId,
            'series',
            evaluateSeriesAchievements({
              seriesId: SERIES_ACHIEVEMENT_LABEL,
              participantId: participant,
              games: achievementGames,
              averageOriginalOverall: averageOriginalOverall(active?.snapshot.draft ?? null),
            }),
          );
        }
        await this.db.havocMultiplayerCompleted.put(completed);
        await this.db.havocMultiplayerHistory.put(index);
        await this.db.havocMultiplayerActive.delete(validated.roomId);
        await deleteWhereEquals(this.db.havocMultiplayerCommands, 'roomId', validated.roomId);
      },
    );
  }
  async loadCompleted(roomId: string): Promise<StoredHavocMultiplayerCompleted | null> {
    return getParsedRecord(this.db.havocMultiplayerCompleted, roomId, (record) =>
      storedHavocMultiplayerCompletedSchema.parse(record),
    );
  }
  async listHistory(): Promise<StoredHavocMultiplayerHistoryIndex[]> {
    return listCompletedHistory(this.db.havocMultiplayerHistory);
  }
}
export type HavocMultiplayerRepository = DexieHavocMultiplayerRepository;
