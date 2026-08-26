<script lang="ts">import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import type { RouteId } from '$app/types';
import type { ClassicDraftState, HoopRushManifest } from '@hoop-rush/data-contracts';
import type { SeasonActiveRunIndex } from '@hoop-rush/data-contracts';
import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
import { getManifest, warmPlayersIndex } from '$lib/data';
import { challengeRepository } from '$lib/challenge-repo';
import { variantLabel } from '$lib/draft-presentation';
import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
const sandboxHref = resolve('/sandbox');
const historyHref = resolve('/sandbox/history');
const road = Array.from({ length: 82 }, (_, i) => i);
const modes = [
    {
        code: '01',
        name: 'Classic',
        line: 'Five draft rounds. Each round rolls a franchise and an era. One franchise reroll and one era reroll, then live with the board. Ratings or Ball Knowledge.',
        status: 'available',
        cta: 'Start classic',
        href: '/classic' as RouteId,
    },
    {
        code: '02',
        name: 'Sandbox',
        line: 'Draft any five peak seasons from any franchise and any era, then face all 30 teams on a fixed schedule.',
        status: 'available',
        cta: 'Start sandbox',
        href: '/sandbox' as RouteId,
    },
    {
        code: '03',
        name: 'Season Run',
        line: 'Ten-round draft, a 30-team league, and nine season checkpoints. Roll your franchise, build your ten, and run the full 82-game regular season.',
        status: 'available',
        cta: 'Start season run',
        href: '/season' as RouteId,
    },
] as const;
let manifest = $state<HoopRushManifest | null>(null);
let active = $state.raw<ActiveRunCheckpoint | null>(null);
let classicDraft = $state.raw<ClassicDraftState | null>(null);
let recent = $state.raw<CompletedRunIndex[]>([]);
let seasonRun = $state.raw<SeasonActiveRunIndex | null>(null);
function warmPlayersIndexDuringIdle(): void {
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
        idle(() => warmPlayersIndex());
    }
    else {
        setTimeout(() => warmPlayersIndex(), 0);
    }
}
$effect(() => {
    if (!browser)
        return;
    let cancelled = false;
    getManifest().then((m) => {
        if (!cancelled)
            manifest = m;
    }, () => { });
    Promise.all([
        challengeRepository.loadActiveRunCheckpoint(),
        challengeRepository.listCompletedRuns(),
        challengeRepository.loadClassicDraft(),
    ]).then(([activeCheckpoint, rows, savedDraft]) => {
        if (cancelled)
            return;
        active = activeCheckpoint;
        recent = rows.slice(0, 3);
        classicDraft = savedDraft?.draft ?? null;
    }, () => { });
    import('$lib/season/season-repo')
        .then(({ getSeasonRunRepository }) => getSeasonRunRepository())
        .then((repo) => repo.loadActiveRunIndex())
        .then((index) => {
        if (!cancelled)
            seasonRun = index;
    })
        .catch(() => { });
    warmPlayersIndexDuringIdle();
    return () => {
        cancelled = true;
    };
});
function franchiseName(franchiseId: string): string {
    return (manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId)?.displayName ??
        franchiseId);
}
function eraName(eraId: string): string {
    return manifest?.eras.find((e) => e.eraId === eraId)?.label ?? eraId;
}
</script>

<section class="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex flex-col items-center gap-8 py-16 text-center md:py-24">
    <div>
      <p class="text-label text-primary">Pick a mode · Chase the run</p>
      <h1
        class="font-display mt-4 max-w-3xl text-4xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-5xl md:text-6xl"
      >
        Every dynasty has a first loss.
        <span class="text-primary">Make yours never.</span>
      </h1>
    </div>
    <p class="max-w-lg text-sm leading-relaxed text-muted-foreground">
      Build five players, face all 30 teams, and do not lose a single game.
    </p>
    <div class="road-strip w-full max-w-lg" aria-hidden="true">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span class="text-label text-muted-foreground">82 games</span>
        <span class="text-label text-muted-foreground">30 opponents · 0 losses allowed</span>
      </div>
      <div class="mt-2 flex flex-wrap justify-center gap-[3px]">
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
    {#if active && active.status === 'active'}
      <a
        href={active.mode === 'classic'
          ? resolve('/classic/challenge')
          : resolve('/sandbox/challenge')}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold transition-colors hover:border-line-strong"
      >
        Continue: game {(active.gamesPlayed ?? 0) + 1} of 82 · {active.aggregates.team.wins}-
        {active.aggregates.team.losses}
      </a>
    {:else if classicDraft && classicDraft.status === 'drafting'}
      <a
        href={resolve('/classic')}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold transition-colors hover:border-line-strong"
      >
        Continue draft · round {classicDraft.round} of 5
      </a>
    {/if}
    {#if seasonRun}
      <a
        href={resolve('/season/run')}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-6 py-3 font-semibold transition-colors hover:border-line-strong"
      >
        Continue season · {seasonRun.humanWins}–{seasonRun.humanLosses} · through
        {seasonRun.completedRounds} rounds
      </a>
    {/if}
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    {#each modes as mode (mode.code)}
      {#if mode.status === 'available'}
        <a
          href={resolve(mode.href)}
          onpointerenter={() => warmPlayersIndex()}
          onfocus={() => warmPlayersIndex()}
          ontouchstart={() => warmPlayersIndex()}
          class="group flex h-full flex-col rounded-xl bg-card p-6 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
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
        <div class="flex h-full flex-col rounded-xl bg-surface-1 p-6 sm:p-7" aria-disabled="true">
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
    <section aria-labelledby="recent-heading" class="mt-12 text-left">
      <div class="flex items-end justify-between gap-4">
        <h2
          id="recent-heading"
          class="font-display text-xl font-extrabold tracking-tight uppercase"
        >
          Recent challenges
        </h2>
        <a
          href={historyHref}
          class="text-label text-muted-foreground underline-offset-4 hover:underline"
        >
          All history
        </a>
      </div>
      <ul class="mt-4 flex flex-col gap-3">
        {#each recent as row (row.runId)}
          <li>
            <a
              href={row.mode === 'classic'
                ? resolve(`/classic/result?runId=${encodeURIComponent(row.runId)}`)
                : resolve(`/sandbox/result?runId=${encodeURIComponent(row.runId)}`)}
              class="scoreboard-panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:bg-surface-2"
            >
              <span class="min-w-0 flex-1">
                <span
                  class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
                >
                  {#if row.mode === 'classic'}
                    Classic · {variantLabel(row.variant ?? 'ratings')}
                  {:else if row.franchiseId !== null}
                    {franchiseName(row.franchiseId)} · {eraName(row.eraId)}
                  {:else}
                    {eraName(row.eraId)} · 5-player lineup
                  {/if}
                </span>
                <span class="mt-0.5 block text-xs text-muted-foreground">
                  {#if row.franchiseId !== null}{franchiseAbbreviation(row.franchiseId)} ·
                  {/if}completed {new Date(row.completedAtIso).toLocaleDateString()}
                </span>
              </span>
              <span class="flex shrink-0 flex-col items-end gap-1">
                <span class="text-stat text-3xl font-extrabold tracking-tight">
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
