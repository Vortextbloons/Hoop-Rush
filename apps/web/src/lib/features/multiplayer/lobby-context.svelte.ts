import { getContext, setContext } from 'svelte';
import {
  LobbySession,
  type LobbyNavigation,
  type LobbySessionSnapshot,
  type MultiplayerStartSettings,
} from '@hoop-rush/application/multiplayer';
import {
  lobbyCommand,
  subscribeLobby,
  loadLobbyId,
  rememberLobby,
  resumeMultiplayerGame,
} from './multiplayer-lobby';
import { friendlyMultiplayerError } from './errors';
import { visibilityTickScheduler } from './visibility-tick-scheduler';
import type {
  MultiplayerFormatId,
  MultiplayerGameKind,
  MultiplayerSetup,
} from '@hoop-rush/data-contracts';

export type LobbyView = 'choose' | 'create' | 'join';

export function initialLobbyView(options: {
  hasLobby: boolean;
  hasCode: boolean;
  hasFormat: boolean;
  showChooser: boolean;
}): LobbyView {
  if (options.hasCode) return 'join';
  return options.hasLobby || options.hasFormat || !options.showChooser ? 'create' : 'choose';
}

export class LobbyCoordinator {
  localFormat: MultiplayerFormatId | null = null;
  readonly localSettings = new Map<MultiplayerGameKind, MultiplayerSetup>();
  /**
   * Settings of the match this client last started from the shared lobby.
   * In-memory only: it powers the result screen's "Play again" without
   * persisting mode-specific settings or changing the lobby protocol.
   */
  lastMatch: MultiplayerStartSettings | null = null;
  snapshot = $state.raw<LobbySessionSnapshot>({
    lobby: null,
    preview: null,
    busy: false,
    error: null,
    connection: 'idle',
    navigation: null,
  });
  private active: LobbySession | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly navigate: (intent: LobbyNavigation) => Promise<void>;
  private navigating = false;
  private navigationError: string | null = null;

  constructor(navigate: (intent: LobbyNavigation) => Promise<void>) {
    this.navigate = navigate;
  }

  get session(): LobbySession {
    if (!this.active) {
      const session = new LobbySession({
        command: lobbyCommand,
        subscribe: subscribeLobby,
        scheduleTick: (tick, intervalMs) => visibilityTickScheduler(tick, intervalMs, 10000),
        resumeGame: resumeMultiplayerGame,
        rememberLobby,
        friendlyError: friendlyMultiplayerError,
      });
      this.active = session;
      this.unsubscribe = session.subscribe(() => {
        this.snapshot = {
          ...session.getSnapshot(),
          error: this.navigationError ?? session.getSnapshot().error,
        };
        const navigation = this.snapshot.navigation;
        if (navigation) {
          void this.performNavigation(session, navigation);
        }
      });
    }
    return this.active;
  }

  private async performNavigation(
    session: LobbySession,
    navigation: LobbyNavigation,
  ): Promise<void> {
    if (this.navigating) return;
    this.navigating = true;
    try {
      await this.navigate(navigation);
      if (this.active !== session) return;
      this.navigationError = null;
      if (session.getSnapshot().navigation === navigation) session.acknowledgeNavigation();
    } catch (error) {
      if (this.active === session) {
        this.navigationError = friendlyMultiplayerError(error);
        this.snapshot = { ...this.snapshot, error: this.navigationError };
      }
    } finally {
      this.navigating = false;
      const pending = session.getSnapshot().navigation;
      if (this.active === session && pending && pending !== navigation)
        void this.performNavigation(session, pending);
    }
  }

  attachRoom(roomId: string): void {
    const lobbyId = loadLobbyId(roomId);
    if (lobbyId) void this.session.attach(lobbyId);
  }

  refresh(): void {
    if (this.active) void this.active.reconnect();
  }

  async prepareMatch(
    prepareSettings: () => Promise<MultiplayerStartSettings>,
    current: () => boolean,
  ): Promise<void> {
    const session = this.session;
    const lobbyId = session.getSnapshot().lobby?.id;
    if (!lobbyId || !current()) return;
    const settings = await prepareSettings();
    if (!current() || this.active !== session || session.getSnapshot().lobby?.id !== lobbyId)
      return;
    this.lastMatch = settings;
    await session.startMatch(settings);
  }

  /**
   * Start the next match in the shared lobby with the settings of the match
   * that just ended. The lobby server still requires the host and an idle
   * room, and the command keeps its authoritative revision retry, so consent
   * is unchanged — the opponent simply keeps the matchup they already agreed to.
   */
  async playAgain(current: () => boolean): Promise<void> {
    const session = this.session;
    const settings = this.lastMatch;
    const lobby = session.getSnapshot().lobby;
    if (!settings || !lobby || !current()) return;
    // The host starts the replay, exactly as they start any match from this
    // lobby; the opponent must still be in the room, so an abandoned seat never
    // gets a new match created for it.
    if (lobby.participantId !== 'p1' || !lobby.canStart || !lobby.guestJoined) return;
    await session.startMatch(settings);
  }

  async resumeRoom(
    gameKind: NonNullable<LobbySessionSnapshot['lobby']>['gameKind'],
    roomId: string,
  ): Promise<void> {
    if (!gameKind) return;
    try {
      await resumeMultiplayerGame(gameKind, roomId);
      await this.navigate({ kind: 'game', gameKind, roomId });
    } catch (error) {
      this.snapshot = { ...this.snapshot, error: friendlyMultiplayerError(error) };
    }
  }

  dispose(): void {
    this.unsubscribe?.();
    this.active?.dispose();
    this.active = null;
    this.unsubscribe = null;
  }
}

const LOBBY_CONTEXT_KEY = 'hoop-rush:lobby-coordinator';

export function getLobbyCoordinator(): LobbyCoordinator {
  return getContext<LobbyCoordinator>(LOBBY_CONTEXT_KEY);
}

export function setLobbyCoordinator(coordinator: LobbyCoordinator): LobbyCoordinator {
  return setContext(LOBBY_CONTEXT_KEY, coordinator);
}
