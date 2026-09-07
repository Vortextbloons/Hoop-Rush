<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import { formatPositions } from '$lib/player-positions';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    SPONSOR_SLOT_LABELS,
    boostedRatingRows,
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
  let showBoosted = $state(true);
  $effect(() => {
    if (card === null) pendingApply = null;
  });
  const rows = $derived(card === null ? [] : boostedRatingRows(card.baseRatings, card.slots));
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
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if card !== null}
        {@const families = wornFamilies()}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <Dialog.Title class="font-display text-lg font-extrabold uppercase tracking-tight">
                {card.displayName}
              </Dialog.Title>
              <p class="mt-1 text-sm text-muted-foreground">
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
                  <span class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold">
                    OVR {card.overall}
                  </span>
                {/if}
                {#if card.gearPoints > 0}
                  <span
                    class="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/40"
                    title="Total attribute points from applied sponsors"
                  >
                    +{card.gearPoints} gear
                  </span>
                {/if}
                <span class="font-mono text-[10px] text-muted-foreground">
                  {card.role} · {card.minutes} min
                </span>
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

        <div class="mt-3 flex items-center justify-between gap-2">
          <h3
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Ratings
          </h3>
          <button
            type="button"
            onclick={() => {
              showBoosted = !showBoosted;
            }}
            aria-pressed={showBoosted}
            class="rounded-lg bg-surface-2 px-3 py-2 font-mono text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showBoosted ? 'Showing boosted' : 'Showing base'}
          </button>
        </div>
        <ul class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="sponsor-ratings-grid">
          {#each rows as row (row.key)}
            <li
              class="rounded-lg bg-surface-1 px-2 py-1.5 {row.source !== null
                ? 'ring-1 ring-amber-400/40'
                : ''}"
            >
              <p class="font-mono text-[9px] font-bold uppercase text-muted-foreground">
                {row.label}
              </p>
              <p class="font-mono text-sm font-extrabold">
                {showBoosted ? row.boosted : row.base}
                {#if showBoosted && row.source === null}
                  <span class="font-normal text-muted-foreground"></span>
                {/if}
              </p>
              {#if row.source !== null}
                <p class="font-mono text-[9px] text-amber-300/90">{row.source}</p>
              {:else}
                <p class="font-mono text-[9px] text-muted-foreground">base {row.base}</p>
              {/if}
            </li>
          {/each}
        </ul>

        {#if commandError !== null}
          <p
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
          >
            {commandError}
          </p>
        {/if}

        <h3
          class="mt-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Gear slots · permanent
        </h3>
        {#if !unlocked}
          <p class="mt-1 font-mono text-[10px] text-muted-foreground">
            Applying unlocks between blocks — never mid-sim.
          </p>
        {/if}
        <div class="mt-2 flex flex-col gap-2">
          {#each SLOT_ORDER as slot (slot)}
            {@const worn = card.slots?.[slot] ?? null}
            <div
              class="rounded-xl border border-border bg-surface-1 p-3"
              data-testid={`sponsor-slot-${slot}`}
            >
              <div class="flex items-center justify-between gap-2">
                <p class="font-mono text-[11px] font-bold">{SPONSOR_SLOT_LABELS[slot]}</p>
                {#if worn !== null}
                  <span class="font-mono text-[10px] font-bold text-muted-foreground">
                    Filled — permanent
                  </span>
                {:else}
                  <span class="font-mono text-[10px] text-muted-foreground"
                    >Empty — pick from vault</span
                  >
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
                  <p class="text-xs">
                    <span class="font-bold">{worn.brandFamily}</span>
                    <span
                      class={`ml-1 rounded px-1 py-0.5 font-mono text-[10px] font-bold ring-1 ${TIER_CHIP[worn.tier] ?? ''}`}
                    >
                      {worn.tier}
                    </span>
                  </p>
                </div>
              {:else}
                {@const options = vaultFor(slot)}
                {#if options.length === 0}
                  <p class="mt-2 text-xs text-muted-foreground">
                    No {SPONSOR_SLOT_LABELS[slot]} gear in the vault. Buy offers from the sponsor shop.
                  </p>
                {:else}
                  <ul class="mt-2 flex flex-col gap-1.5">
                    {#each options as option (option.instanceId)}
                      {@const dupe = families.has(option.brandFamily)}
                      <li class="flex items-center gap-2">
                        <SponsorMark
                          family={option.brandFamily}
                          displayName={option.displayName}
                          logoUrl={logos.get(option.brandFamily) ?? null}
                          size="sm"
                        />
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-xs font-bold">{option.displayName}</p>
                          <p class="font-mono text-[10px] text-muted-foreground">
                            {option.boostLine}
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
                              Apply {option.displayName} to {card.displayName}'s {SPONSOR_SLOT_LABELS[
                                slot
                              ]}? This can't be undone.
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
                            Apply
                          </button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
