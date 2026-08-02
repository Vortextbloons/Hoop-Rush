<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { Trophy } from '@lucide/svelte';
  import type { CompletedRunIndex, StoredRunRecord } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
  import { seasonTierFromWins } from '$lib/season-tier';

  /**
   * Compact completed-run history (spec/08). Rows list lineup, franchise/era,
   * record, outcome, and completion time; each row reopens the stored
   * summary. The active challenge, when one exists, is offered for continue.
   */

  let manifest = $state<HoopRushManifest | null>(null);
  let rows = $state<CompletedRunIndex[]>([]);
  let active = $state<StoredRunRecord | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) manifest = m;
      },
      () => {
        // History renders without the manifest (names fall back to ids).
      },
    );
    Promise.all([
      challengeRepository.listCompletedRuns(),
      challengeRepository.loadActiveRun(),
    ]).then(
      ([history, activeRecord]) => {
        if (cancelled) return;
        rows = history;
        active = activeRecord;
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
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

  function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }
</script>

<svelte:head>
  <title>Challenge history — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox</p>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Challenge history
      </h1>
    </div>
    <a
      href={resolve('/')}
      class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Back
    </a>
  </div>

  {#if error}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      {error}
    </p>
  {:else if rows.length === 0 && !active}
    <div class="mt-8 rounded-xl border border-border bg-card p-10 text-center">
      <p class="font-mono text-sm text-muted-foreground">No completed challenges yet.</p>
      <a
        href={resolve('/sandbox')}
        class="mt-4 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
      >
        Start a sandbox challenge
      </a>
    </div>
  {:else}
    {#if active && active.run.status === 'active'}
      <div class="mt-8 rounded-xl border border-line-strong bg-surface-2 p-5">
        <p class="font-display text-lg font-extrabold tracking-tight uppercase">Active challenge</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {franchiseName(active.run.franchiseId)} · {eraName(active.run.eraId)} · game {active.run
            .games.length + 1} of 82 · {active.run.aggregates.team.wins}-
          {active.run.aggregates.team.losses}
        </p>
        <a
          href={resolve('/sandbox/challenge')}
          class="mt-3 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
        >
          Continue
        </a>
      </div>
    {/if}

    <ul class="mt-8 flex flex-col gap-3">
      {#each rows as row (row.runId)}
        {@const tier = seasonTierFromWins(row.wins)}
        <li>
          <a
            href={resolve(`/sandbox/result?runId=${encodeURIComponent(row.runId)}`)}
            class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-line-strong"
          >
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg {tier.iconClass}">
              <Trophy class="h-5 w-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span
                class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
              >
                {franchiseName(row.franchiseId)} · {eraName(row.eraId)}
              </span>
              <span class="block font-mono text-[10px] text-muted-foreground">
                {row.playerIds.length} players · {franchiseAbbreviation(row.franchiseId)} · seed {row.runSeed.slice(
                  0,
                  8,
                )}
              </span>
            </span>
            <span class="font-display text-xl font-extrabold tracking-tight">
              {row.wins}<span class="text-muted-foreground">–</span>{row.losses}
            </span>
            <SeasonTierBadge wins={row.wins} />
            <span class="w-full font-mono text-[10px] text-muted-foreground sm:w-auto">
              {formatTime(row.completedAtIso)}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
