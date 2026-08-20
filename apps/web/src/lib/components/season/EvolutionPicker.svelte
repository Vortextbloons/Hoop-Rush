<script lang="ts">
  import type { SeasonCampaignEvolutionOffer } from '@hoop-rush/data-contracts';

  let {
    offers,
    busy = false,
    commandError = null,
    onSelect,
  }: {
    offers: readonly SeasonCampaignEvolutionOffer[];
    busy?: boolean;
    commandError?: string | null;
    onSelect: (offerId: string) => void;
  } = $props();

  let selectedOfferId: string | null = $state(null);

  const selectedOffer = $derived(offers.find((o) => o.offerId === selectedOfferId) ?? null);

  function kindLabel(kind: string): string {
    switch (kind) {
      case 'double-down':
        return 'Double down';
      case 'adapt':
        return 'Adapt';
      case 'pivot':
        return 'Pivot';
      default:
        return kind;
    }
  }

  function kindAccent(kind: string): string {
    switch (kind) {
      case 'double-down':
        return 'border-primary bg-primary/5';
      case 'adapt':
        return 'border-sky-500/50 bg-sky-500/5';
      case 'pivot':
        return 'border-amber-500/50 bg-amber-500/5';
      default:
        return 'border-border';
    }
  }
</script>

<section
  aria-labelledby="evolution-heading"
  class="overflow-hidden rounded-2xl border border-line-strong bg-surface-1"
  data-testid="evolution-picker"
>
  <div class="bg-gradient-to-br from-surface-2 to-surface-1 px-4 py-3 sm:px-5 border-b border-border">
    <p class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Midseason — Block 4 complete</p>
    <h2 id="evolution-heading" class="font-display mt-1 text-xl font-extrabold uppercase tracking-tight">Evolve your campaign</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Choose one. <strong class="text-foreground">Double-down</strong> keeps your identity and unlocks its strongest final branch.
      <strong class="text-foreground">Adapt</strong> adds a secondary focus. <strong class="text-foreground">Pivot</strong> replaces your identity.
      Up to two adapt/pivot options appear only if the last five blocks showed evidence for them.
    </p>
  </div>

  {#if commandError !== null}
    <p role="alert" class="mx-4 mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm sm:mx-5">{commandError}</p>
  {/if}

  <div class="grid gap-3 p-4 sm:p-5" role="radiogroup" aria-labelledby="evolution-heading">
    {#each offers as offer (offer.offerId)}
      <label
        class="group relative flex cursor-pointer gap-3 rounded-xl border bg-card p-4 outline-none transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring {selectedOfferId === offer.offerId ? kindAccent(offer.kind) + ' ring-1 ring-current' : 'border-border hover:border-line-strong'}"
      >
        <input
          type="radio"
          name="evolution"
          value={offer.offerId}
          checked={selectedOfferId === offer.offerId}
          onchange={() => (selectedOfferId = offer.offerId)}
          class="mt-1 h-4 w-4 shrink-0 accent-primary"
          aria-label={`${kindLabel(offer.kind)} — ${offer.resultingIdentity}${offer.resultingFocus ? ` · ${offer.resultingFocus}` : ''}`}
        />
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-baseline gap-2">
            <span class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{kindLabel(offer.kind)}</span>
            <span class="font-display text-sm font-extrabold uppercase tracking-tight">{offer.resultingIdentity}</span>
            {#if offer.resultingFocus}
              <span class="font-mono text-[10px] text-muted-foreground">· {offer.resultingFocus}</span>
            {/if}
          </span>
          <span class="mt-1 block text-sm leading-snug text-muted-foreground">{offer.evidence}</span>
          <span class="mt-1 block font-mono text-[10px] text-muted-foreground/70">Evidence-backed · branch {offer.offerId.slice(0, 10)}…</span>
        </span>
      </label>
    {/each}
  </div>

  <div class="flex flex-col gap-2 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 bg-surface-1">
    <p class="font-mono text-[10px] text-muted-foreground max-w-[480px]">
      Evolution happens once. There are no skill points, levels, or reputation meters. Your choice enters the digest and unlocks the final branch.
    </p>
    <button
      type="button"
      onclick={() => selectedOfferId && onSelect(selectedOfferId)}
      disabled={selectedOfferId === null || busy}
      data-testid="evolution-submit"
      class="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Evolving…' : 'Lock evolution'}
    </button>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    {#if selectedOffer !== null}Selected {kindLabel(selectedOffer.kind)} — {selectedOffer.resultingIdentity}{/if}
    {#if selectedOffer === null}No evolution selected{/if}
  </p>
</section>
