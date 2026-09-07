<script lang="ts">
  import { resolve } from '$app/paths';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import { formatPositions } from '$lib/player-positions';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    SPONSOR_RATING_GROUPS,
    SPONSOR_RATING_LONG_LABELS,
    SPONSOR_SLOT_ICONS,
    SPONSOR_SLOT_LABELS,
    boostedRatingRows,
    previewGearDeltas,
    type PlayerSponsorCardModel,
    type SponsorVaultEntry,
  } from '$lib/season/sponsor-gear-view';
  import type { HoopRushManifest, SeasonSponsorSlot } from '@hoop-rush/data-contracts';
  const SLOT_ORDER: SeasonSponsorSlot[] = ['shoe', 'apparel', 'fuel'];
  const TIER_CHIP: Record<string, string> = {
    BUZZ: 'bg-slate-500/15 text-slate-300 ring-slate-400/40',
    PRIME: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
    ICON: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  };
  type RatingMode = 'boosted' | 'base' | 'changes';
  let {
    card,
    face,
    manifest,
    vault = [],
    logos = new Map(),
    busy = false,
    unlocked = true,
    commandError = null,
    onApply,
    onClose,
  }: {
    card: PlayerSponsorCardModel | null;
    face: SeasonFaceRef | null;
    manifest: HoopRushManifest;
    vault?: SponsorVaultEntry[];
    logos?: ReadonlyMap<string, string>;
    busy?: boolean;
    unlocked?: boolean;
    commandError?: string | null;
    onApply: (input: {
      instanceId: string;
      playerVersionId: string;
      slot: SeasonSponsorSlot;
    }) => void;
    onClose: () => void;
  } = $props();
  const canApply = $derived(unlocked && !busy);
  let pendingApply: string | null = $state(null);
  let ratingMode: RatingMode = $state('boosted');
  let selectedSlot: SeasonSponsorSlot = $state('shoe');
  $effect(() => {
    if (card === null) {
      pendingApply = null;
    }
  });
  $effect(() => {
    void card?.playerVersionId;
    pendingApply = null;
  });
  const rows = $derived(card === null ? [] : boostedRatingRows(card.baseRatings, card.slots));
  const byKey = $derived(new Map(rows.map((row) => [row.key, row])));
  const changedCount = $derived(rows.filter((row) => row.boosted !== row.base).length);
  const eraLabel = $derived(
    card === null ? null : eraIdentityOf(manifest, card.franchiseId, card.eraId).displayLabel,
  );
  function vaultFor(slot: SeasonSponsorSlot): SponsorVaultEntry[] {
    return vault.filter((entry) => entry.slot === slot);
  }
  function wornFamilies(): Set<string> {
    const families = new Set<string>();
    if (card?.slots) {
      for (const slot of SLOT_ORDER) {
        const worn = card.slots[slot];
        if (worn !== null) families.add(worn.brandFamily);
      }
    }
    return families;
  }
  function previewFor(slot: SeasonSponsorSlot, option: SponsorVaultEntry) {
    if (card === null) return [];
    return previewGearDeltas(card.baseRatings, card.slots, { slot, boosts: option.boosts });
  }
</script>

