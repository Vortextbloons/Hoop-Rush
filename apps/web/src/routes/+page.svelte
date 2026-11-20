<script lang="ts">
  import { homeModes } from '#lib/modes/catalog.js';
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { staticAsset } from '#lib/asset-url.js';
  import type {
    CapRushDraftState,
    ClassicDraftState,
    FullCourtDraftStage,
    HavocCompletionState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getManifest, warmPlayersIndex } from '#lib/data.js';
  import TierBadge from '#lib/components/TierBadge.svelte';
  import { variantLabel } from '#lib/draft-presentation.js';
  import { eraName } from '#lib/branding.js';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import { FULL_COURT_ACTIVE_RUN_KEY } from '#lib/features/full-court/full-court-active-run.js';

  type HistoryPath =
    'classic/history/' | 'sandbox/history/' | 'cap-rush/history/' | 'havoc/history/';
  const historyLinks: Partial<Record<string, HistoryPath>> = {
    classic: 'classic/history/',
    sandbox: 'sandbox/history/',
    'cap-rush': 'cap-rush/history/',
    havoc: 'havoc/history/',
  };
  const road = Array.from({ length: 82 }, (_, i) => i);
  const modes = homeModes();
  let manifest = $state<HoopRushManifest | null>(null);
  let active = $state.raw<ActiveRunCheckpoint | null>(null);
  let classicDraft = $state.raw<ClassicDraftState | null>(null);
  let recent = $state.raw<CompletedRunIndex[]>([]);
  let capRushStage = $state<CapRushDraftState['stage'] | null>(null);
  let havocStage = $state<HavocCompletionState | null>(null);
  let fullCourtStage = $state<FullCourtDraftStage | null>(null);
  type SavedEntryPath =
    | 'classic/'
    | 'classic/challenge/'
    | 'sandbox/challenge/'
    | 'cap-rush/'
    | 'cap-rush/run/'
    | 'cap-rush/result/'
    | 'havoc/'
    | 'havoc/run/'
    | 'havoc/result/'
    | 'full-court/';
  const savedEntries = $derived.by(() => {
    const entries: Partial<
      Record<string, { href: SavedEntryPath; label: string; progress?: string }>
    > = {};
    if (classicDraft?.status === 'drafting') {
      entries.classic = {
        href: 'classic/',
        label: 'Resume draft',
        progress: `Round ${classicDraft.round}/5`,
      };
    }
    if (active?.status === 'active') {
      entries[active.mode] = {
        href: active.mode === 'classic' ? 'classic/challenge/' : 'sandbox/challenge/',
        label: 'Resume season',
        progress: `Game ${(active.gamesPlayed ?? 0) + 1} · ${active.aggregates.team.wins}–${active.aggregates.team.losses}`,
      };
    }
    if (capRushStage === 'postseason' || capRushStage === 'locked') {
      entries['cap-rush'] = {
        href: 'cap-rush/run/',
        label: capRushStage === 'postseason' ? 'Resume postseason' : 'Resume season',
      };
    } else if (capRushStage === 'completed') {
      entries['cap-rush'] = { href: 'cap-rush/result/', label: 'View season report' };
    } else if (capRushStage !== null && capRushStage !== 'abandoned') {
      entries['cap-rush'] = { href: 'cap-rush/', label: 'Resume draft' };
    }
    if (havocStage === 'draft') {
      entries.havoc = { href: 'havoc/', label: 'Resume draft' };
    } else if (havocStage === 'season') {
      entries.havoc = { href: 'havoc/run/', label: 'Resume season' };
    } else if (havocStage === 'comparison' || havocStage === 'complete') {
      entries.havoc = {
        href: 'havoc/result/',
        label: havocStage === 'complete' ? 'View season report' : 'Resume season report',
      };
    }
    if (fullCourtStage !== null) {
      entries['full-court'] = {
        href: 'full-court/',
        label: fullCourtStage === 'drafting' ? 'Resume draft' : 'Open season',
      };
    }
    return entries;
  });
  const playersIndexHrefs = new Set(
    modes.filter((mode) => mode.solo?.warmPlayersIndex).map((mode) => mode.solo!.href),
  );
  function warmPlayersIndexForMode(modeHref: string): void {
    if (
      !modes.some((mode) => mode.solo?.href === modeHref && playersIndexHrefs.has(mode.solo.href))
    )
      return;
    if (
      typeof navigator !== 'undefined' &&
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
        true
    )
      return;
    warmPlayersIndex();
  }
  function deferIdle(work: () => void): void {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => work(), { timeout: 2000 });
    } else {
      setTimeout(work, 0);
    }
  }
  onMount(() => {
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) manifest = m;
      },
      () => {},
    );
    deferIdle(() => {
      if (cancelled) return;
      void import('#lib/persistence.js')
        .then(async ({ getPersistence }) => {
          const {
            challengeRepository,
            capRushRepository,
            havocRepository,
            fullCourtDraftRepository,
          } = getPersistence();
          const [checkpoint, completed, draft, capRush, havoc, fullCourt] =
            await Promise.allSettled([
              challengeRepository.loadActiveRunCheckpoint(),
              challengeRepository.listCompletedRuns(3),
              challengeRepository.loadClassicDraft(),
              capRushRepository.loadActiveDraft(),
              havocRepository.loadActiveRun(),
              Promise.resolve().then(() => {
                const runId = localStorage.getItem(FULL_COURT_ACTIVE_RUN_KEY);
                return runId === null ? null : fullCourtDraftRepository.load(runId);
              }),
            ]);
          if (cancelled) return;
          if (checkpoint.status === 'fulfilled') active = checkpoint.value;
          if (completed.status === 'fulfilled') recent = completed.value.slice(0, 3);
          if (draft.status === 'fulfilled') classicDraft = draft.value?.draft ?? null;
          if (capRush.status === 'fulfilled') capRushStage = capRush.value?.stage ?? null;
          if (havoc.status === 'fulfilled') havocStage = havoc.value?.completionState ?? null;
          if (fullCourt.status === 'fulfilled') fullCourtStage = fullCourt.value?.stage ?? null;
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  });
  function franchiseName(franchiseId: string): string {
    return (
      manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId)?.displayName ??
      franchiseId
    );
  }
</script>

<PageShell as="section" width="md" padding="none" class="px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex flex-col items-center gap-8 py-16 text-center md:py-24">
    <div>
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
      <div class="flex flex-wrap justify-center gap-[3px]">
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
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    {#each modes as mode (mode.id)}
      {#if mode.solo}
        {@const saved = savedEntries[mode.id]}
        {@const history = historyLinks[mode.id]}
        <div
          class="flex flex-col rounded-xl bg-card {mode.discovery.accent
            ? 'border border-accent/60'
            : ''}"
        >
          <a
            href={saved ? resolve(saved.href) : resolve(mode.solo.href)}
            data-sveltekit-preload-code="hover"
            onpointerenter={() => warmPlayersIndexForMode(mode.solo!.href)}
            onfocus={() => warmPlayersIndexForMode(mode.solo!.href)}
            class="group flex flex-1 flex-col rounded-xl p-6 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
          >
            {#if mode.discovery.artwork}
              <img
                src={staticAsset(`/${mode.discovery.artwork!}`)}
                alt=""
                aria-hidden="true"
                class="h-10 w-10 rounded-lg"
                width="40"
                height="40"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
              />
            {/if}
            <h2 class="font-display mt-5 text-4xl font-extrabold tracking-tight uppercase">
              {mode.label}
            </h2>
            <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              {mode.description}
            </p>
            <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
              {saved?.label ?? mode.discovery.cta}
              <span
                aria-hidden="true"
                class="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                >→</span
              >
            </span>
            {#if saved?.progress}
              <span class="mt-1 text-xs text-muted-foreground">{saved.progress}</span>
            {/if}
          </a>
          {#if history}
            <a
              href={resolve(history)}
              aria-label={`${mode.label} run history`}
              class="mx-6 mb-5 inline-flex min-h-11 self-start items-center rounded-lg text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:mx-7"
              >Run history</a
            >
          {/if}
        </div>
      {:else}
        <div class="flex h-full flex-col rounded-xl bg-surface-1 p-6 sm:p-7" aria-disabled="true">
          <h2
            class="font-display mt-5 text-4xl font-extrabold tracking-tight text-muted-foreground uppercase"
          >
            {mode.label}
          </h2>
          <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground/80">
            {mode.description}
          </p>
          <span
            class="mt-6 inline-flex items-center gap-2 font-mono text-xs font-semibold text-muted-foreground"
          >
            {mode.discovery.cta}
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
      </div>
      <ul class="mt-4 flex flex-col gap-3">
        {#each recent as row (row.runId)}
          <li>
            <a
              href={row.mode === 'classic'
                ? resolve(`classic/result/?runId=${encodeURIComponent(row.runId)}`)
                : resolve(`sandbox/result/?runId=${encodeURIComponent(row.runId)}`)}
              class="scoreboard-panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:bg-surface-2"
            >
              <span class="min-w-0 flex-1">
                <span
                  class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
                >
                  {#if row.mode === 'classic'}
                    Classic · {variantLabel(row.variant ?? 'ratings')}
                  {:else if row.franchiseId !== null}
                    {franchiseName(row.franchiseId)} · {eraName(manifest, row.eraId)}
                  {:else}
                    {eraName(manifest, row.eraId)} · 5-player lineup
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
                <TierBadge wins={row.wins} />
              </span></a
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</PageShell>
