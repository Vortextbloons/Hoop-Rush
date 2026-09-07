<script lang="ts">
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import type { SponsorBoardHistoryEntry, SponsorOfferCard } from '$lib/season/sponsor-gear-view';
  import { SPONSOR_SLOT_LABELS } from '$lib/season/sponsor-gear-view';
  const TIER_CHIP: Record<SponsorOfferCard['tier'], string> = {
    BUZZ: 'bg-slate-500/15 text-slate-300 ring-slate-400/40',
    PRIME: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
    ICON: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  };
  let {
    offers,
    balance,
    cap,
    busy = false,
    commandError = null,
    isFinalBlock = false,
    ownedCount = 0,
    history = [],
    logos = new Map(),
    onBuy,
  }: {
    offers: SponsorOfferCard[] | null;
    balance: number;
    cap: number;
    busy?: boolean;
    commandError?: string | null;
    isFinalBlock?: boolean;
    ownedCount?: number;
    history?: SponsorBoardHistoryEntry[];
    logos?: ReadonlyMap<string, string>;
    onBuy: (input: { instanceId: string }) => void;
  } = $props();
</script>

<section
  aria-labelledby="sponsor-shop-heading"
  id="sponsor-shop"
  class="flex flex-col gap-3"
  data-testid="sponsor-shop-panel"
>
  <div class="flex items-baseline justify-between gap-2">
    <h2 id="sponsor-shop-heading" class="text-base font-extrabold uppercase tracking-tight">
      Sponsors
    </h2>
    {#if offers !== null}
      <p class="font-mono text-[11px] text-muted-foreground" data-testid="sponsor-shop-count">
        {ownedCount}/{offers.length} owned
      </p>
    {/if}
  </div>

  {#if offers === null}
    {#if isFinalBlock}
      <p class="rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
        Final block — no new offers. Vault gear can still be applied from the roster.
      </p>
    {:else}
      <p class="rounded-xl bg-surface-1 p-4 text-xs text-muted-foreground">Loading offers…</p>
    {/if}
  {:else}
    {#if commandError !== null}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
        {commandError}
      </p>
    {/if}
    <ul class="grid gap-3 lg:grid-cols-2">
      {#each offers as offer (offer.instanceId)}
        {@const owned = offer.state === 'owned'}
        {@const afford = offer.affordable && !owned}
        <li
          class="flex flex-col gap-2 rounded-xl border bg-card p-4 {owned
            ? 'border-primary/60 bg-primary/5'
            : 'border-border'}"
          data-testid={`sponsor-offer-${offer.instanceId}`}
        >
          <div class="flex items-center gap-3">
            <SponsorMark
              family={offer.brandFamily}
              displayName={offer.displayName}
              logoUrl={logos.get(offer.brandFamily) ?? null}
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-bold">{offer.displayName}</p>
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  class={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ring-1 ${TIER_CHIP[offer.tier]}`}
                >
                  {offer.tier}
                </span>
                <span
                  class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                >
                  {SPONSOR_SLOT_LABELS[offer.slot]}
                </span>
                <span class="font-mono text-[10px] text-muted-foreground">{offer.boostLine}</span>
              </div>
            </div>
            <span
              class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold"
              title="Influence price"
            >
              {offer.price}◆
            </span>
          </div>
          <button
            type="button"
            disabled={owned || busy || !offer.affordable}
            onclick={() => onBuy({ instanceId: offer.instanceId })}
            data-testid={`buy-sponsor-${offer.instanceId}`}
            class="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {#if owned}
              Owned
            {:else if !offer.affordable}
              Need {offer.price}◆ (have {balance}/{cap})
            {:else}
              Buy for {offer.price}◆
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if history.length > 0}
      <details class="rounded-xl border border-border bg-surface-1">
        <summary
          class="cursor-pointer p-4 text-xs font-bold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Past blocks ({history.length})
        </summary>
        <ul class="flex flex-col gap-2 border-t border-border p-4">
          {#each history as entry (entry.blockIndex)}
            <li class="font-mono text-xs text-muted-foreground">
              Block {entry.blockIndex + 1} · bought {entry.bought} · expired {entry.expired}
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}
</section>
