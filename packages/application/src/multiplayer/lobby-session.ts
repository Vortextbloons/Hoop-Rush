import {
  multiplayerLobbySchema,
  multiplayerRoomLookupSchema,
  multiplayerRoomPreviewSchema,
  type MultiplayerLobby,
  type MultiplayerLobbyCommand,
} from '@hoop-rush/data-contracts';
import { intervalTickScheduler, SessionEvents, type TickScheduler } from '../runtime/index.ts';
import { RoomLifecycle, type RoomAttachment, type RoomConnection } from './room-lifecycle.ts';

export type MultiplayerGameKind = NonNullable<MultiplayerLobby['gameKind']>;
export type MultiplayerStartSettings = Extract<
  MultiplayerLobbyCommand,
  { kind: 'start' }
>['settings'];
export type MultiplayerRoomPreview = ReturnType<typeof multiplayerRoomPreviewSchema.parse>;
export type LobbyNavigation =
  | { kind: 'game'; gameKind: MultiplayerGameKind; roomId: string }
  | { kind: 'lobby'; lobbyId: string };

export interface LobbySessionSnapshot {
  lobby: MultiplayerLobby | null;
  preview: MultiplayerRoomPreview | null;
  busy: boolean;
  error: string | null;
  connection: RoomConnection;
  navigation: LobbyNavigation | null;
}

export interface LobbySessionDeps {
  command: (command: MultiplayerLobbyCommand) => Promise<unknown>;
  subscribe: (lobbyId: string, onChange: () => void, onError: (error: Error) => void) => () => void;
  resumeGame: (kind: MultiplayerGameKind, roomId: string) => Promise<void>;
  rememberLobby: (lobby: MultiplayerLobby) => void;
  friendlyError: (error: unknown) => string;
  scheduleTick?: TickScheduler;
}

export class LobbySession {
  private readonly events = new SessionEvents<never>();
  private readonly lifecycle = new RoomLifecycle(() => {
    this.events.publish();
  });
  private attachment: RoomAttachment | null = null;
  private lobby: MultiplayerLobby | null = null;
  private roomPreview: MultiplayerRoomPreview | null = null;
  private previewGeneration = 0;
  private busy = false;
  private error: string | null = null;
  private navigation: LobbyNavigation | null = null;
  private followedRoomId: string | null = null;
  private followingRoomId: string | null = null;
  private disposed = false;
  private operation = 0;

  private readonly deps: LobbySessionDeps;

  constructor(deps: LobbySessionDeps) {
    this.deps = deps;
  }

  getSnapshot(): LobbySessionSnapshot {
    return {
      lobby: this.lobby,
      preview: this.roomPreview,
      busy: this.busy,
      error: this.error,
      connection: this.lifecycle.getConnection(),
      navigation: this.navigation,
    };
  }

  subscribe(listener: () => void): () => void {
    return this.events.subscribe(listener);
  }

  acknowledgeNavigation(): void {
    this.navigation = null;
    this.events.publish();
  }

