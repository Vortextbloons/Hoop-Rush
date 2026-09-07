<script lang="ts">
  import SponsorMark from '$lib/components/season/SponsorMark.svelte';
  import { sponsorBrandColorOf, sponsorBrandSiteUrlOf } from '$lib/season/sponsor-brand-meta';
  import {
    SPONSOR_RATING_LONG_LABELS,
    SPONSOR_SLOT_ICONS,
    SPONSOR_SLOT_LABELS,
    type SponsorOfferCard as SponsorOffer,
  } from '$lib/season/sponsor-gear-view';

  const TIER_CHIP: Record<SponsorOffer['tier'], string> = {
    BUZZ: 'bg-slate-500/15 text-slate-300 ring-slate-400/40',
    PRIME: 'bg-violet-500/15 text-violet-300 ring-violet-400/40',
    ICON: 'bg-amber-500/15 text-amber-300 ring-amber-400/40',
  };

  const TIER_BORDER: Record<SponsorOffer['tier'], string> = {
    BUZZ: 'border-border',
    PRIME: 'border-violet-400/50',
    ICON: 'border-amber-400/60',
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
  let previewOpen = $state(false);
  $effect(() => {
    if (owned) previewOpen = false;
  });
</script>

<li
  class="relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 {owned
    ? 'border-primary/60 bg-primary/5'
    : TIER_BORDER[offer.tier]}"
  data-testid={`sponsor-offer-${offer.instanceId}`}
>
  <span
    aria-hidden="true"
    class="absolute inset-x-0 top-0 h-1"
    style={`background-color: ${accent};`}
  ></span>
  <div class="flex items-start gap-3 pt-1">
    <SponsorMark
      family={offer.brandFamily}
      displayName={offer.displayName}
      logoUrl={logos.get(offer.brandFamily) ?? null}
      size="lg"
      accentColor={accent}
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-2">
        <p class="min-w-0 truncate text-sm font-extrabold tracking-tight">
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
        <span
          class="shrink-0 rounded-full bg-surface-3 px-2.5 py-1 font-mono text-[11px] font-extrabold tabular-nums"
          title={`Costs ${offer.price} Influence`}
        >
          {offer.price}◆
        </span>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
          class={`rounded px-1.5 py-0.5 font-mono text-[10px] font-extrabold tracking-wide ring-1 ${TIER_CHIP[offer.tier]}`}
        >
          {offer.tier}
        </span>
        <span
          class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
        >
          <span aria-hidden="true">{SPONSOR_SLOT_ICONS[offer.slot]}</span>
          {SPONSOR_SLOT_LABELS[offer.slot]}
        </span>
      </div>
    </div>
  </div>

  <ul class="flex flex-wrap gap-1.5" aria-label="Stat boosts">
    {#each offer.boosts as boost (boost.key)}
      <li
        class="rounded-lg bg-amber-500/10 px-2 py-1 font-mono text-[11px] font-extrabold text-amber-300 ring-1 ring-amber-400/30"
      >
        {boost.label} +{boost.points}
      </li>
    {/each}
  </ul>

  {#if previewOpen}
    <dl class="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-2">
      {#each offer.boosts as boost (boost.key)}
        <div class="flex items-center justify-between gap-2 px-1.5 py-1">
          <dt class="text-[11px] text-muted-foreground">
            {SPONSOR_RATING_LONG_LABELS[boost.key]}
          </dt>
          <dd class="font-mono text-[11px] font-bold text-amber-300">+{boost.points}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <div class="mt-auto flex items-center gap-2">
    <button
      type="button"
      disabled={owned || busy || !offer.affordable}
      onclick={() => onBuy({ instanceId: offer.instanceId })}
      data-testid={`buy-sponsor-${offer.instanceId}`}
      class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {#if owned}
        Owned · In Vault
      {:else if !offer.affordable}
        Need {offer.price}◆ (have {balance}/{cap})
      {:else}
        Buy · {offer.price}◆ Influence
      {/if}
    </button>
    {#if !owned}
      <button
        type="button"
        aria-expanded={previewOpen}
        aria-label={previewOpen ? 'Hide details' : 'Preview details'}
        onclick={() => {
          previewOpen = !previewOpen;
        }}
        data-testid={`preview-sponsor-${offer.instanceId}`}
        class="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
      >
        {previewOpen ? 'Hide' : 'Preview'}
      </button>
    {/if}
  </div>
  {#if owned}
    <p class="font-mono text-[10px] text-primary">Stored in Vault — equip it from the roster.</p>
  {/if}
</li>
