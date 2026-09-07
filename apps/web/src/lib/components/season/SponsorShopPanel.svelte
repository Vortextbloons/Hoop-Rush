<script lang="ts">
  import SponsorOfferCard from '$lib/components/season/SponsorOfferCard.svelte';
  import type {
    SponsorBoardHistoryEntry,
    SponsorOfferCard as SponsorOffer,
  } from '$lib/season/sponsor-gear-view';
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
    offers: SponsorOffer[] | null;
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
        <SponsorOfferCard {offer} {balance} {cap} {busy} {logos} {onBuy} />
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
