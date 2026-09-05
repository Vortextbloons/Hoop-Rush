<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { SeriesCardViewModel } from '$lib/season/season-postseason-presentation';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  let {
    card,
    franchiseName,
    franchiseAbbrev,
    manifest,
    humanFranchiseId,
  }: {
    card: SeriesCardViewModel;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    humanFranchiseId: string | null;
  } = $props();
  const home = $derived(card.homeFranchiseId);
  const away = $derived(card.awayFranchiseId);
  const homeWon = $derived(card.winnerFranchiseId !== null && card.winnerFranchiseId === home);
  const awayWon = $derived(card.winnerFranchiseId !== null && card.winnerFranchiseId === away);
  const identityOf = (franchiseId: string | null) =>
    manifest && franchiseId ? franchiseIdentityOf(manifest, franchiseId) : null;
  const seedChip = (seed: number | null, conference: string | null): string =>
    seed === null ? '—' : `${conference === 'west' ? 'W' : 'E'}${String(seed)}`;
  const statusText = $derived.by(() => {
    if (card.status === 'complete' && card.winnerFranchiseId !== null) {
      return `${franchiseName(card.winnerFranchiseId)} wins ${String(card.homeWins)}–${String(card.awayWins)}`;
    }
    if (card.nextGame !== null) {
      return `Next: Game ${String(card.nextGame.gameNumber)} · at ${franchiseName(card.nextGame.homeFranchiseId)}`;
    }
    return 'Series scheduled';
  });
  const pips = (wins: number): Array<boolean> => [0, 1, 2, 3].map((index) => index < wins);
</script>

<article
  data-season-series-card={card.seriesId}
  data-series-status={card.status}
  class="rounded-xl border border-border bg-surface-1 p-3 {card.humanSeries
    ? 'ring-1 ring-primary/40'
    : ''}"
>
  <header class="flex items-baseline justify-between gap-2">
    <span class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {card.label}
    </span>
    <span class="font-mono text-[10px] text-muted-foreground">
      {card.homeWins}–{card.awayWins}
    </span>
  </header>

  <div class="mt-2 flex flex-col gap-1.5">
    {#if home !== null}
      <div
        data-series-team={home}
        class="flex items-center gap-2 rounded-lg px-2 py-1.5 {homeWon
          ? 'bg-primary/10'
          : card.status === 'complete'
            ? 'opacity-60'
            : ''}"
      >
        <span
          class="w-6 shrink-0 rounded bg-surface-3 px-1 py-0.5 text-center font-mono text-[9px] font-bold"
        >
          {seedChip(card.homeSeed, card.conference)}
        </span>
        {#if manifest !== null && identityOf(home) !== null}
          <SeasonTeamLogo
            {manifest}
            franchiseId={home}
            teamExternalId={identityOf(home)!.teamExternalId}
            alt=""
            size="sm"
          />
        {/if}
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
          {franchiseName(home)}
          {#if home === humanFranchiseId}<span class="text-primary" aria-label="your team">*</span
            >{/if}
        </span>
        <span
          class="flex shrink-0 items-center gap-0.5"
          aria-label={`${String(card.homeWins)} wins`}
        >
          {#each pips(card.homeWins) as filled, index (index)}
            <span
              class="h-1.5 w-1.5 rounded-full {filled ? 'bg-primary' : 'bg-surface-3'}"
              aria-hidden="true"
            ></span>
          {/each}
        </span>
      </div>
    {:else}
      <p class="px-2 py-1.5 text-sm text-muted-foreground">Awaiting matchup</p>
    {/if}

    {#if away !== null}
      <div
        data-series-team={away}
        class="flex items-center gap-2 rounded-lg px-2 py-1.5 {awayWon
          ? 'bg-primary/10'
          : card.status === 'complete'
            ? 'opacity-60'
            : ''}"
      >
        <span
          class="w-6 shrink-0 rounded bg-surface-3 px-1 py-0.5 text-center font-mono text-[9px] font-bold"
        >
          {seedChip(card.awaySeed, card.conference)}
        </span>
        {#if manifest !== null && identityOf(away) !== null}
          <SeasonTeamLogo
            {manifest}
            franchiseId={away}
            teamExternalId={identityOf(away)!.teamExternalId}
            alt=""
            size="sm"
          />
        {/if}
        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
          {franchiseName(away)}
          {#if away === humanFranchiseId}<span class="text-primary" aria-label="your team">*</span
            >{/if}
        </span>
        <span
          class="flex shrink-0 items-center gap-0.5"
          aria-label={`${String(card.awayWins)} wins`}
        >
          {#each pips(card.awayWins) as filled, index (index)}
            <span
              class="h-1.5 w-1.5 rounded-full {filled ? 'bg-primary' : 'bg-surface-3'}"
              aria-hidden="true"
            ></span>
          {/each}
        </span>
      </div>
    {/if}
  </div>

  <footer class="mt-2 px-1 font-mono text-[10px] text-muted-foreground">
    {statusText}
    {#if home !== null && away !== null}
      <span class="ml-1">· home court {franchiseAbbrev(home)}</span>
    {/if}
  </footer>
</article>
