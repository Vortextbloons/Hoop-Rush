<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { PlayInGameCardViewModel } from '$lib/season/season-postseason-presentation';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';

  /**
   * One Play-In game card (M2.6 bracket): seeded matchup, score or
   * scheduled state, and the win-or-go-home consequence. The winner of the
   * 7/8 game takes seed 7; the final's winner takes seed 8; the 9/10 loser
   * is eliminated. Pure display of recorded Play-In facts.
   */

  let {
    card,
    franchiseName,
    franchiseAbbrev,
    manifest,
    humanFranchiseId,
  }: {
    card: PlayInGameCardViewModel;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    humanFranchiseId: string | null;
  } = $props();

  const identityOf = (franchiseId: string | null) =>
    manifest && franchiseId ? franchiseIdentityOf(manifest, franchiseId) : null;

  const homeWon = $derived(
    card.status !== 'scheduled' &&
      card.winnerFranchiseId !== null &&
      card.winnerFranchiseId === card.homeFranchiseId,
  );
  const awayWon = $derived(
    card.status !== 'scheduled' &&
      card.winnerFranchiseId !== null &&
      card.winnerFranchiseId === card.awayFranchiseId,
  );

  const scoreText = $derived.by(() => {
    if (card.status === 'scheduled') return 'scheduled';
    if (card.status === 'forfeit') return '2–0 · forfeit';
    return `${String(card.homeScore ?? 0)}–${String(card.awayScore ?? 0)}`;
  });
</script>

<article
  data-season-playin-card={card.gameId}
  class="rounded-xl border border-dashed border-border bg-surface-1 p-3 {card.humanGame
    ? 'ring-1 ring-primary/40'
    : ''}"
>
  <header class="flex items-baseline justify-between gap-2">
    <span class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      {card.conference === 'east' ? 'East' : 'West'} · {card.matchupLabel}
    </span>
    <span class="font-mono text-[10px] text-muted-foreground">{scoreText}</span>
  </header>

  <div class="mt-2 flex flex-col gap-1.5">
    <div
      data-playin-team={card.homeFranchiseId ?? ''}
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 {homeWon
        ? 'bg-primary/10'
        : card.started && card.homeFranchiseId !== null
          ? 'opacity-50'
          : ''}"
    >
      <span
        class="w-6 shrink-0 rounded bg-surface-3 px-1 py-0.5 text-center font-mono text-[9px] font-bold"
      >
        {card.homeSeed === null ? '—' : String(card.homeSeed)}
      </span>
      {#if manifest !== null && card.homeFranchiseId !== null && identityOf(card.homeFranchiseId) !== null}
        <SeasonTeamLogo
          {manifest}
          franchiseId={card.homeFranchiseId}
          teamExternalId={identityOf(card.homeFranchiseId)!.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">
        {card.homeFranchiseId === null ? 'TBD' : franchiseName(card.homeFranchiseId)}
        {#if card.homeFranchiseId === humanFranchiseId}<span
            class="text-primary"
            aria-label="your team">*</span
          >{/if}
      </span>
      {#if homeWon}
        <span class="shrink-0 font-mono text-[10px] font-bold text-primary">W</span>
      {:else if card.started && card.homeFranchiseId !== null}
        <span class="shrink-0 font-mono text-[10px] font-bold text-muted-foreground">L</span>
      {/if}
    </div>

    <div
      data-playin-team={card.awayFranchiseId ?? ''}
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 {awayWon
        ? 'bg-primary/10'
        : card.started && card.awayFranchiseId !== null
          ? 'opacity-50'
          : ''}"
    >
      <span
        class="w-6 shrink-0 rounded bg-surface-3 px-1 py-0.5 text-center font-mono text-[9px] font-bold"
      >
        {card.awaySeed === null ? '—' : String(card.awaySeed)}
      </span>
      {#if manifest !== null && card.awayFranchiseId !== null && identityOf(card.awayFranchiseId) !== null}
        <SeasonTeamLogo
          {manifest}
          franchiseId={card.awayFranchiseId}
          teamExternalId={identityOf(card.awayFranchiseId)!.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">
        {card.awayFranchiseId === null ? 'TBD' : franchiseName(card.awayFranchiseId)}
        {#if card.awayFranchiseId === humanFranchiseId}<span
            class="text-primary"
            aria-label="your team">*</span
          >{/if}
      </span>
      {#if awayWon}
        <span class="shrink-0 font-mono text-[10px] font-bold text-primary">W</span>
      {:else if card.started && card.awayFranchiseId !== null}
        <span class="shrink-0 font-mono text-[10px] font-bold text-muted-foreground">L</span>
      {/if}
    </div>
  </div>

  <footer class="mt-2 px-1 font-mono text-[10px] text-muted-foreground">
    {card.consequence}
    {#if card.homeFranchiseId !== null}
      <span class="ml-1">· home court {franchiseAbbrev(card.homeFranchiseId)}</span>
    {/if}
  </footer>
</article>
