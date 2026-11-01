import { mergeCommandLog } from './command-log.ts';

export interface RoomSyncSnapshot {
  revision: number;
  commandCount?: number;
}
export interface RoomSyncResponse<TSnapshot, TCommand> {
  snapshot: TSnapshot;
  commands: TCommand[];
  commandCount?: number;
}

export class RoomSynchronization<
  TSnapshot extends RoomSyncSnapshot,
  TCommand extends { commandId: string },
> {
  private state = { commands: [] as TCommand[], persistedCount: 0 };

  get commands(): TCommand[] {
    return this.state.commands;
  }
  get persistedCount(): number {
    return this.state.persistedCount;
  }
  reset(): void {
    this.state = { commands: [], persistedCount: 0 };
  }

  async fetch(input: {
    current(): boolean;
    sync(afterOrdinal: number): Promise<RoomSyncResponse<TSnapshot, TCommand>>;
    ordinalOf?: (command: TCommand) => number;
    revision(): number;
  }): Promise<{ snapshot: TSnapshot; commandsChanged: boolean } | null> {
    const state = this.state;
    const current = (): boolean => input.current() && this.state === state;
    let response = await input.sync(state.commands.length - 1);
    if (!current()) return null;
    const merge = (local: readonly TCommand[]) =>
      mergeCommandLog({
        local,
        fetched: response.commands,
        expectedCount: response.commandCount ?? response.snapshot.commandCount ?? local.length,
        ordinalOf: input.ordinalOf,
      });
    let merged = merge(state.commands);
    if (!merged.complete) {
      response = await input.sync(-1);
      if (!current()) return null;
      merged = merge([]);
      if (!merged.complete) throw new Error('room sync returned an incomplete command log');
    }
    if (response.snapshot.revision < input.revision()) return null;
    const commandsChanged = merged.commands.length !== state.commands.length;
    state.commands = merged.commands;
    return { snapshot: response.snapshot, commandsChanged };
  }

  async persist(
    current: () => boolean,
    append: (commands: readonly TCommand[]) => Promise<void>,
  ): Promise<boolean> {
    const state = this.state;
    const commands = state.commands;
    if (!current()) return false;
    if (commands.length > state.persistedCount) {
      await append(commands.slice(state.persistedCount));
      if (!current() || this.state !== state) return false;
      state.persistedCount = commands.length;
    }
    return true;
  }
}
