import type {
  HoopRushManifest,
  PeakPlayerSeason,
  PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import { lazyModule } from '#lib/lazy-module.js';
import { resolvePlayerRefs, type PlayerRef } from '#lib/player-refs.js';

export function draftSlotRefs(slots: readonly (PlayersIndexEntry | null)[]): PlayerRef[] {
  return slots
    .filter((player): player is PlayersIndexEntry => player !== null)
    .map((player) => ({
      playerId: player.playerId,
      franchiseId: player.franchiseId,
      eraId: player.eraId,
    }));
}

export function useDraftLineupRefs(
  getSlots: () => readonly (PlayersIndexEntry | null)[],
  getManifest: () => HoopRushManifest | null,
) {
  let players = $state.raw<PeakPlayerSeason[]>([]);
  $effect(() => {
    const manifest = getManifest();
    const refs = draftSlotRefs(getSlots());
    if (!manifest || refs.length === 0) {
      players = [];
      return;
    }
    let cancelled = false;
    resolvePlayerRefs(refs, manifest).then(
      (resolved) => {
        if (!cancelled) players = resolved;
      },
      () => {
        if (!cancelled) players = [];
      },
    );
    return () => {
      cancelled = true;
    };
  });
  return {
    get players() {
      return players;
    },
  };
}

export class DraftSlotPickerState {
  player = $state.raw<PlayersIndexEntry | null>(null);
  private trigger: HTMLElement | null = null;
  private fallbackId: string | null = null;
  constructor(private readonly isMounted: () => boolean) {}

  open(player: PlayersIndexEntry): void {
    this.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.fallbackId = this.trigger?.closest<HTMLElement>('[id^="court-slot-"]')?.id ?? null;
    this.player = player;
  }

  close(): void {
    if (!this.isMounted()) return;
    this.player = null;
    const trigger = this.trigger;
    const fallback = this.fallbackId;
    this.trigger = null;
    this.fallbackId = null;
    queueMicrotask(() => {
      if (!this.isMounted()) return;
      if (trigger?.isConnected) {
        trigger.focus();
      } else if (fallback) {
        document.getElementById(fallback)?.focus();
      }
    });
  }
}

export const loadSlotPickerDialog = lazyModule(
  () => import('#lib/components/draft/SlotPickerDialog.svelte'),
);