  async attach(lobbyId: string, options: { followCurrent?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (this.attachment?.roomId === lobbyId && this.attachment.current()) {
      await this.refresh();
      if (options.followCurrent) await this.resume();
      return;
    }
    this.operation += 1;
    this.busy = false;
    this.lobby = null;
    this.navigation = null;
    this.followedRoomId = null;
    this.followingRoomId = null;
    const attachment = this.lifecycle.begin(lobbyId);
    this.attachment = attachment;
    await this.fetch(attachment, options.followCurrent === true);
    this.lifecycle.configureRefresh(
      attachment,
      () => this.fetch(attachment, true),
      this.deps.scheduleTick ?? intervalTickScheduler,
      2000,
    );
    this.watch(attachment);
  }

  refresh(): Promise<void> {
    return this.lifecycle.refresh();
  }

  reconnect(): Promise<void> {
    return this.lifecycle.reconnect();
  }

  async create(): Promise<void> {
    await this.perform(async (current) => {
      const lobby = multiplayerLobbySchema.parse(await this.deps.command({ kind: 'create' }));
      if (!current()) return;
      this.adopt(lobby);
      this.navigation = { kind: 'lobby', lobbyId: lobby.id };
    });
  }

  async preview(code: string): Promise<void> {
    const generation = ++this.previewGeneration;
    await this.perform(async (current) => {
      try {
        const preview = multiplayerRoomPreviewSchema.parse(
          await this.deps.command({ kind: 'preview', code }),
        );
        if (current() && generation === this.previewGeneration) this.roomPreview = preview;
      } catch (error) {
        if (generation === this.previewGeneration) throw error;
      }
    });
  }

  clearPreview(): void {
    this.previewGeneration += 1;
    this.roomPreview = null;
    this.error = null;
    this.events.publish();
  }

  async join(code: string): Promise<void> {
    await this.perform(async (current) => {
      const result = multiplayerRoomLookupSchema.parse(
        await this.deps.command({ kind: 'join', code }),
      );
      if (!current()) return;
      if ('legacy' in result) {
        await this.openGame(result.gameKind, result.gameRoomId, current);
      } else {
        this.adopt(result);
        if (!result.canStart && result.gameKind && result.gameRoomId) {
          await this.openGame(
            result.gameKind,
            result.gameRoomId,
            () => this.attachment?.current() === true,
          );
        } else {
          this.navigation = { kind: 'lobby', lobbyId: result.id };
        }
      }
    });
  }

  async startMatch(settings: MultiplayerStartSettings): Promise<void> {
    const lobby = this.lobby;
    const attachment = this.attachment;
    if (!lobby || !attachment?.current()) return;
    await this.perform(async () => {
      const result = multiplayerLobbySchema.parse(
        await this.deps.command({
          kind: 'start',
          lobbyId: lobby.id,
          expectedRevision: lobby.revision,
          settings,
        }),
      );
      if (!attachment.current()) return;
      this.apply(result);
      if (result.gameKind && result.gameRoomId) {
        await this.openGame(result.gameKind, result.gameRoomId, attachment.current);
      }
    });
  }

  async resume(): Promise<void> {
    const lobby = this.lobby;
    const attachment = this.attachment;
    if (!lobby?.gameKind || !lobby.gameRoomId || !attachment?.current()) return;
    const { gameKind, gameRoomId } = lobby;
    await this.perform(() => this.openGame(gameKind, gameRoomId, attachment.current));
  }

  async leave(): Promise<void> {
    const lobby = this.lobby;
    const attachment = this.attachment;
    if (!lobby || !attachment?.current()) return;
    await this.perform(async () => {
      await this.deps.command({ kind: 'leave', lobbyId: lobby.id });
      if (!attachment.current()) return;
      this.lifecycle.detach();
      this.attachment = null;
      this.lobby = null;
      this.navigation = null;
      this.followedRoomId = null;
    });
  }

  async removeOpponent(): Promise<void> {
    const lobby = this.lobby;
    const attachment = this.attachment;
    if (!lobby || !attachment?.current()) return;
    await this.perform(async () => {
      const result = multiplayerLobbySchema.parse(
        await this.deps.command({ kind: 'remove-guest', lobbyId: lobby.id }),
      );
      if (attachment.current()) this.apply(result);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.lifecycle.dispose();
    this.events.dispose();
  }

  private adopt(lobby: MultiplayerLobby): void {
    this.lobby = null;
    this.navigation = null;
    this.followedRoomId = lobby.gameRoomId;
    this.followingRoomId = null;
    const attachment = this.lifecycle.begin(lobby.id);
    this.attachment = attachment;
    this.apply(lobby);
    this.lifecycle.connected(attachment);
    this.lifecycle.configureRefresh(
      attachment,
      () => this.fetch(attachment, true),
      this.deps.scheduleTick ?? intervalTickScheduler,
      2000,
    );
    this.watch(attachment);
  }

  private watch(attachment: RoomAttachment): void {
    this.lifecycle.track(
      attachment,
      this.deps.subscribe(
        attachment.roomId,
        () => {
          if (attachment.current()) void this.refresh();
        },
        (error) => {
          if (!attachment.current()) return;
          this.lifecycle.failed(attachment);
          this.error = this.deps.friendlyError(error);
          this.events.publish();
        },
      ),
    );
  }

  private apply(lobby: MultiplayerLobby): boolean {
    if (this.lobby?.id === lobby.id && this.lobby.revision > lobby.revision) return false;
    this.lobby = lobby;
    this.deps.rememberLobby(lobby);
    return true;
  }

  private async fetch(attachment: RoomAttachment, follow: boolean): Promise<void> {
    try {
      const lobby = multiplayerLobbySchema.parse(
        await this.deps.command({ kind: 'get', lobbyId: attachment.roomId }),
      );
      if (!attachment.current() || !this.apply(lobby)) return;
      this.error = null;
      this.lifecycle.connected(attachment);
      if (
        follow &&
        lobby.participantId === 'p2' &&
        lobby.gameKind &&
        lobby.gameRoomId &&
        this.followedRoomId !== lobby.gameRoomId
      ) {
        await this.openGame(lobby.gameKind, lobby.gameRoomId, attachment.current);
      } else if (!follow) {
        this.followedRoomId = lobby.gameRoomId;
      }
      this.events.publish();
    } catch (error) {
      if (!attachment.current()) return;
      this.error = this.deps.friendlyError(error);
      this.lifecycle.failed(attachment);
      this.events.publish();
    }
  }

  private async openGame(
    kind: MultiplayerGameKind,
    roomId: string,
    current: () => boolean,
  ): Promise<void> {
    if (this.followingRoomId === roomId) return;
    this.followingRoomId = roomId;
    try {
      await this.deps.resumeGame(kind, roomId);
      if (!current() || this.disposed) return;
      this.followedRoomId = roomId;
      this.navigation = { kind: 'game', gameKind: kind, roomId };
      this.events.publish();
    } finally {
      if (this.followingRoomId === roomId) this.followingRoomId = null;
    }
  }

  private async perform(action: (current: () => boolean) => Promise<void>): Promise<void> {
    if (this.disposed || this.busy) return;
    const operation = ++this.operation;
    const current = () => !this.disposed && this.operation === operation;
    this.busy = true;
    this.error = null;
    this.events.publish();
    try {
      await action(current);
    } catch (error) {
      if (current()) this.error = this.deps.friendlyError(error);
    } finally {
      if (current()) {
        this.busy = false;
        this.events.publish();
      }
    }
  }
}
