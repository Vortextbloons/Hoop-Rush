import type { Component } from 'svelte';
import type { RouteId } from '$app/types';
import type { z } from 'zod';
import type {
  ModeId,
  MultiplayerFormatId,
  MultiplayerGameKind,
  MultiplayerMatchSettings,
  MultiplayerSetup,
} from '@hoop-rush/data-contracts';

export interface SettingsChoice {
  key: string;
  label: string;
  options: readonly { value: string; label: string; description?: string }[];
}
export interface SettingsProps {
  value: MultiplayerSetup;
  onchange: (value: MultiplayerSetup) => void;
  disabled?: boolean;
}
export interface MultiplayerModeAdapter {
  defaults: MultiplayerSetup;
  Settings: Component<SettingsProps>;
  loadRoom: () => Promise<Component<{ roomId: string }>>;
  loadLastRoomId: () => string | null;
  settingsSchema: z.ZodType<MultiplayerSetup>;
  loadVersions: () => Promise<MultiplayerMatchSettings['versions']>;
  startSettings: (
    format: MultiplayerFormatId,
    settings: MultiplayerSetup,
  ) => Promise<MultiplayerMatchSettings>;
  resume: (roomId: string) => Promise<void>;
  inviteLink: (code: string) => string;
  createRoomSession: (roomId: string) => { dispose(): void };
  pickTimer: (settings: MultiplayerSetup, format: MultiplayerFormatId) => string;
}
export interface MultiplayerFormatDefinition {
  id: MultiplayerFormatId;
  order: number;
  name: string;
  category: string;
  image: string | ((settings: MultiplayerSetup) => string);
  description: string;
  format: string;
  icon: Component<{ size?: number; 'aria-hidden'?: 'true' | 'false' | boolean }>;
}
export interface ModeDefinition<TId extends string = ModeId> {
  id: TId;
  label: string;
  description: string;
  discovery: {
    homeOrder?: number;
    navigationOrder?: number;
    cta?: string;
    artwork?: string;
    accent?: boolean;
  };
  solo?: { href: Exclude<RouteId, `${string}[${string}`>; warmPlayersIndex?: boolean };
  multiplayer?: {
    gameKind: MultiplayerGameKind;
    label: string;
    routeId: '/multiplayer/room/[roomId]' | '/draft-duel/room/[roomId]' | '/havoc/room/[roomId]';
    formats: readonly MultiplayerFormatDefinition[];
    load: () => Promise<MultiplayerModeAdapter>;
  };
}
