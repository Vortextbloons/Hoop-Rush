<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
  import type { CompletedRunIndex, StoredRunRecord } from '@hoop-rush/persistence';

  const sandboxHref = resolve('/sandbox');
  const historyHref = resolve('/sandbox/history');

  const road = Array.from({ length: 82 }, (_, i) => i);

  const modes = [
    {
      code: '01',
      name: 'Sandbox',
      line: 'Pick a franchise and a decade, draft five peak seasons, and face all 30 teams on a fixed schedule.',
      status: 'available',
      cta: 'Start sandbox',
      href: '/sandbox' as RouteId,
    },
    {
      code: '02',
      name: 'Classic',
      line: 'Five draft rounds. Each round rolls a franchise and an era. One franchise reroll and one era reroll, then live with the board.',
      status: 'coming-soon',
      cta: 'Coming soon',
    },
    {
      code: '03',
      name: 'Ball Knowledge',
      line: 'The same draft with every rating stripped out. Names and headshots only — do you actually know the league?',
      status: 'coming-soon',
      cta: 'Coming soon',
    },
  ] as const;

  let manifest = $state<HoopRushManifest | null>(null);
  let active = $state<StoredRunRecord | null>(null);
  let recent = $state<CompletedRunIndex[]>([]);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) manifest = m;
      },
      () => {
        // The hero renders without the manifest.
      },
    );
    Promise.all([
      challengeRepository.loadActiveRun(),
      challengeRepository.listCompletedRuns(),
    ]).then(
      ([activeRecord, rows]) => {
        if (cancelled) return;
        active = activeRecord;
        recent = rows.slice(0, 3);
      },
      () => {
        // History and continue are best-effort on the start page.
      },
    );
    return () => {
      cancelled = true;
    };
  });

  function franchiseName(franchiseId: string): string {
    return (
      manifest?.franchiseLineage.find((e) => e.franchiseId === franchiseId)?.displayName ??
      franchiseId
    );
  }

  function eraName(eraId: string): string {
    return manifest?.eras.find((e) => e.eraId === eraId)?.label ?? eraId;
  }
</script>

<section class="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
  <div class="flex flex-col items-start gap-8 py-16 md:py-24">
    <div>
      <p class="font-mono text-[11px] tracking-[0.18em] text-primary uppercase">
        Pick a mode · Chase the run
      </p>
      <h1
        class="font-display mt-4 max-w-4xl text-4xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-5xl md:text-6xl lg:text-7xl"
      >
        Every dynasty has a first loss.
        <span class="text-primary">Make yours never.</span>
      </h1>
    </div>
    <p class="max-w-xl text-sm leading-relaxed text-muted-foreground">
      Build five players, face all 30 teams, and do not lose a single game.
    </p>
    <div class="w-full max-w-xl" aria-hidden="true">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          82 games
        </span>
        <span class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          30 opponents · 0 losses allowed
        </span>
      </div>
      <div class="mt-2 flex flex-wrap gap-[3px]">
        {#each road as i (i)}
          <span
            class="h-2 w-2 rounded-[2px] {i === 20
              ? 'bg-negative'
              : i % 9 === 8
                ? 'bg-accent'
                : 'bg-line-soft'}"
          ></span>
        {/each}
      </div>
    </div>
    {#if active && active.run.status === 'active'}
      <a
        href={resolve('/sandbox/challenge')}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold transition-colors hover:border-line-strong"
      >
        Continue: game {active.run.games.length + 1} of 82 · {active.run.aggregates.team.wins}-
        {active.run.aggregates.team.losses}
      </a>
    {/if}
  </div>

  <div class="grid gap-4 lg:grid-cols-3">
    {#each modes as mode (mode.code)}
      {#if mode.status === 'available'}
        <a
          href={resolve(mode.href)}
          class="group flex h-full flex-col rounded-xl border border-border bg-card p-6 outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="font-display text-sm font-extrabold text-accent">{mode.code}</span>
            <span
              class="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-primary uppercase"
            >
              Available
            </span>
          </div>
          <h2 class="font-display mt-5 text-4xl font-extrabold tracking-tight uppercase">
            {mode.name}
          </h2>
          <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{mode.line}</p>
          <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
            {mode.cta}
            <span
              aria-hidden="true"
              class="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              >&rarr;</span
            >
          </span>
        </a>
      {:else}
        <div
          class="flex h-full flex-col rounded-xl border border-dashed border-border bg-surface-1 p-6 sm:p-7"
          aria-disabled="true"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="font-display text-sm font-extrabold text-accent/50">{mode.code}</span>
            <span
              class="rounded-full border border-line-soft px-2.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Coming soon
            </span>
          </div>
          <h2
            class="font-display mt-5 text-4xl font-extrabold tracking-tight text-muted-foreground uppercase"
          >
            {mode.name}
          </h2>
          <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground/80">{mode.line}</p>
          <span
            class="mt-6 inline-flex items-center gap-2 font-mono text-xs font-semibold text-muted-foreground"
          >
            {mode.cta}
          </span>
        </div>
      {/if}
    {/each}
  </div>

  {#if recent.length > 0}
    <section aria-labelledby="recent-heading" class="mt-12">
      <div class="flex items-end justify-between gap-4">
        <h2
          id="recent-heading"
          class="font-display text-xl font-extrabold tracking-tight uppercase"
        >
          Recent challenges
        </h2>
        <a
          href={historyHref}
          class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          All history
        </a>
      </div>
      <ul class="mt-4 flex flex-col gap-3">
        {#each recent as row (row.runId)}
          <li>
            <a
              href={resolve(`/sandbox/result?runId=${encodeURIComponent(row.runId)}`)}
              class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-line-strong"
            >
              <span class="min-w-0 flex-1">
                <span
                  class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
                >
                  {franchiseName(row.franchiseId)} · {eraName(row.eraId)}
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {franchiseAbbreviation(row.franchiseId)} · completed {new Date(
                    row.completedAtIso,
                  ).toLocaleDateString()}
                </span>
                <span class="font-display text-xl font-extrabold tracking-tight">
                  {row.wins}<span class="text-muted-foreground">–</span>{row.losses}
                </span>
                <SeasonTierBadge wins={row.wins} />
              </span></a
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>
