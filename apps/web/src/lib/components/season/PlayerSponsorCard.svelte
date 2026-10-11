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
    boostedOverallDeltaOf,
    boostedRatingRows,
    previewBoostedOverallOf,
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
  const ovrDelta = $derived(
    card === null
      ? null
      : boostedOverallDeltaOf(card.overall, card.baseRatings, card.tendencies, card.slots),
  );
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
    <Dialog.Overlay class="sr-dialog-overlay" />
    <Dialog.Content
      class="sr-dialog max-h-[86dvh] w-[min(48rem,calc(100vw-1.5rem))] overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none sm:p-6 sm:pb-6"
    >
      {#if card !== null}
        {@const families = wornFamilies()}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <p class="sr-eyebrow">Player loadout</p>
              <Dialog.Title class="sr-page-title mt-1 text-2xl!">
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
                  {#if ovrDelta === null}
                    <span class="sr-chip">
                      OVR {card.overall}
                    </span>
                  {:else}
                    <span
                      class="sr-chip"
                      data-testid="sponsor-ovr-delta"
                      title="Overall with gear applied"
                    >
                      OVR {card.overall} → {card.overall + ovrDelta}
                    </span>
                  {/if}
                {/if}
                <span class="sr-chip">
                  {card.role} · {card.minutes} min
                </span>
                {#if card.gearPoints > 0}
                  <span
                    class="sr-badge"
                    data-tone="warn"
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
            class="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X class="h-5 w-5" />
          </Dialog.Close>
        </div>

        <div class="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="loadout-ratings-heading" class="min-w-0">
            <div class="flex items-center justify-between gap-2">
              <h3 id="loadout-ratings-heading" class="sr-section-label">
                Ratings{#if changedCount > 0}
                  · +{changedCount} boosted{/if}
              </h3>
              <div
                class="flex rounded-lg border border-border/60 bg-surface-2/60 p-0.5"
                role="group"
                aria-label="Rating view"
              >
                <button
                  type="button"
                  aria-pressed={ratingMode === 'boosted'}
                  data-testid="rating-mode-boosted"
                  onclick={() => {
                    ratingMode = 'boosted';
                  }}
                  class="min-h-11 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 {ratingMode ===
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
                  class="min-h-11 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 {ratingMode ===
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
                  class="min-h-11 rounded-md px-2.5 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 {ratingMode ===
                  'changes'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'}"
                >
                  Changes
                </button>
              </div>
            </div>

            {#if ratingMode === 'changes' && changedCount === 0}
              <p
                class="mt-2 rounded-lg border border-border/50 bg-surface-2/60 p-3 text-xs text-muted-foreground"
              >
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
                    <h4 class="sr-section-label">
                      {group.title}
                    </h4>
                    <ul class="mt-1.5 grid grid-cols-2 gap-1.5">
                      {#each groupRows as row (row.key)}
                        {@const boosted = row.boosted !== row.base}
                        <li
                          data-rating-key={row.key}
                          class="rounded-lg border border-border/50 bg-surface-2/60 px-2 py-1.5 {boosted &&
                          ratingMode !== 'base'
                            ? 'ring-1 ring-primary/40'
                            : ''}"
                        >
                          <p
                            class="font-mono text-[9px] font-bold uppercase text-muted-foreground"
                            title={SPONSOR_RATING_LONG_LABELS[row.key]}
                          >
                            {row.label}
                          </p>
                          <p class="sr-number flex items-baseline gap-1.5">
                            <span class="text-sm font-extrabold" style="color: var(--sr-paper)">
                              {ratingMode === 'base' ? row.base : row.boosted}
                            </span>
                            {#if ratingMode !== 'base' && boosted}
                              <span
                                class="rounded bg-primary/15 px-1 py-px font-mono text-[10px] font-extrabold text-primary"
                              >
                                +{row.boosted - row.base}
                              </span>
                            {/if}
                          </p>
                          {#if ratingMode !== 'base' && boosted}
                            <p class="font-mono text-[9px] text-muted-foreground">
                              base {row.base}
                            </p>
                            <p class="truncate font-mono text-[9px] text-primary/90">
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
              <h3 id="loadout-gear-heading" class="sr-section-label">Gear loadout · permanent</h3>
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
                  class="min-h-11 rounded-lg border px-2 py-2 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {selectedSlot ===
                  slot
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-border/60 bg-surface-2 text-muted-foreground hover:text-foreground'}"
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
                    ? 'border-primary/60 bg-surface-2/60'
                    : 'border-border/60 bg-surface-1/40'}"
                  data-testid={`sponsor-slot-${slot}`}
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="sr-section-label">
                      <span aria-hidden="true">{SPONSOR_SLOT_ICONS[slot]}</span>
                      {SPONSOR_SLOT_LABELS[slot]}
                    </p>
                    {#if worn !== null}
                      <span class="font-mono text-[10px] font-bold text-primary">
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
                          class="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary ring-1 ring-primary/30"
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
                          class="sr-btn-ghost px-3! text-xs! outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Open Shop
                        </a>
                      </div>
                    {:else}
                      <ul class="mt-2 flex flex-col gap-1.5">
                        {#each options as option (option.instanceId)}
                          {@const dupe = families.has(option.brandFamily)}
                          {@const deltas = previewFor(slot, option)}
                          {@const ovrPreview =
                            card.overall === null
                              ? null
                              : previewBoostedOverallOf(
                                  card.overall,
                                  card.baseRatings,
                                  card.tendencies,
                                  card.slots,
                                  { slot, boosts: option.boosts },
                                )}
                          <li class="rounded-lg border border-border/50 bg-surface-2/60 p-2">
                            <div class="flex items-center gap-2">
                              <SponsorMark
                                family={option.brandFamily}
                                displayName={option.displayName}
                                logoUrl={logos.get(option.brandFamily) ?? null}
                                size="sm"
                              />
                              <div class="min-w-0 flex-1">
                                <p class="truncate text-xs font-bold">{option.displayName}</p>
                                <p class="font-mono text-[10px] font-bold text-primary">
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
                                {#if ovrPreview !== null && card.overall !== null && ovrPreview !== card.overall}
                                  <p class="font-mono text-[10px] font-bold text-primary">
                                    OVR {card.overall} → {ovrPreview}
                                  </p>
                                {/if}
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
                                      class="sr-btn min-h-11 px-3! text-xs! outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onclick={() => {
                                        pendingApply = null;
                                      }}
                                      class="sr-btn-ghost min-h-11 px-3! text-xs! outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                                  class="sr-btn min-h-11 shrink-0 px-3! text-xs! outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
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
