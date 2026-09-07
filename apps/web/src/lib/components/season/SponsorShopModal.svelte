<script lang="ts">
  import { resolve } from '$app/paths';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import SponsorOfferCard from '$lib/components/season/SponsorOfferCard.svelte';
  import {
    SPONSOR_SLOT_LABELS,
    sponsorHistorySummary,
    type SponsorBoardHistoryEntry,
    type SponsorOfferCard as SponsorOffer,
    type SponsorVaultEntry,
  } from '$lib/season/sponsor-gear-view';
  import type { SeasonSponsorSlot } from '@hoop-rush/data-contracts';

  const SLOT_FILTERS: readonly { value: SeasonSponsorSlot | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'shoe', label: 'Shoe' },
    { value: 'apparel', label: 'Apparel' },
    { value: 'fuel', label: 'Fuel' },
  ];

  let {
    open,
    offers,
    balance,
    cap,
    busy = false,
    commandError = null,
    isFinalBlock = false,
    ownedCount = 0,
    history = [],
    vault = [],
    logos = new Map(),
    blockLabel = null,
    onBuy,
    onOpenChange,
  }: {
    open: boolean;
    offers: SponsorOffer[] | null;
    balance: number;
    cap: number;
    busy?: boolean;
    commandError?: string | null;
    isFinalBlock?: boolean;
    ownedCount?: number;
    history?: SponsorBoardHistoryEntry[];
    vault?: SponsorVaultEntry[];
    logos?: ReadonlyMap<string, string>;
    blockLabel?: string | null;
    onBuy: (input: { instanceId: string }) => void;
    onOpenChange: (open: boolean) => void;
  } = $props();

  let slotFilter: SeasonSponsorSlot | 'all' = $state('all');
  $effect(() => {
    if (!open) slotFilter = 'all';
  });

  const visibleOffers = $derived(
    offers === null || slotFilter === 'all'
      ? (offers ?? [])
      : ((offers ?? []).filter((offer) => offer.slot === slotFilter) ?? []),
  );
  const vaultBySlot = $derived.by(() => {
    const counts: Record<SeasonSponsorSlot, number> = { shoe: 0, apparel: 0, fuel: 0 };
    for (const entry of vault) counts[entry.slot] += 1;
    return counts;
  });
  const countsBySlot = $derived.by(() => {
    const counts: Record<SeasonSponsorSlot | 'all', number> = {
      all: 0,
      shoe: 0,
      apparel: 0,
      fuel: 0,
    };
    for (const offer of offers ?? []) {
      counts.all += 1;
      counts[offer.slot] += 1;
    }
    return counts;
  });
  const historySummary = $derived(sponsorHistorySummary(history));
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="sim-modal-overlay fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
    <Dialog.Content
      data-testid="sponsor-shop-modal"
      class="sim-modal-content fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface-1 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-5"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
            Sponsor deal board
          </p>
          <Dialog.Title
            class="font-display text-xl font-extrabold uppercase tracking-tight"
            data-testid="sponsor-shop-modal-title"
          >
            Sponsor shop
          </Dialog.Title>
          <Dialog.Description class="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
            <span class="rounded-md bg-surface-3 px-2 py-1 font-bold">
              {blockLabel ?? 'Block —'}
            </span>
            <span
              class="rounded-md bg-surface-3 px-2 py-1 font-bold"
              data-testid="sponsor-shop-balance"
            >
              Influence: {balance}/{cap}
            </span>
            {#if offers !== null}
              <span
                class="rounded-md bg-surface-3 px-2 py-1 font-bold"
                data-testid="sponsor-shop-count"
              >
                Owned Gear: {ownedCount}/{offers.length} owned
              </span>
            {/if}
          </Dialog.Description>
          <p class="mt-2 text-xs text-muted-foreground">
            Buy gear offers now. Bought gear goes to your vault — equip it to players from the
            roster.
          </p>
        </div>
        <Dialog.Close
          aria-label="Close sponsor shop"
          data-testid="close-sponsor-shop"
          class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X class="h-5 w-5" />
        </Dialog.Close>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div class="min-w-0">
          <div
            class="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Filter offers by slot"
          >
            {#each SLOT_FILTERS as filter (filter.value)}
              <button
                type="button"
                aria-pressed={slotFilter === filter.value}
                data-testid={`filter-sponsor-${filter.value}`}
                onclick={() => {
                  slotFilter = filter.value;
                }}
                class="min-h-11 rounded-lg px-3 py-2 font-mono text-[11px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {slotFilter ===
                filter.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-2 text-muted-foreground hover:text-foreground'}"
              >
                {filter.label} ({countsBySlot[filter.value]})
              </button>
            {/each}
          </div>

          {#if offers === null}
            {#if isFinalBlock}
              <p class="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
                Final block — no new offers. Vault gear can still be applied from the roster.
              </p>
            {:else}
              <p class="mt-3 rounded-xl bg-surface-2 p-4 text-xs text-muted-foreground">
                Loading offers…
              </p>
            {/if}
          {:else}
            {#if commandError !== null}
              <p
                role="alert"
                class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
              >
                {commandError}
              </p>
            {/if}
            {#if visibleOffers.length === 0}
              <p class="mt-3 rounded-xl bg-surface-2 p-4 text-xs text-muted-foreground">
                No {SPONSOR_SLOT_LABELS[slotFilter as SeasonSponsorSlot]} offers this block. Try another
                slot.
              </p>
            {:else}
              <ul class="mt-3 grid gap-3 sm:grid-cols-2" data-testid="sponsor-shop-panel">
                {#each visibleOffers as offer (offer.instanceId)}
                  <SponsorOfferCard {offer} {balance} {cap} {busy} {logos} {onBuy} />
                {/each}
              </ul>
            {/if}
            {#if historySummary !== null}
              <details class="mt-3 rounded-xl border border-border bg-surface-2">
                <summary
                  class="cursor-pointer p-3 font-mono text-[11px] font-bold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  History · {historySummary}
                </summary>
                <ul class="flex flex-col gap-1.5 border-t border-border p-3">
                  {#each history as entry (entry.blockIndex)}
                    <li class="font-mono text-[11px] text-muted-foreground">
                      Block {entry.blockIndex + 1} · {entry.bought} purchased · {entry.expired} expired
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
          {/if}
        </div>

        <aside
          aria-labelledby="sponsor-vault-heading"
          class="h-fit rounded-xl border border-border bg-surface-2 p-4 lg:sticky lg:top-0"
        >
          <div class="flex items-baseline justify-between gap-2">
            <h3
              id="sponsor-vault-heading"
              class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Vault · {vault.length} items
            </h3>
          </div>
          <p
            class="mt-1 font-mono text-[10px] text-muted-foreground"
            data-testid="sponsor-vault-counts"
          >
            SHOE {vaultBySlot.shoe} · APPAREL {vaultBySlot.apparel} · FUEL {vaultBySlot.fuel}
          </p>
          {#if vault.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              Bought gear goes to your vault. Equip it to players from the roster. Equipped gear is
              permanent.
            </p>
          {:else}
            <ul class="mt-2 flex flex-col gap-1.5">
              {#each vault.slice(0, 6) as entry (entry.instanceId)}
                <li
                  class="flex items-center gap-2"
                  data-testid={`sponsor-vault-${entry.instanceId}`}
                >
                  <SponsorMark
                    family={entry.brandFamily}
                    displayName={entry.displayName}
                    logoUrl={logos.get(entry.brandFamily) ?? null}
                    size="sm"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-bold">{entry.displayName}</p>
                    <p class="font-mono text-[10px] text-muted-foreground">
                      {SPONSOR_SLOT_LABELS[entry.slot]} · {entry.boostLine}
                    </p>
                  </div>
                  <span
                    class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                  >
                    {entry.tier}
                  </span>
                </li>
              {/each}
            </ul>
            {#if vault.length > 6}
              <p class="mt-2 font-mono text-[10px] text-muted-foreground">
                +{vault.length - 6} more in the vault
              </p>
            {/if}
            <p class="mt-2 text-xs text-muted-foreground">Equipped gear is permanent.</p>
          {/if}
          <a
            href={resolve('/season/run/team' as any)}
            class="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
          >
            Equip from roster →
          </a>
        </aside>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
