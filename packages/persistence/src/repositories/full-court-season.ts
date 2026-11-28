import {
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  capRushLeagueGameId,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  fullCourtWatchedReplaySchema,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import {
  fullCourtSeasonCheckpointRecordSchema,
  fullCourtSeasonScoreRecordSchema,
  type StoredFullCourtSeasonCheckpoint,
  type StoredFullCourtSeasonScore,
} from '../schemas/full-court-season-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { putWatchedReplayRecord, verifyWatchedReplayRetry } from './full-court-replay.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  parseRecord,
  type ParseableSchema,
} from './support.ts';

const GAMES_PER_SLOT = CAP_RUSH_TAKEOVER_TEAMS / 2;

export type FullCourtSeasonCommitResult =
  { readonly status: 'committed' } | { readonly status: 'replayed' };

type SlotCommitOutcome =
  | { readonly kind: 'committed' }
  | { readonly kind: 'replayed' }
  | { readonly kind: 'rejected'; readonly message: string };

function rejected(message: string): SlotCommitOutcome {
  return { kind: 'rejected', message };
}

function invalidSave(message: string): Error {
  return new Error(`Invalid Full Court season save: ${message}`);
}

function parseCheckpointRecord<T>(schema: ParseableSchema<T>, row: unknown): T {
  assertSaveSchemaVersion(row, FULL_COURT_SEASON_SAVE_SCHEMA_VERSION, invalidSave);
  return parseRecord(schema, row, 'checkpoint', invalidSave);
}

function parseScoreRecord(row: unknown): StoredFullCourtSeasonScore {
  assertSaveSchemaVersion(row, FULL_COURT_SEASON_SAVE_SCHEMA_VERSION, invalidSave);
  return parseRecord(fullCourtSeasonScoreRecordSchema, row, 'score', invalidSave);
}

function sortScores(scores: readonly FullCourtSeasonScore[]): FullCourtSeasonScore[] {
  return [...scores].sort(
    (left, right) => left.slot - right.slot || left.gameId.localeCompare(right.gameId),
  );
}

function validateSlotScores(
  checkpoint: FullCourtSeasonCheckpoint,
  scores: readonly FullCourtSeasonScore[],
  previous: FullCourtSeasonCheckpoint | null,
): void {
  if (scores.length !== GAMES_PER_SLOT) {
    throw new Error(
      `Full Court season slot ${String(checkpoint.completedThroughSlot)} requires ${String(GAMES_PER_SLOT)} scores`,
    );
  }
  const gameIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const score of scores) {
    if (score.slot !== checkpoint.completedThroughSlot) {
      throw new Error(
        `Full Court season score ${score.gameId} does not belong to committed slot ${String(checkpoint.completedThroughSlot)}`,
      );
    }
    if (score.gameId !== capRushLeagueGameId(score.slot, score.homeTeamId, score.awayTeamId)) {
      throw new Error(`Full Court season score ${score.gameId} does not match its slot and teams`);
    }
    if (gameIds.has(score.gameId)) {
      throw new Error(`Full Court season slot ${String(score.slot)} repeats game ${score.gameId}`);
    }
    gameIds.add(score.gameId);
    for (const teamId of [score.homeTeamId, score.awayTeamId]) {
      if (teamIds.has(teamId)) {
        throw new Error(`Full Court season slot ${String(score.slot)} repeats team ${teamId}`);
      }
      teamIds.add(teamId);
    }
  }
  const healthTeams = Object.keys(checkpoint.healthByTeam);
  if (healthTeams.length !== CAP_RUSH_TAKEOVER_TEAMS) {
    throw new Error(
      `Full Court season checkpoint requires ${String(CAP_RUSH_TAKEOVER_TEAMS)} health rows`,
    );
  }
  for (const teamId of healthTeams) {
    if (!teamIds.has(teamId)) {
      throw new Error(`Full Court season health row ${teamId} does not match a committed fixture`);
    }
    const prior = previous?.healthByTeam[teamId];
    const health = checkpoint.healthByTeam[teamId];
    if (previous !== null && previous.completedThroughSlot > 0 && health !== undefined) {
      if (prior === undefined) {
        throw new Error(`Full Court season checkpoint is missing prior health for ${teamId}`);
      }
      if (health.throughDay <= prior.throughDay) {
        throw new Error(
          `Full Court season health for ${teamId} does not advance past day ${String(prior.throughDay)}`,
        );
      }
    }
  }
}

