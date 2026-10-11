<script lang="ts">
  import type { HavocDraftCard } from '@hoop-rush/data-contracts';
  import { HAVOC_TENDENCY_FIELDS, REQUIRED_RATING_KEYS } from '@hoop-rush/data-contracts';
  import { formatPositions } from '$lib/player-positions';
  import HavocMutationList from './HavocMutationList.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import { havocFieldLabel } from './havoc-presentation';

  let {
    card,
    mode,
    busy,
    franchiseName = (franchiseId: string) => franchiseId,
    onPick,
  }: {
    card: HavocDraftCard;
    mode: 'effective' | 'original';
    busy: boolean;
    franchiseName?: (franchiseId: string) => string;
    onPick: (cardId: string) => void;
  } = $props();

  const original = $derived(card.source.profile.ratings);
  const effective = $derived(card.effective.ratings);
  const changedRatings = $derived(
    new Set(REQUIRED_RATING_KEYS.filter((key) => original[key] !== effective[key])),
  );
  const originalTendencies = $derived(card.source.profile.tendencies);
  const effectiveTendencies = $derived(card.effective.tendencies);
  const changedTendencies = $derived(
    HAVOC_TENDENCY_FIELDS.filter((key) => originalTendencies[key] !== effectiveTendencies[key]),
  );
  const physical = $derived(card.effective.physical);
  const sourceLabel = $derived(
    [card.source.seasonKey ?? 'Season unknown', franchiseName(card.source.franchiseId ?? '')]
      .filter((part) => part !== '')
      .join(' · '),
  );
</script>

<article
  data-havoc-card={card.cardId}
  data-havoc-tier={card.tier}
  class="flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-surface-1 p-4"
  style="border-top: 3px solid {card.tier === 1
    ? '#37B7CC'
    : card.tier === 2
      ? '#E8AD38'
      : '#B39AE8'}"
>
  <header class="flex min-w-0 items-start justify-between gap-2">
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Candidate {card.cardIndex + 1} · {card.slot}
      </p>
      <h3 class="font-display mt-1 text-xl leading-tight font-extrabold tracking-tight uppercase">
        {card.nickname}
      </h3>
      <p class="mt-0.5 truncate text-sm font-semibold">{card.source.displayName}</p>
      <p class="truncate text-xs text-muted-foreground">{sourceLabel}</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        {formatPositions(card.source.positions)} · Overall {card.source.originalOverall}
        {#if card.source.overallSource === 'derived'}
          <span class="font-mono text-[10px]">(derived)</span>
        {/if}
      </p>
    </div>
    <HavocTierBadge tier={card.tier} />
  </header>

  <section aria-label="Physical measurements" class="rounded-lg bg-surface-2 p-3">
    <h4 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
      Physical
    </h4>
    <dl class="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      <div class="min-w-0">
        <dt class="text-muted-foreground">Baseline height</dt>
        <dd class="font-mono">
          {physical.baselineHeightInches} in
          {#if physical.baselineHeightSource === 'estimated'}
            <span
              data-havoc-estimated
              class="ml-1 rounded bg-warn/20 px-1 py-0.5 font-mono text-[9px] font-bold tracking-wide text-warn uppercase"
              >estimated</span
            >
          {/if}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground">Effective height</dt>
        <dd class="font-mono font-bold" data-havoc-effective-height>{physical.heightInches} in</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground">Weight</dt>
        <dd class="font-mono">
          {physical.weightLbs === null ? 'Unknown' : `${physical.weightLbs} lb`}
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground">Wingspan change</dt>
        <dd class="font-mono">+{physical.wingspanDeltaInches} in</dd>
      </div>
      <div class="min-w-0">
        <dt class="text-muted-foreground">Reach units</dt>
        <dd class="font-mono">{physical.reachUnits.toFixed(2)}</dd>
      </div>
    </dl>
  </section>

  <section aria-label="Attributes" class="min-w-0">
    <div class="flex items-center justify-between gap-2">
      <h4 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        {mode === 'effective' ? 'Effective ratings' : 'Original ratings'}
      </h4>
      <span class="font-mono text-[10px] text-muted-foreground">{changedRatings.size} changed</span>
    </div>
    <dl class="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 min-[420px]:grid-cols-3">
      {#each REQUIRED_RATING_KEYS as key (key)}
        {@const changed = changedRatings.has(key)}
        <div
          class="min-w-0 rounded px-1.5 py-1 {changed ? 'bg-primary/10' : ''}"
          data-havoc-rating={key}
          data-havoc-changed={changed ? 'true' : 'false'}
        >
          <dt class="truncate font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
            {havocFieldLabel(key)}
          </dt>
          <dd class="font-mono text-xs">
            {#if changed}
              <span
                class:font-bold={mode === 'effective'}
                class:text-muted-foreground={mode === 'original'}>{original[key]}</span
              >
              <span aria-hidden="true">→</span>
              <span
                class:font-bold={mode === 'original'}
                class:text-muted-foreground={mode === 'effective'}>{effective[key]}</span
              >
            {:else}
              <span>{mode === 'effective' ? effective[key] : original[key]}</span>
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  </section>

  {#if changedTendencies.length > 0}
    <section aria-label="Tendency changes" class="min-w-0">
      <h4 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Tendency changes
      </h4>
      <ul class="mt-1.5 flex flex-col gap-0.5 text-xs">
        {#each changedTendencies as key (key)}
          <li class="flex items-center justify-between gap-2">
            <span class="truncate text-muted-foreground">{havocFieldLabel(key)}</span>
            <span class="font-mono">
              {originalTendencies[key]} → <span class="font-bold">{effectiveTendencies[key]}</span>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-label="Mutations" class="min-w-0 flex-1">
    <h4 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
      Package
    </h4>
    <div class="mt-1.5">
      <HavocMutationList mutations={card.mutations} />
    </div>
  </section>

  <button
    type="button"
    onclick={() => onPick(card.cardId)}
    disabled={busy}
    aria-label="Draft {card.source.displayName} — {card.nickname}"
    class="inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-lg bg-primary px-3 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
  >
    Pick {card.nickname}
  </button>
</article>
