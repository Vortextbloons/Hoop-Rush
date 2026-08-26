<script lang="ts">import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import type { PlayInGameCardViewModel, SeriesCardViewModel, } from '$lib/season/season-postseason-presentation';
import SeasonTeamLogo from './SeasonTeamLogo.svelte';
import { franchiseIdentityOf } from '$lib/season/season-branding';
let { series = null, playInCard = null, franchiseName, franchiseAbbrev, manifest, humanFranchiseId, }: {
    series?: SeriesCardViewModel | null;
    playInCard?: PlayInGameCardViewModel | null;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    humanFranchiseId: string | null;
} = $props();
const homeFranchiseId = $derived(series?.homeFranchiseId ?? playInCard?.homeFranchiseId ?? null);
const awayFranchiseId = $derived(series?.awayFranchiseId ?? playInCard?.awayFranchiseId ?? null);
const identityOf = (franchiseId: string | null) => manifest && franchiseId ? franchiseIdentityOf(manifest, franchiseId) : null;
const roundChip = $derived(series !== null
    ? `${series.conference === 'west' ? 'W' : 'E'} · ${series.label}`
    : playInCard !== null
        ? `${playInCard.conference === 'west' ? 'W' : 'E'} · Play-In ${playInCard.matchupLabel}`
        : 'Postseason');
const scoreText = $derived(series !== null
    ? `${String(series.homeWins)}–${String(series.awayWins)}`
    : playInCard !== null && playInCard.status !== 'scheduled'
        ? playInCard.status === 'forfeit'
            ? '2–0'
            : `${String(playInCard.homeScore ?? 0)}–${String(playInCard.awayScore ?? 0)}`
        : '—');
const footerText = $derived.by(() => {
    if (series !== null) {
        if (series.status === 'complete' && series.winnerFranchiseId !== null) {
            return `${franchiseName(series.winnerFranchiseId)} wins the series ${String(series.homeWins)}–${String(series.awayWins)}`;
        }
        if (series.nextGame !== null) {
            return `Next: Game ${String(series.nextGame.gameNumber)} · at ${franchiseName(series.nextGame.homeFranchiseId)}`;
        }
        return 'Series scheduled';
    }
    return playInCard?.consequence ?? '';
});
</script>

<section
  aria-labelledby="current-matchup-heading"
  data-season-current-matchup
  class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
>
  <header class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="current-matchup-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Current matchup
    </h2>
    <span
      class="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
    >
      {roundChip}
    </span>
  </header>

  <div class="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
    <div class="flex min-w-0 items-center gap-2 justify-self-end text-right">
      {#if homeFranchiseId !== null}
        <span class="min-w-0">
          <span class="block truncate text-base font-bold">
            {franchiseName(homeFranchiseId)}
            {#if homeFranchiseId === humanFranchiseId}<span
                class="text-primary"
                aria-label="your team">*</span
              >{/if}
          </span>
          <span class="block font-mono text-[10px] text-muted-foreground">
            {series !== null
              ? series.homeSeed === null
                ? ''
                : `${String(series.homeSeed)} · `
              : ''}
            {playInCard?.homeSeed !== null && playInCard !== null && series === null
              ? `${String(playInCard.homeSeed ?? '')} · `
              : ''}
            {franchiseAbbrev(homeFranchiseId)}
            <span class="ml-1 text-foreground">home</span>
          </span>
        </span>
        {#if manifest !== null && identityOf(homeFranchiseId) !== null}
          <SeasonTeamLogo
            {manifest}
            franchiseId={homeFranchiseId}
            teamExternalId={identityOf(homeFranchiseId)!.teamExternalId}
            alt=""
            size="md"
          />
        {/if}
      {:else}
        <span class="h-9 w-9 shrink-0" aria-hidden="true"></span>
        <span class="text-sm text-muted-foreground">TBD</span>
      {/if}
    </div>

    <div class="text-center">
      <span class="font-display text-2xl font-extrabold tabular-nums">{scoreText}</span>
      <span class="block font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {series !== null ? 'series' : 'score'}
      </span>
    </div>

    <div class="flex min-w-0 items-center gap-2">
      {#if manifest !== null && awayFranchiseId !== null && identityOf(awayFranchiseId) !== null}
        <SeasonTeamLogo
          {manifest}
          franchiseId={awayFranchiseId}
          teamExternalId={identityOf(awayFranchiseId)!.teamExternalId}
          alt=""
          size="md"
        />
      {/if}
      <span class="min-w-0">
        <span class="block truncate text-base font-bold">
          {franchiseName(awayFranchiseId ?? '')}
          {#if awayFranchiseId === humanFranchiseId}<span
              class="text-primary"
              aria-label="your team">*</span
            >{/if}
        </span>
        <span class="block font-mono text-[10px] text-muted-foreground">
          {series !== null ? (series.awaySeed === null ? '' : `${String(series.awaySeed)} · `) : ''}
          {playInCard?.awaySeed !== null && playInCard !== null && series === null
            ? `${String(playInCard.awaySeed ?? '')} · `
            : ''}
          {franchiseAbbrev(awayFranchiseId ?? '')}
          <span class="ml-1 text-foreground">away</span>
        </span>
      </span>
    </div>
  </div>

  <p class="mt-3 font-mono text-[10px] text-muted-foreground">{footerText}</p>
</section>
