<script lang="ts">
  import type { HoopRushManifest, PlayersIndexEntry } from '@hoop-rush/data-contracts';
  import { ArrowRight, Check, Lock, Plus, X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '$lib/draft-presentation';
  import {
    SLOT_INDEXES,
    SLOT_LABELS,
    SLOT_NAMES,
    canFillSlot,
    displacementTargetFor,
  } from '$lib/draft-slots';
  import { formatPositions } from '$lib/player-positions';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  type IndexRow = PlayersIndexEntry;

  const BADGE_TITLES: Record<RatingBadgeLabel, string> = {
    O: 'Overall',
  };

  let {
    player,
    slots,
    manifest,
    presentation,
    allowDisplacement,
    onplace,
    onclose,
  }: {
    player: IndexRow | null;
    slots: (IndexRow | null)[];
    manifest: HoopRushManifest;
    presentation: DraftPresentation;
    allowDisplacement: boolean;
    onplace: (player: IndexRow, slotIndex: number) => void;
    onclose: () => void;
  } = $props();

  type PickerOption = {
    index: number;
    incumbent: IndexRow | null;
    state: 'open' | 'self' | 'displace' | 'swap' | 'blocked' | 'cant-play';
    moveTarget: number | null;
    ariaLabel: string;
  };

  const pickerOptions = $derived.by((): PickerOption[] => {
    const subject = player;
    if (!subject) return [];
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === subject.playerId);
    return SLOT_INDEXES.map((i) => {
      const incumbent = slots[i] ?? null;
      const slotName = `${SLOT_NAMES[i]} slot ${i + 1}`;
      if (!canFillSlot(subject, i)) {
        return {
          index: i,
          incumbent,
          state: 'cant-play',
          moveTarget: null,
          ariaLabel: `${subject.displayName} cannot play ${slotName}`,
        };
      }
      if (!incumbent) {
        return {
          index: i,
          incumbent: null,
          state: 'open',
          moveTarget: null,
          ariaLabel: `Place ${subject.displayName} at ${slotName}`,
        };
      }
      if (incumbent.playerId === subject.playerId) {
        return {
          index: i,
          incumbent,
          state: 'self',
          moveTarget: null,
          ariaLabel: `${subject.displayName} already at ${slotName}`,
        };
      }
      const target = displacementTargetFor(slots, incumbent, i, subjectSlot);
      if (allowDisplacement && target !== null) {
        return {
          index: i,
          incumbent,
          state: 'displace',
          moveTarget: target,
          ariaLabel: `Place ${subject.displayName} at ${slotName}, moving ${incumbent.displayName} to ${SLOT_NAMES[target]} slot ${target + 1}`,
        };
      }

      if (!allowDisplacement && subjectSlot !== -1 && canFillSlot(incumbent, subjectSlot)) {
        return {
          index: i,
          incumbent,
          state: 'swap',
          moveTarget: null,
          ariaLabel: `Swap ${subject.displayName} with ${incumbent.displayName} at ${slotName}`,
        };
      }
      return {
        index: i,
        incumbent,
        state: 'blocked',
        moveTarget: null,
        ariaLabel: `${slotName} occupied by ${incumbent.displayName}`,
      };
    });
  });

  function placePlayer(subject: IndexRow, slotIndex: number) {
    onplace(subject, slotIndex);
  }
</script>

<Dialog.Root
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if player}
        {@const subject = player}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <PlayerFace
              player={subject}
              {manifest}
              size="sm"
              fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
            />
            <div class="min-w-0">
              <Dialog.Title
                class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
              >
                {subject.displayName}
              </Dialog.Title>
              <p class="font-mono text-[10px] text-muted-foreground">
                {subject.seasonKey} · {formatPositions(subject.positionsPlayable)}
                {#each ratingBadges(subject, presentation) as badge (badge.label)}
                  <span
                    class="rounded bg-surface-3 px-1.5 py-0.5"
                    title={BADGE_TITLES[badge.label]}
                  >
                    · {`${badge.label} ${badge.value}`}
                  </span>
                {/each}
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

        <div class="mt-4 flex flex-col gap-2">
          {#each pickerOptions as opt (opt.index)}
            {@const label = SLOT_LABELS[opt.index]}
            <button
              type="button"
              aria-label={opt.ariaLabel}
              disabled={opt.state === 'self' ||
                opt.state === 'blocked' ||
                opt.state === 'cant-play'}
              onclick={() => placePlayer(subject, opt.index)}
              class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed {opt.state ===
              'open'
                ? 'border-primary/50 bg-primary/5 hover:bg-primary/10'
                : opt.state === 'displace' || opt.state === 'swap'
                  ? 'border-accent/60 bg-accent/10 hover:bg-accent/15'
                  : opt.state === 'self'
                    ? 'border-primary/40 bg-primary/10 opacity-70'
                    : 'border-border bg-surface-1 opacity-45'}"
            >
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-sm font-extrabold {opt.state ===
                  'displace' || opt.state === 'swap'
                  ? 'text-accent'
                  : 'text-primary'}"
              >
                {label}
              </span>
              <span class="min-w-0 flex-1">
                {#if opt.incumbent}
                  <span class="block truncate text-sm font-bold">
                    {opt.incumbent.displayName}
                  </span>
                  <span class="block font-mono text-[10px] text-muted-foreground">
                    {opt.incumbent.seasonKey} · {formatPositions(opt.incumbent.positionsPlayable)}
                  </span>
                {:else}
                  <span class="block truncate text-sm font-semibold">Open {label} slot</span>
                {/if}
              </span>
              <span class="flex shrink-0 items-center gap-1.5">
                {#if opt.state === 'self'}
                  <Check class="h-4 w-4 text-primary" />
                  <span class="font-mono text-[10px] tracking-wide uppercase">Current</span>
                {:else if opt.state === 'displace' && opt.moveTarget !== null}
                  <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
                  <span class="font-mono text-[10px] tracking-wide uppercase text-accent">
                    Moves {opt.incumbent!.displayName.split(' ').pop()} to
                    {SLOT_LABELS[opt.moveTarget]}
                  </span>
                {:else if opt.state === 'swap'}
                  <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
                  <span class="font-mono text-[10px] tracking-wide uppercase text-accent">
                    Swap
                  </span>
                {:else if opt.state === 'blocked'}
                  <Lock class="h-4 w-4 shrink-0" />
                  <span class="font-mono text-[10px] tracking-wide uppercase">Occupied</span>
                {:else if opt.state === 'cant-play'}
                  <span class="font-mono text-[10px] tracking-wide uppercase">Can't play</span>
                {:else}
                  <Plus class="h-4 w-4 shrink-0 text-primary" />
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