function validateSlotWatchedReplay(
  checkpoint: FullCourtSeasonCheckpoint,
  scores: readonly FullCourtSeasonScore[],
  replay: FullCourtWatchedReplay,
): void {
  if (replay.identity.phase !== 'regular') {
    throw new Error('Full Court season watched replay must belong to regular season');
  }
  if (
    replay.identity.runId !== checkpoint.runId ||
    replay.identity.lockDigest !== checkpoint.lockDigest ||
    replay.identity.seasonLockDigest !== checkpoint.lockDigest
  ) {
    throw new Error('Full Court watched replay does not match the season checkpoint lock');
  }
  if (replay.identity.slot !== checkpoint.completedThroughSlot) {
    throw new Error(
      `Full Court watched replay slot ${String(replay.identity.slot)} does not match slot ${String(checkpoint.completedThroughSlot)}`,
    );
  }
  const score = scores.find((entry) => entry.gameId === replay.identity.gameId);
  if (
    score === undefined ||
    score.homeTeamId !== replay.identity.homeTeamId ||
    score.awayTeamId !== replay.identity.awayTeamId
  ) {
    throw new Error(
      `Full Court watched replay game ${replay.identity.gameId} is missing from committed slot scores`,
    );
  }
  if (score.outcome.kind !== 'played') {
    throw new Error('Forfeit games cannot carry a watched replay');
  }
  if (
    score.outcome.homePoints !== replay.result.home.box.points ||
    score.outcome.awayPoints !== replay.result.away.box.points
  ) {
    throw new Error('Full Court watched replay score disagrees with committed slot score');
  }
  if (
    !canonicalEquals(checkpoint.healthByTeam[replay.identity.homeTeamId], replay.health.home) ||
    !canonicalEquals(checkpoint.healthByTeam[replay.identity.awayTeamId], replay.health.away)
  ) {
    throw new Error('Full Court watched replay health disagrees with committed slot health');
  }
}

export class DexieFullCourtSeasonRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  private getCheckpointRecord(runId: string): Promise<StoredFullCourtSeasonCheckpoint | null> {
    return getParsedRecord(this.db.fullCourtSeasonCheckpoints, runId, (row) =>
      parseCheckpointRecord(fullCourtSeasonCheckpointRecordSchema, row),
    );
  }

  private async scoresOfSlot(runId: string, slot: number): Promise<FullCourtSeasonScore[]> {
    const prefix = `crl-${String(slot).padStart(2, '0')}-`;
    const rows = await this.db.fullCourtSeasonScores
      .where('[runId+gameId]')
      .between([runId, prefix], [runId, `${prefix}\uffff`])
      .toArray();
    return sortScores(
      rows.filter((row) => row.score.slot === slot).map((row) => parseScoreRecord(row).score),
    );
  }

  async load(runId: string): Promise<FullCourtSeasonCheckpoint | null> {
    const row = await this.getCheckpointRecord(runId);
    return row?.checkpoint ?? null;
  }

  async listScores(runId: string): Promise<FullCourtSeasonScore[]> {
    const rows = await this.db.fullCourtSeasonScores.where('runId').equals(runId).toArray();
    return sortScores(rows.map((row) => parseScoreRecord(row).score));
  }

  async create(checkpoint: FullCourtSeasonCheckpoint): Promise<void> {
    const validated = fullCourtSeasonCheckpointSchema.parse(checkpoint);
    if (validated.completedThroughSlot !== 0) {
      throw new Error('Full Court season must start from an empty checkpoint');
    }
    const { fullCourtSeasonCheckpoints, fullCourtSeasonScores } = this.db;
    const failure = await this.db.transaction(
      'rw',
      [fullCourtSeasonCheckpoints, fullCourtSeasonScores],
      async (): Promise<string | null> => {
        const existing = await this.getCheckpointRecord(validated.runId);
        if (existing !== null) {
          return canonicalEquals(existing.checkpoint, validated)
            ? null
            : `Full Court season checkpoint for ${validated.runId} already exists`;
        }
        if ((await fullCourtSeasonScores.where('runId').equals(validated.runId).count()) > 0) {
          return `Full Court season scores for ${validated.runId} have no checkpoint`;
        }
        await fullCourtSeasonCheckpoints.put(
          fullCourtSeasonCheckpointRecordSchema.parse({
            saveSchemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
            runId: validated.runId,
            checkpoint: validated,
          }),
        );
        return null;
      },
    );
    if (failure !== null) throw new Error(failure);
  }

  async commitSlot(
    checkpoint: FullCourtSeasonCheckpoint,
    scores: readonly FullCourtSeasonScore[],
    options?: { readonly watchedReplay?: FullCourtWatchedReplay },
  ): Promise<FullCourtSeasonCommitResult> {
    const validated = fullCourtSeasonCheckpointSchema.parse(checkpoint);
    const validatedScores = scores.map((score) => fullCourtSeasonScoreSchema.parse(score));
    const validatedReplay =
      options?.watchedReplay === undefined
        ? undefined
        : fullCourtWatchedReplaySchema.parse(options.watchedReplay);
    if (validated.completedThroughSlot === 0) {
      throw new Error('Full Court season slot commits must advance past the initial checkpoint');
    }
    if (validatedReplay !== undefined) {
      validateSlotWatchedReplay(validated, validatedScores, validatedReplay);
    }
    const { fullCourtSeasonCheckpoints, fullCourtSeasonScores, fullCourtWatchedReplays } = this.db;
    const outcome = await this.db.transaction(
      'rw',
      [
        fullCourtSeasonCheckpoints,
        fullCourtSeasonScores,
        ...(validatedReplay === undefined ? [] : [fullCourtWatchedReplays]),
      ],
      async (): Promise<SlotCommitOutcome> => {
        const existing = await this.getCheckpointRecord(validated.runId);
        if (existing === null) {
          return rejected(
            `Full Court season checkpoint for ${validated.runId} has not been created`,
          );
        }
        const previous = existing.checkpoint;
        if (previous.lockDigest !== validated.lockDigest) {
          return rejected(
            `Full Court season lock digest does not match the checkpoint for ${validated.runId}`,
          );
        }
        const storedScores = await this.scoresOfSlot(
          validated.runId,
          validated.completedThroughSlot,
        );
        if (validated.completedThroughSlot === previous.completedThroughSlot) {
          if (
            canonicalEquals(previous, validated) &&
            canonicalEquals(storedScores, sortScores(validatedScores))
          ) {
            if (validatedReplay !== undefined) {
              const conflict = await verifyWatchedReplayRetry(
                fullCourtWatchedReplays,
                validatedReplay,
              );
              if (conflict !== null) return rejected(conflict);
            }
            return { kind: 'replayed' };
          }
          return rejected(
            `Full Court season slot ${String(validated.completedThroughSlot)} was already committed with different results`,
          );
        }
        if (validated.completedThroughSlot < previous.completedThroughSlot) {
          return rejected(
            `Full Court season slot ${String(validated.completedThroughSlot)} is stale; ${validated.runId} is committed through ${String(previous.completedThroughSlot)}`,
          );
        }
        if (validated.completedThroughSlot !== previous.completedThroughSlot + 1) {
          return rejected(
            `Full Court season slot ${String(validated.completedThroughSlot)} is out of order; expected ${String(previous.completedThroughSlot + 1)}`,
          );
        }
        try {
          validateSlotScores(validated, validatedScores, previous);
        } catch (error) {
          return rejected(error instanceof Error ? error.message : String(error));
        }
        if (storedScores.length > 0) {
          return rejected(
            `Full Court season slot ${String(validated.completedThroughSlot)} already has stored scores`,
          );
        }
        await fullCourtSeasonScores.bulkPut(
          validatedScores.map((score) =>
            fullCourtSeasonScoreRecordSchema.parse({
              saveSchemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
              runId: validated.runId,
              gameId: score.gameId,
              score,
            }),
          ),
        );
        await fullCourtSeasonCheckpoints.put(
          fullCourtSeasonCheckpointRecordSchema.parse({
            saveSchemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
            runId: validated.runId,
            checkpoint: validated,
          }),
        );
        if (validatedReplay !== undefined) {
          await putWatchedReplayRecord(fullCourtWatchedReplays, validatedReplay);
        }
        return { kind: 'committed' };
      },
    );
    if (outcome.kind === 'rejected') throw new Error(outcome.message);
    return { status: outcome.kind };
  }
}

export function createFullCourtSeasonRepository(
  db: HoopRushDatabase,
): DexieFullCourtSeasonRepository {
  return new DexieFullCourtSeasonRepository(db);
}