<Dialog.Root
  open={card !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if card !== null}
        {@const families = wornFamilies()}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
                Player loadout
              </p>
              <Dialog.Title class="font-display text-xl font-extrabold uppercase tracking-tight">
                {card.displayName}
              </Dialog.Title>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {card.seasonKey}
                {#if card.playable.length > 0}
                  · {formatPositions(card.playable)}
                {/if}
              </p>
              {#if eraLabel}
                <p class="mt-0.5 text-xs text-muted-foreground">{eraLabel}</p>
              {/if}
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                {#if card.overall !== null}
                  <span
                    class="rounded-lg bg-primary px-2 py-1 font-mono text-xs font-extrabold text-primary-foreground"
                  >
                    OVR {card.overall}
                  </span>
                {/if}
                <span class="rounded-lg bg-surface-3 px-2 py-1 font-mono text-[10px] font-bold">
                  {card.role} · {card.minutes} min
                </span>
                {#if card.gearPoints > 0}
                  <span
                    class="rounded-lg bg-amber-500/15 px-2 py-1 font-mono text-[10px] font-extrabold text-amber-300 ring-1 ring-amber-400/40"
                    title="Total attribute points from applied sponsors"
                  >
                    +{card.gearPoints} gear
                  </span>
                {:else}
                  <span class="font-mono text-[10px] text-muted-foreground">No gear equipped</span>
                {/if}
                {#if card.fatigueLabel !== null}
                  <span class="font-mono text-[10px] text-muted-foreground">
                    {card.fatigueLabel}
                    {#if card.fatiguePercent !== null}
                      {card.fatiguePercent}%
                    {/if}
                  </span>
                {/if}
              </div>
            </div>
          </div>
          <Dialog.Close
            aria-label="Close player card"
            class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X class="h-5 w-5" />
          </Dialog.Close>
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="loadout-ratings-heading" class="min-w-0">
            <div class="flex items-center justify-between gap-2">
              <h3
                id="loadout-ratings-heading"
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Ratings{#if changedCount > 0}
                  · +{changedCount} boosted{/if}
              </h3>
              <div class="flex rounded-lg bg-surface-2 p-0.5" role="group" aria-label="Rating view">
                <button
                  type="button"
                  aria-pressed={ratingMode === 'boosted'}
                  data-testid="rating-mode-boosted"
                  onclick={() => {
                    ratingMode = 'boosted';
                  }}
                  class="min-h-9 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {ratingMode ===
                  'boosted'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                >
                  Current
                </button>
                <button
                  type="button"
                  aria-pressed={ratingMode === 'base'}
                  data-testid="rating-mode-base"
                  onclick={() => {
                    ratingMode = 'base';
                  }}
                  class="min-h-9 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {ratingMode ===
                  'base'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                >
                  Base
                </button>
                <button
                  type="button"
                  aria-pressed={ratingMode === 'changes'}
                  data-testid="rating-mode-changes"
                  onclick={() => {
                    ratingMode = 'changes';
                  }}
                  class="min-h-9 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {ratingMode ===
                  'changes'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                >
                  Changes
                </button>
              </div>
            </div>

            {#if ratingMode === 'changes' && changedCount === 0}
              <p class="mt-2 rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
                No gear boosts yet. Equip gear to see rating changes here.
              </p>
            {/if}
            <div class="mt-2 flex flex-col gap-3" data-testid="sponsor-ratings-grid">
              {#each SPONSOR_RATING_GROUPS as group (group.title)}
                {@const groupRows = group.keys
                  .map((key) => byKey.get(key))
                  .filter((row) => row !== undefined)
                  .filter((row) => ratingMode !== 'changes' || row.boosted !== row.base)}
                {#if groupRows.length > 0}
                  <div>
                    <h4
                      class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
                    >
                      {group.title}
                    </h4>
                    <ul class="mt-1.5 grid grid-cols-2 gap-1.5">
                      {#each groupRows as row (row.key)}
                        {@const boosted = row.boosted !== row.base}
                        <li
                          data-rating-key={row.key}
                          class="rounded-lg bg-surface-1 px-2 py-1.5 {boosted &&
                          ratingMode !== 'base'
                            ? 'ring-1 ring-amber-400/40'
                            : ''}"
                        >
                          <p
                            class="font-mono text-[9px] font-bold uppercase text-muted-foreground"
                            title={SPONSOR_RATING_LONG_LABELS[row.key]}
                          >
                            {row.label}
                          </p>
                          <p class="flex items-baseline gap-1.5 font-mono tabular-nums">
                            <span class="text-sm font-extrabold">
                              {ratingMode === 'base' ? row.base : row.boosted}
                            </span>
                            {#if ratingMode !== 'base' && boosted}
                              <span
                                class="rounded bg-amber-500/15 px-1 py-px text-[10px] font-extrabold text-amber-300"
                              >
                                +{row.boosted - row.base}
                              </span>
                            {/if}
                          </p>
                          {#if ratingMode !== 'base' && boosted}
                            <p class="font-mono text-[9px] text-muted-foreground">
                              base {row.base}
                            </p>
                            <p class="truncate font-mono text-[9px] text-amber-300/90">
                              {row.source}
                            </p>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              {/each}
            </div>
          </section>

          <section aria-labelledby="loadout-gear-heading" class="min-w-0">
            <div class="flex items-baseline justify-between gap-2">
              <h3
                id="loadout-gear-heading"
                class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Gear loadout · permanent
              </h3>
            </div>
            {#if !unlocked}
              <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                Applying unlocks between blocks — never mid-sim.
              </p>
            {/if}
            <div class="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Select gear slot">
              {#each SLOT_ORDER as slot (slot)}
                {@const worn = card.slots?.[slot] ?? null}
                {@const count = vaultFor(slot).length}
                <button
                  type="button"
                  aria-pressed={selectedSlot === slot}
                  data-testid={`select-slot-${slot}`}
                  onclick={() => {
                    selectedSlot = slot;
                    pendingApply = null;
                  }}
                  class="rounded-lg px-2 py-2 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedSlot ===
                  slot
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-surface-2 text-muted-foreground hover:text-foreground'}"
                >
                  <span aria-hidden="true">{SPONSOR_SLOT_ICONS[slot]}</span>
                  {SPONSOR_SLOT_LABELS[slot]}
                  <span class="block text-[9px] font-semibold opacity-80">
                    {worn !== null ? 'Equipped' : count > 0 ? `${count} in vault` : 'Empty'}
                  </span>
                </button>
              {/each}
            </div>

            {#if commandError !== null}
              <p
                role="alert"
                class="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
              >
                {commandError}
              </p>
            {/if}

            <div class="mt-2 flex flex-col gap-2">
              {#each SLOT_ORDER as slot (slot)}
                {@const worn = card.slots?.[slot] ?? null}
                <div
                  class="rounded-xl border p-3 {selectedSlot === slot
                    ? 'border-primary/50 bg-surface-1'
                    : 'border-border bg-surface-1/60'}"
                  data-testid={`sponsor-slot-${slot}`}
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="font-mono text-[11px] font-bold">
                      <span aria-hidden="true">{SPONSOR_SLOT_ICONS[slot]}</span>
                      {SPONSOR_SLOT_LABELS[slot]}
                    </p>
                    {#if worn !== null}
                      <span class="font-mono text-[10px] font-bold text-amber-300">
                        Equipped — permanent
                      </span>
                    {:else}
                      <span class="font-mono text-[10px] text-muted-foreground">Empty</span>
                    {/if}
                  </div>
                  {#if worn !== null}
                    <div class="mt-2 flex items-center gap-2">
                      <SponsorMark
                        family={worn.brandFamily}
                        displayName={worn.entryId}
                        logoUrl={logos.get(worn.brandFamily) ?? null}
                        size="sm"
                      />
                      <p class="min-w-0 flex-1 truncate text-xs">
                        <span class="font-bold">{worn.brandFamily}</span>
                        <span
                          class={`ml-1 rounded px-1 py-0.5 font-mono text-[10px] font-bold ring-1 ${TIER_CHIP[worn.tier] ?? ''}`}
                        >
                          {worn.tier}
                        </span>
                      </p>
                    </div>
                    <ul class="mt-2 flex flex-wrap gap-1.5">
                      {#each worn.boosts as boost (boost.key)}
                        <li
                          class="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30"
                        >
                          +{boost.points}
                          {SPONSOR_RATING_LONG_LABELS[boost.key] ?? boost.key}
                        </li>
                      {/each}
                    </ul>
                  {:else if selectedSlot === slot}
                    {@const options = vaultFor(slot)}
                    {#if options.length === 0}
                      <p class="mt-2 text-xs text-muted-foreground">
                        No {slot} gear available.
                      </p>
                      <div class="mt-2 flex flex-wrap gap-2">
                        <a
                          href={resolve('/season/run' as any)}
                          class="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
                        >
                          Open Shop
                        </a>
                      </div>
                    {:else}
                      <ul class="mt-2 flex flex-col gap-1.5">
                        {#each options as option (option.instanceId)}
                          {@const dupe = families.has(option.brandFamily)}
                          {@const deltas = previewFor(slot, option)}
                          <li class="rounded-lg bg-surface-2 p-2">
                            <div class="flex items-center gap-2">
                              <SponsorMark
                                family={option.brandFamily}
                                displayName={option.displayName}
                                logoUrl={logos.get(option.brandFamily) ?? null}
                                size="sm"
                              />
                              <div class="min-w-0 flex-1">
                                <p class="truncate text-xs font-bold">{option.displayName}</p>
                                <p class="font-mono text-[10px] font-bold text-amber-300">
                                  {option.boostLine}
                                </p>
                                <p class="font-mono text-[10px] text-muted-foreground">
                                  {#each deltas as delta, index (delta.key)}
                                    {delta.label}
                                    {delta.from} → {delta.to}{index < deltas.length - 1
                                      ? ' · '
                                      : ''}
                                  {/each}
                                </p>
                                {#if dupe}
                                  <p class="font-mono text-[10px] text-muted-foreground">
                                    Already worn by this player ({option.brandFamily})
                                  </p>
                                {/if}
                              </div>
                              {#if pendingApply === option.instanceId}
                                <div class="flex shrink-0 flex-col gap-1">
                                  <p class="max-w-36 font-mono text-[9px] text-muted-foreground">
                                    Apply {option.displayName} to {card.displayName}? This can't be
                                    undone.
                                  </p>
                                  <div class="flex gap-1">
                                    <button
                                      type="button"
                                      disabled={!canApply}
                                      onclick={() =>
                                        onApply({
                                          instanceId: option.instanceId,
                                          playerVersionId: card.playerVersionId,
                                          slot,
                                        })}
                                      data-testid={`confirm-apply-${option.instanceId}`}
                                      class="min-h-11 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onclick={() => {
                                        pendingApply = null;
                                      }}
                                      class="min-h-11 rounded-lg bg-surface-3 px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                      Back
                                    </button>
                                  </div>
                                </div>
                              {:else}
                                <button
                                  type="button"
                                  disabled={dupe || !canApply}
                                  onclick={() => {
                                    pendingApply = option.instanceId;
                                  }}
                                  data-testid={`apply-sponsor-${option.instanceId}`}
                                  class="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Equip
                                </button>
                              {/if}
                            </div>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
