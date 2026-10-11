<script lang="ts">
  import type { DraftDuelCard, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { X, Plus, Lock } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { canPlay, slotRequirement } from '@hoop-rush/engine';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES, formatPositions } from '$lib/player-positions';

  let {
    card,
    manifest,
    roster,
    legalSlots,
    onplace,
    onclose,
  }: {
    card: DraftDuelCard | null;
    manifest: HoopRushManifest | null;
    roster: (DraftDuelCard | null)[];
    legalSlots: number[];
    onplace: (slotIndex: number) => void;
    onclose: () => void;
  } = $props();

  type SlotOption = {
    index: number;
    label: string;
    incumbent: DraftDuelCard | null;
    state: 'open' | 'occupied' | 'cant-play' | 'unsafe';
    ariaLabel: string;
  };

  const options = $derived.by((): SlotOption[] => {
    const subject = card;
    if (!subject) return [];
    return SLOT_INDEXES.map((index) => {
      const label = SLOT_LABELS[index];
      const slotName = `${SLOT_NAMES[index]} slot ${index + 1}`;
      const incumbent = roster[index] ?? null;
      if (!canPlay(subject.positions, slotRequirement(index))) {
        return {
          index,
          label,
          incumbent,
          state: 'cant-play' as const,
          ariaLabel: `${subject.displayName} cannot play ${slotName}`,
        };
      }
      if (incumbent) {
        return {
          index,
          label,
          incumbent,
          state: 'occupied' as const,
          ariaLabel: `${slotName} is occupied by ${incumbent.displayName}`,
        };
      }
      if (legalSlots.includes(index)) {
        return {
          index,
          label,
          incumbent: null,
          state: 'open' as const,
          ariaLabel: `Place ${subject.displayName} at ${slotName}`,
        };
      }
      return {
        index,
        label,
        incumbent: null,
        state: 'unsafe' as const,
        ariaLabel: `Placing ${subject.displayName} at ${slotName} would risk the lineup`,
      };
    });
  });

  const initials = $derived(
    (card?.displayName ?? '')
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );

  function stateClass(state: SlotOption['state']): string {
    if (state === 'open') return 'border-primary/50 bg-primary/5 hover:bg-primary/10';
    if (state === 'occupied') return 'border-border bg-surface-1 opacity-45';
    return 'border-border bg-surface-1 opacity-45';
  }

  function stateText(state: SlotOption['state']): string {
    if (state === 'occupied') return 'Occupied';
    if (state === 'cant-play') return "Can't play";
    return "Can't complete";
  }
</script>

<Dialog.Root
  open={card !== null}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if card}
        {@const subject = card}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            {#if manifest && subject.playerExternalId}
              <PlayerFace
                player={{
                  playerId: subject.playerId,
                  playerExternalId: subject.playerExternalId,
                  altIds: null,
                }}
                {manifest}
                size="sm"
                fallbackInitials={initials}
              />
            {:else}
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
              >
                {initials}
              </span>
            {/if}
            <div class="min-w-0">
              <Dialog.Title
                class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
              >
                {subject.displayName}
              </Dialog.Title>
              <p class="font-mono text-[10px] text-muted-foreground">
                {subject.seasonKey} · {formatPositions(subject.positions)}
              </p>
            </div>
          </div>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>

        <p class="mt-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          Choose a position
        </p>

        <div class="mt-2 flex flex-col gap-2">
          {#each options as option (option.index)}
            <button
              type="button"
              aria-label={option.ariaLabel}
              disabled={option.state !== 'open'}
              onclick={() => onplace(option.index)}
              class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed {stateClass(
                option.state,
              )}"
            >
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-sm font-extrabold {option.state ===
                'open'
                  ? 'text-primary'
                  : 'text-muted-foreground'}"
              >
                {option.label}
              </span>
              <span class="min-w-0 flex-1">
                {#if option.incumbent}
                  <span class="block truncate text-sm font-bold"
                    >{option.incumbent.displayName}</span
                  >
                  <span class="block font-mono text-[10px] text-muted-foreground">
                    {option.incumbent.seasonKey} · {formatPositions(option.incumbent.positions)}
                  </span>
                {:else}
                  <span class="block truncate text-sm font-semibold">
                    {option.state === 'open'
                      ? `Open ${option.label} slot`
                      : SLOT_NAMES[option.index]}
                  </span>
                {/if}
              </span>
              <span class="flex shrink-0 items-center gap-1.5">
                {#if option.state === 'open'}
                  <Plus class="h-4 w-4 text-primary" />
                {:else if option.state === 'occupied'}
                  <Lock class="h-4 w-4" />
                  <span class="font-mono text-[10px] tracking-wide uppercase">Occupied</span>
                {:else}
                  <span class="font-mono text-[10px] tracking-wide uppercase">
                    {stateText(option.state)}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
