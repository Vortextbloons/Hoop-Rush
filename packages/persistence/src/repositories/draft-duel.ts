import {
  draftDuelGameOutputSchema,
  draftDuelPartiallyVerifiedSchema,
  type DraftDuelCommand,
  type DraftDuelGameOutput,
  type DraftDuelPartiallyVerified,
} from '@hoop-rush/data-contracts';
import {
  evaluateIndividualGameAchievements,
  evaluateSeriesAchievements,
  individualGameLineFromBoxScore,
  type IndividualAchievement,
  type SeriesAchievementFacts,
} from '@hoop-rush/engine';
import {
  DRAFT_DUEL_SAVE_SCHEMA_VERSION,
  draftDuelCompletionRecapSchema,
  storedDraftDuelActiveSchema,
  storedDraftDuelCommandRowSchema,
  storedDraftDuelCompletedSchema,
  storedDraftDuelHistoryIndexSchema,
  storedDraftDuelResultRowSchema,
  type DraftDuelActiveState,
  type DraftDuelCompletionRecap,
  type StoredDraftDuelActive,
  type StoredDraftDuelCompleted,
  type StoredDraftDuelHistoryIndex,
  type StoredDraftDuelResultRow,
} from '../schemas/draft-duel-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  commandReceiptMatches,
  appendRoomCommandRows,
  averageDraftOverall,
  deleteWhereEquals,
  getParsedRecord,
  listCompletedHistory,
  putResultPreservingVerified,
  saveActiveVerification,
} from './support.ts';

const SERIES_ACHIEVEMENT_LABEL = 'Draft Duel';

function verifiedScores(
  active: StoredDraftDuelActive,
  gameNumber: number,
  row: StoredDraftDuelResultRow | undefined,
): { homeScore: number; awayScore: number } | null {
  if (!row) return null;
  const verification = active.verification.find(
    (entry) => entry.gameNumber === gameNumber && entry.status === 'verified',
  );
  if (!verification || verification.localResultDigest !== row.output.resultDigest) return null;
  return {
    homeScore: row.output.result.home.box.points,
    awayScore: row.output.result.away.box.points,
  };
}

