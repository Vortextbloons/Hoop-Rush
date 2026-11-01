import {
  canonicalJson,
  type FixedFiveCommand,
  type FixedFiveRoomSnapshot,
} from '@hoop-rush/data-contracts';
import type { FixedFiveRoomRepositoryPort } from './session.ts';

export class FixedFiveCheckpointWriter {
  private persistedOrdinal = -1;
  private savedKey: string | null = null;
  private error: string | null = null;

  private readonly repository: Pick<
    FixedFiveRoomRepositoryPort,
    'appendCommand' | 'saveActiveSnapshot'
  >;

  constructor(
    repository: Pick<FixedFiveRoomRepositoryPort, 'appendCommand' | 'saveActiveSnapshot'>,
  ) {
    this.repository = repository;
  }

  getError(): string | null {
    return this.error;
  }

  restore(lastOrdinal: number): void {
    this.persistedOrdinal = lastOrdinal;
  }

  async save(
    snapshot: FixedFiveRoomSnapshot,
    commands: readonly FixedFiveCommand[],
    lastOrdinal: number,
    current: () => boolean,
  ): Promise<boolean> {
    try {
      for (const command of commands) {
        if (!current()) return false;
        if (command.ordinal <= this.persistedOrdinal || command.ordinal > lastOrdinal) continue;
        await this.repository.appendCommand(command);
        if (!current()) return false;
        this.persistedOrdinal = command.ordinal;
      }
      const cursor = lastOrdinal + 1;
      const key = canonicalJson([snapshot, cursor]);
      if (key !== this.savedKey) {
        await this.repository.saveActiveSnapshot(snapshot, cursor);
        if (!current()) return false;
        this.savedKey = key;
      }
      this.error = null;
      return true;
    } catch (error) {
      if (current())
        this.error = `Could not save room progress: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  }
}
