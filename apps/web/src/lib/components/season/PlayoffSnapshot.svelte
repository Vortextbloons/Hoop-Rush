<script lang="ts">
  import type { PlayoffSnapshot } from '$lib/season/season-playoff-hub-view';
  let {
    snapshot,
    humanFranchiseId,
    franchiseAbbrev,
  }: {
    snapshot: PlayoffSnapshot | null;
    humanFranchiseId: string | null;
    franchiseAbbrev: (franchiseId: string) => string;
  } = $props();
  const homeIsYou = $derived(snapshot !== null && snapshot.homeFranchiseId === humanFranchiseId);
  const awayIsYou = $derived(snapshot !== null && snapshot.awayFranchiseId === humanFranchiseId);
</script>

{#if snapshot !== null}
  <section
    aria-labelledby="series-snapshot-heading"
    class="rounded-2xl border border-border bg-surface-1 p-4 sm:p-5"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id="series-snapshot-heading"
        class="font-display text-lg font-extrabold uppercase tracking-tight"
      >
        Series snapshot
      </h2>
      <p class="font-mono text-[10px] text-muted-foreground">{snapshot.seasonSeries.label}</p>
    </div>
    <div class="mt-3 overflow-hidden rounded-xl border border-border/60">
      <div
        class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-surface-2 px-3 py-2"
      >
        <p class="truncate text-right text-sm font-extrabold uppercase">
          {franchiseAbbrev(snapshot.homeFranchiseId)}{#if homeIsYou}<span class="text-primary">
              *</span
            >{/if}
        </p>
        <p
          class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >
          Matchup
        </p>
        <p class="truncate text-sm font-extrabold uppercase">
          {franchiseAbbrev(snapshot.awayFranchiseId)}{#if awayIsYou}<span class="text-primary">
              *</span
            >{/if}
        </p>
      </div>
      <ul class="divide-y divide-border/50">
        {#each snapshot.rows as row (row.key)}
          <li
            class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2"
          >
            <p
              class={`truncate text-right font-display text-lg font-bold tabular-nums ${row.leader === 'home' ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {row.homeDisplay}
            </p>
            <p
              class="min-w-16 text-center font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {row.label}
            </p>
            <p
              class={`truncate font-display text-lg font-bold tabular-nums ${row.leader === 'away' ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {row.awayDisplay}
            </p>
          </li>
        {/each}
      </ul>
    </div>
    {#if snapshot.edges.length > 0}
      <ul class="mt-3 flex flex-col gap-2">
        {#each snapshot.edges as edge (edge.label)}
          <li class="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3 py-2.5">
            <span
              class="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-accent"
              aria-hidden="true"
            ></span>
            <span class="min-w-0">
              <span class="block text-xs font-bold">{edge.label}</span>
              <span class="block font-mono text-[10px] text-muted-foreground">{edge.detail}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="mt-3 font-mono text-[10px] text-muted-foreground">
      Regular-season facts only · last 5: {franchiseAbbrev(snapshot.homeFranchiseId)}
      {snapshot.homeForm} · {franchiseAbbrev(snapshot.awayFranchiseId)}
      {snapshot.awayForm}
    </p>
  </section>
{/if}
