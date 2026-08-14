<script lang="ts">
  import type { HoopRushManifest, SeasonPostseasonState } from '@hoop-rush/data-contracts';
  import {
    bracketColumnsOf,
    mobileBracketCardsOf,
  } from '$lib/season/season-postseason-presentation';
  import SeriesCard from './SeriesCard.svelte';
  import PlayInCard from './PlayInCard.svelte';

  /**
   * Postseason bracket (M2.6, /season/run/postseason): desktop renders the
   * tournament as round columns — Play-In, First Round, Conference Semis,
   * Conference Finals, Finals — with the east matchups first and the west
   * below; mobile renders the same series as ordered cards under round
   * headings. Play-In games render in a visually distinct dashed-card
   * format (different phase, different format). Pure display of the
   * recorded postseason state; the human team is highlighted.
   */

  let {
    postseason,
    franchiseName,
    franchiseAbbrev,
    manifest,
    humanFranchiseId,
  }: {
    postseason: SeasonPostseasonState;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    humanFranchiseId: string | null;
  } = $props();

  const columns = $derived(bracketColumnsOf(postseason, humanFranchiseId));
  const mobileCards = $derived(mobileBracketCardsOf(postseason, humanFranchiseId));
</script>

<div class="min-w-0">
  <!-- Desktop: round columns -->
  <div class="hidden gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-5">
    {#each columns as column (column.key)}
      <section aria-labelledby={`bracket-column-${column.key}`} class="min-w-0">
        <header class="px-1">
          <h3
            id={`bracket-column-${column.key}`}
            class="font-display text-sm font-extrabold uppercase tracking-tight"
          >
            {column.title}
          </h3>
          <p class="font-mono text-[10px] text-muted-foreground">{column.subtitle}</p>
        </header>
        <div class="mt-2 flex flex-col gap-3">
          {#if column.playIn !== null}
            {#each column.playIn as playIn (playIn.conference)}
              <section
                aria-label={`${playIn.conference === 'east' ? 'East' : 'West'} Play-In`}
                class="flex flex-col gap-2"
              >
                <p
                  class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {playIn.conference === 'east' ? 'East' : 'West'}
                </p>
                {#each playIn.games as game (game.gameId)}
                  <PlayInCard
                    card={game}
                    {franchiseName}
                    {franchiseAbbrev}
                    {manifest}
                    {humanFranchiseId}
                  />
                {/each}
              </section>
            {/each}
          {/if}
          {#each column.series as card (card.seriesId)}
            <SeriesCard {card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} />
          {/each}
        </div>
      </section>
    {/each}
  </div>

  <!-- Mobile: ordered series cards -->
  <ol class="flex flex-col gap-5 md:hidden">
    {#each mobileCards as entry (entry.kind === 'play-in' ? entry.column.conference : entry.card.seriesId)}
      {#if entry.kind === 'play-in'}
        <li>
          <section aria-label={`${entry.column.conference === 'east' ? 'East' : 'West'} Play-In`}>
            <h3 class="font-display text-sm font-extrabold uppercase tracking-tight">
              Play-In · {entry.column.conference === 'east' ? 'East' : 'West'}
            </h3>
            <ul class="mt-2 flex flex-col gap-2">
              {#each entry.column.games as game (game.gameId)}
                <li>
                  <PlayInCard
                    card={game}
                    {franchiseName}
                    {franchiseAbbrev}
                    {manifest}
                    {humanFranchiseId}
                  />
                </li>
              {/each}
            </ul>
          </section>
        </li>
      {:else}
        <li>
          <section aria-labelledby={`mobile-round-${entry.card.seriesId}`}>
            <h3
              id={`mobile-round-${entry.card.seriesId}`}
              class="font-display text-sm font-extrabold uppercase tracking-tight"
            >
              {entry.card.label}
            </h3>
            <div class="mt-2">
              <SeriesCard
                card={entry.card}
                {franchiseName}
                {franchiseAbbrev}
                {manifest}
                {humanFranchiseId}
              />
            </div>
          </section>
        </li>
      {/if}
    {/each}
  </ol>
</div>