export class DexieDraftDuelRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }
  async saveActive(state: DraftDuelActiveState): Promise<void> {
    const record: StoredDraftDuelActive = storedDraftDuelActiveSchema.parse({
      ...state,
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      updatedAtIso: new Date().toISOString(),
    });
    await this.db.draftDuelActive.put(record);
  }
  async loadActive(roomId: string): Promise<StoredDraftDuelActive | null> {
    return getParsedRecord(this.db.draftDuelActive, roomId, (row) =>
      storedDraftDuelActiveSchema.parse(row),
    );
  }
  async appendCommands(roomId: string, commands: readonly DraftDuelCommand[]): Promise<void> {
    if (commands.length === 0) return;
    const updatedAtIso = new Date().toISOString();
    const rows = commands.map((command) => {
      if (command.roomId !== roomId) {
        throw new Error(
          `appendCommands: command ${String(command.commandId)} does not belong to room ${roomId}`,
        );
      }
      return storedDraftDuelCommandRowSchema.parse({
        saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
        roomId,
        ordinal: command.ordinal,
        command,
        updatedAtIso,
      });
    });
    await appendRoomCommandRows(
      this.db.draftDuelCommands,
      roomId,
      rows,
      (row) => storedDraftDuelCommandRowSchema.parse(row),
      {
        matches: (stored, incoming) => commandReceiptMatches(stored.command, incoming.command),
        conflict: (_kind, row) =>
          new Error(
            `appendCommands: conflicting command at ordinal ${String(row.ordinal)} in room ${roomId}`,
          ),
      },
    );
  }
  async loadCommands(roomId: string): Promise<DraftDuelCommand[]> {
    const rows = await this.db.draftDuelCommands.where('roomId').equals(roomId).sortBy('ordinal');
    return rows.map((row) => storedDraftDuelCommandRowSchema.parse(row).command);
  }
  async saveResult(output: DraftDuelGameOutput): Promise<void> {
    const validated = draftDuelGameOutputSchema.parse(output);
    const key: [string, number] = [validated.roomId, validated.gameNumber];
    await putResultPreservingVerified({
      table: this.db.draftDuelResults,
      key,
      parse: (row) => storedDraftDuelResultRowSchema.parse(row),
      build: (verified) =>
        storedDraftDuelResultRowSchema.parse({
          saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
          roomId: validated.roomId,
          gameNumber: validated.gameNumber,
          output: validated,
          verified,
          storedAtIso: new Date().toISOString(),
        }),
    });
  }
  async loadResults(roomId: string): Promise<StoredDraftDuelResultRow[]> {
    const rows = await this.db.draftDuelResults.where('roomId').equals(roomId).sortBy('gameNumber');
    return rows.map((row) => storedDraftDuelResultRowSchema.parse(row));
  }
  async saveVerification(
    roomId: string,
    entries: readonly DraftDuelPartiallyVerified[],
  ): Promise<void> {
    const verification = draftDuelPartiallyVerifiedSchema.array().parse(entries);
    await this.db.transaction(
      'rw',
      [this.db.draftDuelActive, this.db.draftDuelResults],
      async () => {
        await saveActiveVerification(this.db.draftDuelActive, roomId, verification, (row) =>
          storedDraftDuelActiveSchema.parse(row),
        );
        for (const entry of verification) {
          const row = await this.db.draftDuelResults.get([roomId, entry.gameNumber]);
          if (row === undefined) continue;
          const parsedRow = storedDraftDuelResultRowSchema.parse(row);
          const verified = entry.status === 'verified';
          if (parsedRow.verified === verified) continue;
          await this.db.draftDuelResults.put({ ...parsedRow, verified });
        }
      },
    );
  }
  async complete(recap: DraftDuelCompletionRecap): Promise<void> {
    const validated = draftDuelCompletionRecapSchema.parse(recap);
    const completedAtIso = new Date().toISOString();
    const completed: StoredDraftDuelCompleted = storedDraftDuelCompletedSchema.parse({
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      roomId: validated.roomId,
      champion: validated.champion,
      series: validated.series,
      mvp: validated.mvp,
      standouts: validated.standouts,
      games: validated.games,
      completedAtIso,
    });
    const index: StoredDraftDuelHistoryIndex = storedDraftDuelHistoryIndexSchema.parse({
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      recordId: `dd-${validated.roomId}`,
      roomId: validated.roomId,
      champion: validated.champion,
      gameCount: validated.games,
      completedAtIso,
    });
    await this.db.transaction(
      'rw',
      [
        this.db.draftDuelActive,
        this.db.draftDuelCommands,
        this.db.draftDuelCompleted,
        this.db.draftDuelHistory,
        this.db.draftDuelResults,
        this.db.profileBindings,
        this.db.profileGames,
        this.db.profiles,
        this.db.archivedProfiles,
      ],
      async () => {
        const activeRow = await this.db.draftDuelActive.get(validated.roomId);
        const active = activeRow ? storedDraftDuelActiveSchema.parse(activeRow) : null;
        const bindingId = `draft-duel:${validated.roomId}`;
        if (active && (await this.db.profileBindings.get(bindingId))) {
          const participant = active.localParticipantId;
          const profileRepo = new DexieProfileRepository(this.db);
          const achievementGames: SeriesAchievementFacts['games'][number][] = [];
          const individualCandidates: IndividualAchievement[] = [];
          const displayNames = new Map(
            active.draft?.status === 'complete'
              ? active.draft.rounds
                  .flatMap((round) => round.picks)
                  .map((pick) => [pick.card.playerId, pick.card.displayName])
              : [],
          );
          for (const game of validated.series.games) {
            const row = await this.db.draftDuelResults.get([validated.roomId, game.gameNumber]);
            const parsedRow = row ? storedDraftDuelResultRowSchema.parse(row) : undefined;
            const output = parsedRow?.output ?? null;
            const side = game.homeParticipantId === participant ? 'home' : 'away';
            const players = output?.result[side].players ?? [];
            await profileRepo.recordGame(bindingId, String(game.gameNumber), {
              won: game.winner === participant,
              multiplayer: true,
              players,
            });
            if (output !== null) {
              individualCandidates.push(
                ...evaluateIndividualGameAchievements({
                  mode: 'multiplayer',
                  players: players.map((line) =>
                    individualGameLineFromBoxScore(line, displayNames.get(line.playerId) ?? null),
                  ),
                }),
              );
            }
            const scores = verifiedScores(active, game.gameNumber, parsedRow);
            achievementGames.push({
              gameNumber: game.gameNumber,
              winner: game.winner,
              homeScore: scores?.homeScore ?? Number.NaN,
              awayScore: scores?.awayScore ?? Number.NaN,
            });
          }
          await profileRepo.recordMatch(bindingId, validated.champion === participant);
          await profileRepo.awardAchievements(bindingId, 'individual-games', individualCandidates);
          await profileRepo.awardAchievements(
            bindingId,
            'series',
            evaluateSeriesAchievements({
              seriesId: SERIES_ACHIEVEMENT_LABEL,
              participantId: participant,
              games: achievementGames,
              averageOriginalOverall: averageDraftOverall(
                active.draft?.status === 'complete'
                  ? active.draft.rounds.flatMap((round) => round.picks)
                  : [],
                (pick) => pick.card.overall,
              ),
            }),
          );
        }
        await this.db.draftDuelCompleted.put(completed);
        await this.db.draftDuelHistory.put(index);
        await this.db.draftDuelActive.delete(validated.roomId);
        await deleteWhereEquals(this.db.draftDuelCommands, 'roomId', validated.roomId);
      },
    );
  }
  async loadCompleted(roomId: string): Promise<StoredDraftDuelCompleted | null> {
    return getParsedRecord(this.db.draftDuelCompleted, roomId, (row) =>
      storedDraftDuelCompletedSchema.parse(row),
    );
  }
  async listHistory(): Promise<StoredDraftDuelHistoryIndex[]> {
    return listCompletedHistory(this.db.draftDuelHistory);
  }
}
export type DraftDuelRepository = DexieDraftDuelRepository;
