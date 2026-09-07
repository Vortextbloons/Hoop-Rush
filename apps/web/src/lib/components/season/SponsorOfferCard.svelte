<script lang="ts">
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import { sponsorBrandColorOf, sponsorBrandSiteUrlOf } from '$lib/season/sponsor-brand-meta';
  import {
    SPONSOR_SLOT_LABELS,
    type SponsorOfferCard as SponsorOffer,
  } from '$lib/season/sponsor-gear-view';

  const TIER_CHIP: Record<SponsorOffer['tier'], string> = {
    BUZZ: 'bg-slate-500/15 text-slate-300 ring-slate-400/40',
    PRIME: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
    ICON: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  };

  let {
    offer,
    balance,
    cap,
    busy = false,
    logos = new Map(),
    onBuy,
  }: {
    offer: SponsorOffer;
    balance: number;
    cap: number;
    busy?: boolean;
    logos?: ReadonlyMap<string, string>;
    onBuy: (input: { instanceId: string }) => void;
  } = $props();

  const owned = $derived(offer.state === 'owned');
  const siteUrl = $derived(sponsorBrandSiteUrlOf(offer.brandFamily));
  const accent = $derived(sponsorBrandColorOf(offer.brandFamily));
</script>

<li
  class="relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 pl-5 {owned
    ? 'border-primary/60 bg-primary/5'
    : 'border-border'}"
  data-testid={`sponsor-offer-${offer.instanceId}`}
>
  <span
    aria-hidden="true"
    class="absolute inset-y-0 left-0 w-1.5"
    style={`background-color: ${accent};`}
  ></span>
  <div class="flex items-center gap-3">
    <SponsorMark
      family={offer.brandFamily}
      displayName={offer.displayName}
      logoUrl={logos.get(offer.brandFamily) ?? null}
      size="lg"
      accentColor={accent}
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-bold">
        {offer.displayName}
        {#if siteUrl !== null}
          <!-- eslint-disable svelte/no-navigation-without-resolve -- external brand site, must not use SvelteKit resolve() -->
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Visit ${offer.displayName} official site (opens in new tab)`}
            data-testid={`sponsor-brand-link-${offer.instanceId}`}
            class="ml-1 align-middle font-mono text-[10px] font-semibold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
            onclick={(event) => event.stopPropagation()}
          >
            ↗
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {/if}
      </p>
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
