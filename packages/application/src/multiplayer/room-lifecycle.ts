import { CoalescedTask, type TickScheduler } from '../runtime/index.ts';

export type RoomConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type RoomParticipantId = 'p1' | 'p2';

export interface RoomSessionTransport<TSnapshot, TMembership, TTransient> {
  resume(roomId: string): Promise<{ snapshot: TSnapshot; membership: TMembership }>;
  subscribe(
    roomId: string,
    onSnapshot: () => void,
    onError: (error: unknown) => void,
  ): { unsubscribe: () => void };
  subscribeTransient(
    roomId: string,
    listener: (event: TTransient) => void,
  ): { unsubscribe: () => void };
}

export interface RoomSessionRepository<TVerification, TCompleted, TOutput> {
  loadActive(roomId: string): Promise<TVerification | null>;
  loadCompleted(roomId: string): Promise<TCompleted | null>;
  loadResults(roomId: string): Promise<TOutput[]>;
}

export function shouldCreateRematch(input: {
  participantId: RoomParticipantId | null;
  phase: string;
  successorRoomId: string | null | undefined;
  now: number;
  retryAtMs: number;
  commands: readonly { payload: { kind: string } }[];
}): boolean {
  return (
    input.participantId === 'p1' &&
    input.phase === 'championship' &&
    !input.successorRoomId &&
    input.now >= input.retryAtMs &&
    input.commands.some((command) => command.payload.kind === 'rematch-confirm')
  );
}

export interface RoomAttachment {
  readonly generation: number;
  readonly roomId: string;
  current: () => boolean;
}

export class RoomLifecycle {
  private generation = 0;
  private roomId: string | null = null;
  private disposed = false;
  private subscriptions: Array<() => void> = [];
  private stopPolling: (() => void) | null = null;
  private connection: RoomConnection = 'idle';
  private refreshTask: CoalescedTask | null = null;

  private readonly changed: () => void;

  constructor(changed: () => void = () => {}) {
    this.changed = changed;
  }

  getConnection(): RoomConnection {
    return this.connection;
  }

  begin(roomId: string): RoomAttachment {
    this.detach();
    this.roomId = roomId;
    const generation = this.generation;
    const attachment = {
      generation,
      roomId,
      current: () => !this.disposed && this.generation === generation && this.roomId === roomId,
    };
    if (!this.disposed) this.setConnection('connecting');
    return attachment;
  }

  track(attachment: RoomAttachment, unsubscribe: () => void): void {
    if (!attachment.current()) unsubscribe();
    else this.subscriptions.push(unsubscribe);
  }

  connected(attachment: RoomAttachment): void {
    if (attachment.current()) this.setConnection('connected');
  }

  failed(attachment: RoomAttachment): void {
    if (attachment.current()) this.setConnection('error');
  }

  configureRefresh(
    attachment: RoomAttachment,
    refresh: () => Promise<void>,
    schedule: TickScheduler,
    intervalMs: number,
  ): void {
    if (!attachment.current()) return;
    this.stopPolling?.();
    const task = new CoalescedTask(async () => {
      if (attachment.current()) await refresh();
    });
    this.refreshTask = task;
    this.stopPolling = schedule(() => {
      if (attachment.current()) void task.request(false);
    }, intervalMs);
  }

  refresh(): Promise<void> {
    return this.refreshTask?.request() ?? Promise.resolve();
  }

  reconnect(): Promise<void> {
    if (this.disposed || this.roomId === null) return Promise.resolve();
    this.setConnection('reconnecting');
    return this.refresh();
  }

  detach(): void {
    this.generation += 1;
    this.roomId = null;
    this.stopPolling?.();
    this.stopPolling = null;
    this.refreshTask = null;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.setConnection('idle');
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
  }

  private setConnection(connection: RoomConnection): void {
    if (this.connection === connection) return;
    this.connection = connection;
    this.changed();
  }
}
