<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type {
    PlayInGameCardViewModel,
    SeriesCardViewModel,
  } from '$lib/season/season-postseason-presentation';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { franchiseColor } from '$lib/season/franchise-colors';
  let {
    series = null,
    playInCard = null,
    franchiseName,
    franchiseAbbrev,
    manifest,
    humanFranchiseId,
    gameLabel = null,
    gameDetail = null,
    seasonSeriesLabel = null,
    primaryLabel = null,
    primaryDisabled = false,
    primaryBusy = false,
    primaryHint = null,
    onPrimary = null,
  }: {
    series?: SeriesCardViewModel | null;
    playInCard?: PlayInGameCardViewModel | null;
    franchiseName: (franchiseId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
    manifest: HoopRushManifest | null;
    humanFranchiseId: string | null;
    gameLabel?: string | null;
    gameDetail?: string | null;
    seasonSeriesLabel?: string | null;
    primaryLabel?: string | null;
    primaryDisabled?: boolean;
    primaryBusy?: boolean;
    primaryHint?: string | null;
    onPrimary?: (() => void) | null;
  } = $props();
  const homeFranchiseId = $derived(series?.homeFranchiseId ?? playInCard?.homeFranchiseId ?? null);
  const awayFranchiseId = $derived(series?.awayFranchiseId ?? playInCard?.awayFranchiseId ?? null);
  const identityOf = (franchiseId: string | null) =>
    manifest && franchiseId ? franchiseIdentityOf(manifest, franchiseId) : null;
  const roundEyebrow = $derived(
    series !== null
      ? `${series.conference === 'west' ? 'West' : series.conference === 'east' ? 'East' : ''} ${series.label}`.trim()
      : playInCard !== null
        ? `Play-In · ${playInCard.matchupLabel}`
        : 'Postseason',
  );
  const homeWins = $derived(series?.homeWins ?? 0);
  const awayWins = $derived(series?.awayWins ?? 0);
  const homeSeed = $derived(series?.homeSeed ?? playInCard?.homeSeed ?? null);
  const awaySeed = $derived(series?.awaySeed ?? playInCard?.awaySeed ?? null);
  const nextGameNumber = $derived(series?.nextGame?.gameNumber ?? null);
  const nextGameHome = $derived(series?.nextGame?.homeFranchiseId ?? null);
  const locationLabel = $derived.by(() => {
    if (series === null || nextGameHome === null || humanFranchiseId === null) return gameDetail;
    if (nextGameNumber === null) return gameDetail;
    const atHome = nextGameHome === humanFranchiseId;
    const venue = atHome ? 'home' : `at ${franchiseName(nextGameHome)}`;
    return `Game ${String(nextGameNumber)} · ${venue}`;
  });
  function tapeSlots(wins: number): Array<'win' | 'open'> {
    return Array.from({ length: 4 }, (_, i) => (i < wins ? 'win' : 'open'));
  }
  const homeTape = $derived(tapeSlots(homeWins));
  const awayTape = $derived(tapeSlots(awayWins));
  const statusLine = $derived.by(() => {
    if (series !== null) {
      if (series.status === 'complete' && series.winnerFranchiseId !== null) {
        return `${franchiseName(series.winnerFranchiseId)} wins ${String(series.homeWins)}–${String(series.awayWins)}`;
      }
      if (series.lastResult !== null) {
        const r = series.lastResult;
        return `Last: G${String(r.gameNumber)} ${franchiseAbbrev(r.homeFranchiseId)} ${String(r.homeScore)}–${String(r.awayScore)} ${franchiseAbbrev(r.awayFranchiseId)}`;
      }
      return seasonSeriesLabel ?? 'First to 4 wins takes the series';
    }
    return playInCard?.consequence ?? '';
  });
  const gamedayStyle = $derived(
    `--sr-accent-a: ${franchiseColor(homeFranchiseId)}; --sr-accent-b: ${franchiseColor(awayFranchiseId)};`,
  );
</script>

<section
  aria-labelledby="current-matchup-heading"
  data-season-current-matchup
  class="sr-gameday sr-arrive relative overflow-hidden"
  style={gamedayStyle}
>
  <div class="playoff-hero-court" aria-hidden="true"></div>
  <div class="relative flex flex-col gap-5 p-5 sm:p-7">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="sr-eyebrow">
        {roundEyebrow}{nextGameNumber !== null ? ` · Game ${String(nextGameNumber)}` : ''}
      </p>
      {#if locationLabel !== null && locationLabel !== ''}
        <p class="sr-chip">
          {locationLabel}
        </p>
      {/if}
    </div>

    <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:gap-6">
      <div class="flex min-w-0 flex-col items-end gap-2 text-right">
        {#if manifest !== null && homeFranchiseId !== null && identityOf(homeFranchiseId) !== null}
          <SeasonTeamLogo
            {manifest}
            franchiseId={homeFranchiseId}
            teamExternalId={identityOf(homeFranchiseId)!.teamExternalId}
            alt=""
            size="lg"
          />
        {/if}
        <div class="min-w-0">
          <p class="sr-section-label">
            {#if homeSeed !== null}#{String(homeSeed)} seed ·
            {/if}{homeFranchiseId !== null
              ? franchiseAbbrev(homeFranchiseId)
              : ''}{#if homeFranchiseId === humanFranchiseId}
              · you{/if}
          </p>
          <h2
            class="font-display text-2xl font-black uppercase leading-[0.95] tracking-tight text-foreground sm:text-4xl"
          >
            {homeFranchiseId !== null ? franchiseName(homeFranchiseId) : 'TBD'}
          </h2>
          <div
            class="mt-2 flex justify-end gap-1.5"
            aria-label={`${homeFranchiseId !== null ? franchiseName(homeFranchiseId) : 'Home'} ${String(homeWins)} wins, ${String(4 - homeWins)} to go`}
          >
            {#each homeTape as slot, i (i)}
              <span class="playoff-pip" data-filled={slot === 'win'} data-side="home"
                ><span class="sr-only">{slot === 'win' ? 'Win' : `Win ${String(i + 1)} open`}</span
                ></span
              >
            {/each}
          </div>
          <p class="sr-scoreline mt-1 text-5xl leading-none text-foreground sm:text-6xl">
            {homeWins}
          </p>
        </div>
      </div>

      <div class="flex flex-col items-center gap-1 pt-1">
        <p id="current-matchup-heading" class="sr-section-label">Series</p>
        <p class="font-display text-center text-sm font-black uppercase leading-tight text-accent">
          First<br />to 4
        </p>
        <p class="sr-only">
          {homeFranchiseId !== null && awayFranchiseId !== null
            ? `${franchiseName(homeFranchiseId)} ${String(homeWins)}, ${franchiseName(awayFranchiseId)} ${String(awayWins)}`
            : 'Series score'}
        </p>
      </div>

      <div class="flex min-w-0 flex-col items-start gap-2">
        {#if manifest !== null && awayFranchiseId !== null && identityOf(awayFranchiseId) !== null}
          <SeasonTeamLogo
            {manifest}
            franchiseId={awayFranchiseId}
            teamExternalId={identityOf(awayFranchiseId)!.teamExternalId}
            alt=""
            size="lg"
          />
        {/if}
        <div class="min-w-0">
          <p class="sr-section-label">
            {#if awaySeed !== null}#{String(awaySeed)} seed ·
            {/if}{awayFranchiseId !== null
              ? franchiseAbbrev(awayFranchiseId)
              : ''}{#if awayFranchiseId === humanFranchiseId}
              · you{/if}
          </p>
          <h2
            class="font-display text-2xl font-black uppercase leading-[0.95] tracking-tight text-foreground sm:text-4xl"
          >
            {awayFranchiseId !== null ? franchiseName(awayFranchiseId) : 'TBD'}
          </h2>
          <div
            class="mt-2 flex gap-1.5"
            aria-label={`${awayFranchiseId !== null ? franchiseName(awayFranchiseId) : 'Away'} ${String(awayWins)} wins, ${String(4 - awayWins)} to go`}
          >
            {#each awayTape as slot, i (i)}
              <span class="playoff-pip" data-filled={slot === 'win'} data-side="away"
                ><span class="sr-only">{slot === 'win' ? 'Win' : `Win ${String(i + 1)} open`}</span
                ></span
              >
            {/each}
          </div>
          <p class="sr-scoreline mt-1 text-5xl leading-none text-foreground sm:text-6xl">
            {awayWins}
          </p>
        </div>
      </div>
    </div>

    <div
      class="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        {#if gameLabel !== null}<p class="text-sm font-bold">{gameLabel}</p>{/if}
        <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">{statusLine}</p>
        {#if seasonSeriesLabel !== null && series?.status !== 'complete'}<p
            class="mt-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {seasonSeriesLabel}
          </p>{/if}
      </div>
      {#if primaryLabel !== null && onPrimary !== null}
        <div class="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            type="button"
            data-season-postseason-submit
            onclick={onPrimary}
            disabled={primaryDisabled || primaryBusy}
            class="sr-btn"
          >
            {primaryBusy ? 'Locking in…' : primaryLabel}
            <span aria-hidden="true">→</span>
          </button>
          {#if primaryHint !== null}<p class="sr-section-label text-center sm:text-right">
              {primaryHint}
            </p>{/if}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .playoff-hero-court {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(
        60% 90% at 50% 115%,
        color-mix(in srgb, var(--sr-hardwood) 16%, transparent),
        transparent 70%
      ),
      linear-gradient(
        90deg,
        transparent 49.6%,
        color-mix(in srgb, var(--sr-hardwood) 22%, transparent) 49.6%,
        color-mix(in srgb, var(--sr-hardwood) 22%, transparent) 50.4%,
        transparent 50.4%
      );
    opacity: 0.7;
  }
  .playoff-hero-court::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 54%;
    width: min(46%, 220px);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border: 1px solid color-mix(in srgb, var(--sr-hardwood) 28%, transparent);
    border-radius: 999px;
  }
  .playoff-pip {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 999px;
    border: 1px dashed var(--sr-line-strong);
    background: color-mix(in srgb, var(--sr-raised) 70%, transparent);
    animation: playoff-pip-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .playoff-pip:nth-child(2) {
    animation-delay: 60ms;
  }
  .playoff-pip:nth-child(3) {
    animation-delay: 120ms;
  }
  .playoff-pip:nth-child(4) {
    animation-delay: 180ms;
  }
  .playoff-pip[data-filled='true'][data-side='home'] {
    border-style: solid;
    border-color: color-mix(in srgb, var(--sr-accent-a) 70%, transparent);
    background:
      radial-gradient(
        circle at 32% 30%,
        color-mix(in srgb, white 22%, transparent),
        transparent 46%
      ),
      var(--sr-accent-a);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sr-accent-a) 22%, transparent);
  }
  .playoff-pip[data-filled='true'][data-side='away'] {
    border-style: solid;
    border-color: color-mix(in srgb, var(--sr-accent-b) 70%, transparent);
    background:
      radial-gradient(
        circle at 32% 30%,
        color-mix(in srgb, white 22%, transparent),
        transparent 46%
      ),
      var(--sr-accent-b);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sr-accent-b) 20%, transparent);
  }
  @keyframes playoff-pip-in {
    from {
      opacity: 0;
      transform: scale(0.7);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .playoff-pip {
      animation: none;
    }
  }
</style>
