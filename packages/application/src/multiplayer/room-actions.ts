import { commandIdSchema, type CommandId } from '@hoop-rush/data-contracts';
import {
  CommandRecovery,
  executeMultiplayerCommand,
  type RecoveredCommandReceipt,
} from './command-execution.ts';

export type RoomActionOutcome<T> =
  | { kind: 'succeeded'; value: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'abandoned' | 'busy' };

export class RoomActions {
  private state = { busy: false, recovery: new CommandRecovery() };
  get busy(): boolean {
    return this.state.busy;
  }
  reset(): void {
    this.state = { busy: false, recovery: new CommandRecovery() };
  }

  async run<T>(action: () => Promise<T>): Promise<RoomActionOutcome<T>> {
    const state = this.state;
    if (state.busy) return { kind: 'busy' };
    state.busy = true;
    try {
      const value = await action();
      return { kind: 'succeeded', value };
    } catch (error) {
      return this.state === state ? { kind: 'failed', error } : { kind: 'abandoned' };
    } finally {
      state.busy = false;
    }
  }

  async submit<TCommand extends { commandId: string }>(input: {
    payload: unknown;
    current(): boolean;
    newCommandId(): string;
    build(id: CommandId): TCommand;
    submit(command: TCommand): Promise<RecoveredCommandReceipt>;
    sync(): Promise<void>;
    rejectedLabel: string;
  }): Promise<'accepted' | 'abandoned' | 'busy'> {
    if (!input.current()) return 'abandoned';
    const state = this.state;
    if (state.busy) return 'busy';
    state.busy = true;
    try {
      const id = commandIdSchema.parse(
        state.recovery.id(input.payload, () => input.newCommandId()),
      );
      const report = await executeMultiplayerCommand(input.build(id), {
        submit: (command) => input.submit(command),
        classify: (receipt) =>
          receipt.accepted
            ? 'accepted'
            : receipt.rejectionCode === 'stale-revision'
              ? 'stale'
              : 'rejected',
      });
      if (!input.current() || this.state !== state) return 'abandoned';
      if (report.receipt) state.recovery.settled(input.payload);
      if (!report.receipt?.accepted)
        throw new Error(`${input.rejectedLabel}: ${report.receipt?.rejectionCode ?? 'unknown'}`);
      await input.sync();
      return input.current() && this.state === state ? 'accepted' : 'abandoned';
    } finally {
      state.busy = false;
    }
  }
}
