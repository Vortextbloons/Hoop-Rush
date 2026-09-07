<script lang="ts">
  import type { HoopRushManifest, SeasonPostseasonState } from '@hoop-rush/data-contracts';
  import { bracketColumnsOf, mobileBracketCardsOf } from '$lib/season/season-postseason-presentation';
  import SeriesCard from './SeriesCard.svelte';
  import PlayInCard from './PlayInCard.svelte';
  let { postseason, franchiseName, franchiseAbbrev, manifest, humanFranchiseId }: { postseason: SeasonPostseasonState; franchiseName: (franchiseId: string) => string; franchiseAbbrev: (franchiseId: string) => string; manifest: HoopRushManifest | null; humanFranchiseId: string | null } = $props();
  const columns = $derived(bracketColumnsOf(postseason, humanFranchiseId));
  const mobileCards = $derived(mobileBracketCardsOf(postseason, humanFranchiseId));
  const playIn = $derived(columns.find((column) => column.key === 'play-in')?.playIn ?? []);
  const firstRound = $derived(columns.find((column) => column.key === 'first-round')?.series ?? []);
  const semifinals = $derived(columns.find((column) => column.key === 'conference-semifinal')?.series ?? []);
  const conferenceFinals = $derived(columns.find((column) => column.key === 'conference-final')?.series ?? []);
  const finals = $derived(columns.find((column) => column.key === 'finals')?.series ?? []);
  const conferenceSeries = (cards: typeof firstRound, conference: 'east' | 'west') => cards.filter((card) => card.conference === conference);
</script>

<div class="bracket-shell min-w-0">
  <div class="play-in-dock hidden lg:block">
    <div class="dock-heading"><span>Play-In runway</span><small>Seeds 7–10 · single elimination</small></div>
    <div class="grid grid-cols-2 gap-6">
      {#each playIn as column (column.conference)}
        <section aria-label={`${column.conference === 'east' ? 'East' : 'West'} Play-In`}>
          <p class="conference-label">{column.conference === 'east' ? 'Eastern Conference' : 'Western Conference'}</p>
          <div class="mt-2 grid grid-cols-3 gap-2">
            {#each column.games as game (game.gameId)}
              <PlayInCard card={game} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </div>

  <div class="desktop-bracket hidden lg:grid" aria-label="Playoff bracket">
    {#each ['east', 'west'] as conference (conference)}
      {@const side = conference as 'east' | 'west'}
      <section class="conference-draw" data-side={side} aria-label={`${side === 'east' ? 'Eastern' : 'Western'} Conference bracket`}>
        <div class="round-column round-first"><h3>{side === 'east' ? 'East' : 'West'} · First round</h3><div class="round-stack four">
          {#each conferenceSeries(firstRound, side) as card (card.seriesId)}<SeriesCard {card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} compact />{/each}
        </div></div>
        <div class="round-column round-semis"><h3>Conference semis</h3><div class="round-stack two">
          {#each conferenceSeries(semifinals, side) as card (card.seriesId)}<SeriesCard {card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} compact />{/each}
        </div></div>
        <div class="round-column round-final"><h3>Conference final</h3><div class="round-stack one">
          {#each conferenceSeries(conferenceFinals, side) as card (card.seriesId)}<SeriesCard {card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} compact />{/each}
        </div></div>
      </section>
    {/each}
    <section class="finals-column" aria-label="League Finals">
      <span class="trophy-mark" aria-hidden="true">◆</span><h3>League Finals</h3>
      {#each finals as card (card.seriesId)}<SeriesCard {card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} compact />{/each}
      <p>Four wins to the title</p>
    </section>
  </div>

  <ol class="flex flex-col gap-5 lg:hidden">
    {#each mobileCards as entry (entry.kind === 'play-in' ? entry.column.conference : entry.card.seriesId)}
      <li>{#if entry.kind === 'play-in'}
        <section aria-label={`${entry.column.conference === 'east' ? 'East' : 'West'} Play-In`}><h3 class="mobile-round">Play-In · {entry.column.conference === 'east' ? 'East' : 'West'}</h3><ul class="mt-2 flex flex-col gap-2">
          {#each entry.column.games as game (game.gameId)}<li><PlayInCard card={game} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} /></li>{/each}
        </ul></section>
      {:else}
        <section aria-label={entry.card.label}><h3 class="mobile-round">{entry.card.conference === null ? 'League' : entry.card.conference === 'east' ? 'East' : 'West'} · {entry.card.label}</h3><div class="mt-2"><SeriesCard card={entry.card} {franchiseName} {franchiseAbbrev} {manifest} {humanFranchiseId} /></div></section>
      {/if}</li>
    {/each}
  </ol>
</div>

<style>
  .bracket-shell { --bracket-line: color-mix(in srgb,var(--color-primary) 30%,var(--color-border)); }
  .play-in-dock { margin-bottom:1rem; padding:1rem; border:1px solid var(--color-border); border-radius:1rem; background:linear-gradient(135deg,color-mix(in srgb,var(--color-primary) 8%,var(--color-surface-1)),var(--color-surface-1)); }
  .dock-heading { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:.75rem; font-family:var(--font-display); font-weight:900; text-transform:uppercase; }
  .dock-heading small,.conference-label { font-family:var(--font-mono); font-size:.625rem; color:var(--color-muted-foreground); letter-spacing:.12em; text-transform:uppercase; }
  .desktop-bracket { grid-template-columns:minmax(0,1fr) 9rem minmax(0,1fr); gap:.75rem; min-width:940px; padding:1rem; border:1px solid var(--color-border); border-radius:1rem; background:linear-gradient(90deg,color-mix(in srgb,#174ea6 5%,transparent),transparent 38% 62%,color-mix(in srgb,#b91c1c 5%,transparent)),var(--color-surface-0); }
  .conference-draw { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.65rem; min-width:0; }
  .conference-draw[data-side='east'] { grid-column:1; grid-row:1; }
  .conference-draw[data-side='west'] { grid-column:3; grid-row:1; }
  .conference-draw[data-side='west'] { direction:rtl; }
  .conference-draw[data-side='west'] > * { direction:ltr; }
  .round-column { position:relative; min-width:0; }
  .round-column h3,.finals-column h3,.mobile-round { margin:0 0 .6rem; font-family:var(--font-display); font-size:.72rem; font-weight:900; letter-spacing:.04em; text-transform:uppercase; }
  .round-stack { display:flex; height:34rem; flex-direction:column; justify-content:space-around; gap:.7rem; }
  .round-stack.four,.round-stack.two,.round-stack.one { padding-block:0; }
  .round-column:not(.round-final)::after { content:''; position:absolute; top:50%; right:-.8rem; width:.8rem; border-top:1px solid var(--bracket-line); }
  .conference-draw[data-side='west'] .round-column:not(.round-final)::after { right:auto; left:-.8rem; }
  .finals-column { grid-column:2; grid-row:1; align-self:center; position:relative; min-width:0; padding:1rem .4rem; text-align:center; border:1px solid color-mix(in srgb,var(--color-primary) 40%,var(--color-border)); border-radius:1rem; background:color-mix(in srgb,var(--color-primary) 7%,var(--color-surface-1)); }
  .finals-column :global(article) { text-align:left; }.finals-column p { margin-top:.7rem; font-family:var(--font-mono); font-size:.58rem; letter-spacing:.12em; color:var(--color-muted-foreground); text-transform:uppercase; }.trophy-mark { display:block; margin-bottom:.35rem; color:var(--color-primary); font-size:1.4rem; }
</style>
