<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { SvelteMap } from 'svelte/reactivity';
  import type {
    HoopRushManifest,
    SeasonDraftCatalog,
    SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import { humanFranchiseIdOf } from '@hoop-rush/data-contracts';
  import CheckpointRecap from '$lib/components/season/CheckpointRecap.svelte';
  import {
    loadSeasonDraftCatalog,
    loadSeasonLeague,
    loadSeasonSchedule,
  } from '$lib/season/season-assets';
  import { getManifest } from '$lib/data';
  import { SeasonHubState } from '$lib/season/season-hub-state';
  import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
  import { getSeasonBlockRunner, getSeasonRunRepository } from '$lib/season/season-repo';
  import { boxScoreFromSummary, deriveBlockRecap, ordinal } from '$lib/season/season-presentation';
  let manifest = $state<HoopRushManifest | null>(null);
  let catalog = $state<SeasonDraftCatalog | null>(null);
  let loadError: string | null = $state(null);
  let hub = $state.raw<SeasonHubState | null>(null);
  let blockSummaries = $state<SeasonGameSummary[]>([]);
  let retainedGameIds = $state<string[]>([]);
  let snapshot = $state<SeasonRunSnapshot | null>(null);
  let openedBoxScores = $state.raw(new Set<string>());
  function onBoxScoreToggle(event: Event, gameId: string) {
    if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
    if (!event.currentTarget.open || openedBoxScores.has(gameId)) return;
    openedBoxScores = new Set([...openedBoxScores, gameId]);
  }
  let boxScoreModule: Promise<typeof import('$lib/components/season/BoxScore.svelte')> | null =
    null;
  function loadBoxScore(): Promise<typeof import('$lib/components/season/BoxScore.svelte')> {
    boxScoreModule ??= import('$lib/components/season/BoxScore.svelte');
    return boxScoreModule;
  }
  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    Promise.all([
      getManifest(),
      loadSeasonLeague(),
      loadSeasonDraftCatalog(),
      loadSeasonSchedule(),
    ]).then(
      async ([m, , cat, seasonSchedule]) => {
        if (cancelled) return;
        manifest = m;
        catalog = cat;
        try {
          const [repo, runner] = await Promise.all([
            getSeasonRunRepository(seasonSchedule),
            getSeasonBlockRunner(),
          ]);
          if (cancelled) return;
          hub = new SeasonHubState(repo, runner);
          hub.subscribe(() => {
            snapshot = hub!.snapshot;
          });
          await hub.refresh();
          const s = hub.snapshot;
          const last = s?.acceptedBlocks[s.acceptedBlocks.length - 1];
          if (s && last) {
            const [summaries, details] = await Promise.all([
              hub.loadBlockSummaries(s.run.runId, last.blockIndex),
              hub.loadRetainedDetails(s.run.runId),
            ]);
            blockSummaries = summaries;
            retainedGameIds = details
              .filter(
                (detail) =>
                  detail.round > last.blockIndex * 10 &&
                  detail.round <= (last.blockIndex === 8 ? 82 : (last.blockIndex + 1) * 10),
              )
              .map((detail) => detail.gameId);
          }
        } catch (error) {
          if (!cancelled) loadError = error instanceof Error ? error.message : String(error);
        }
      },
      (error: unknown) => {
        if (!cancelled) loadError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
      hub?.destroy();
      hub = null;
    };
  });
  const run = $derived(snapshot?.run ?? null);
  const humanFranchiseId = $derived(run ? humanFranchiseIdOf(run.league) : null);
  const lastBlock = $derived(
    snapshot && snapshot.acceptedBlocks.length > 0
      ? snapshot.acceptedBlocks[snapshot.acceptedBlocks.length - 1]!
      : null,
  );
  const humanGames = $derived(
    blockSummaries.filter(
      (summary) =>
        summary.homeFranchiseId === humanFranchiseId ||
        summary.awayFranchiseId === humanFranchiseId,
    ),
  );
  const playerNames = $derived.by(() => {
    const map = new SvelteMap<string, string>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });
  const playerPlayable = $derived.by(() => {
    const map = new SvelteMap<string, string[]>();
    for (const candidate of catalog?.candidates ?? []) {
      map.set(candidate.playerVersionId, candidate.positions.playable);
    }
    return map;
  });
  const playerName = (playerVersionId: string): string =>
    playerNames.get(playerVersionId) ?? playerVersionId;
  const franchiseName = (franchiseId: string): string =>
    manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)?.displayName ??
    franchiseId;
  const recap = $derived.by(() => {
    if (!run || !humanFranchiseId || !lastBlock || !snapshot) return null;
    return deriveBlockRecap({
      runId: run.runId,
      blockIndex: lastBlock.blockIndex,
      completedRounds: lastBlock.completedRounds,
      standings: run.standings,
      league: run.league,
      blockSummaries,
      allSummaries: snapshot.summaries,
      rosters: run.rosters.flatMap((roster) => roster.players),
      games: run.games,
      humanFranchiseId,
      run,
    });
  });
  function boxFor(summary: SeasonGameSummary) {
    if (!humanFranchiseId) return null;
    return boxScoreFromSummary(summary, humanFranchiseId, playerNames, playerPlayable);
  }
  function resultLabel(summary: SeasonGameSummary): string {
    if (summary.status === 'forfeit') {
      return summary.forfeitLoserFranchiseId === humanFranchiseId ? 'L · forfeit' : 'W · forfeit';
    }
    const won =
      summary.homeFranchiseId === humanFranchiseId
        ? summary.homeScore > summary.awayScore
        : summary.awayScore > summary.homeScore;
    return won ? 'W' : 'L';
  }
</script>

<svelte:head>
  <title>Season Run — checkpoint — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
        Season Run · checkpoint
      </p>
      <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        Block {lastBlock ? String(lastBlock.blockIndex + 1) : '—'} recap
      </h1>
      {#if recap}
        <p class="mt-2 text-sm text-muted-foreground">
          {ordinal(recap.completedRounds)} rounds complete · recap of the last checkpoint
        </p>
      {/if}
    </div>
    <div class="flex gap-2">
      <a
        href={resolve('/season/league')}
        class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        League hub
      </a>
      <a
        href={resolve('/')}
        class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Back
      </a>
    </div>
  </div>

  {#if loadError}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      Failed to load the checkpoint: {loadError}
    </p>
  {/if}
  {#if !snapshot}
    <p class="mt-8 font-mono text-sm text-muted-foreground">Loading the checkpoint…</p>
  {:else if !lastBlock}
    <div class="mt-10 flex flex-col gap-4">
      <p class="font-mono text-sm text-muted-foreground">
        No block has been accepted yet — submit the first block from the league hub.
      </p>
      <a
        href={resolve('/season/league')}
        class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        Open league hub
      </a>
    </div>
  {:else if recap}
    <div class="mt-8 flex flex-col gap-8 pb-32">
      <CheckpointRecap {recap} humanRecord={recap.humanRecord} {franchiseName} {playerName} />

      {#if humanGames.length > 0}
        <section aria-labelledby="checkpoint-boxes-heading">
          <h2
            id="checkpoint-boxes-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Box scores · your games
          </h2>
          <div class="mt-3 flex flex-col gap-3">
            {#each humanGames as summary (summary.gameId)}
              {@const box = boxFor(summary)}
              <details
                class="group rounded-xl bg-surface-1 open:ring-1 open:ring-ring/30"
                ontoggle={(event) => onBoxScoreToggle(event, summary.gameId)}
              >
                <summary
                  class="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                >
                  <span class="font-mono text-[10px] text-muted-foreground">R{summary.round}</span>
                  <span class="min-w-0 flex-1 truncate">
                    {summary.homeFranchiseId === humanFranchiseId
                      ? `vs ${franchiseName(summary.awayFranchiseId)}`
                      : `at ${franchiseName(summary.homeFranchiseId)}`}
                  </span>
                  <span class="font-mono text-[10px]">
                    {summary.homeScore}–{summary.awayScore}
                    {#if summary.status === 'forfeit'}· forfeit{/if}
                  </span>
                  <span
                    class="rounded-full bg-surface-2 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] {resultLabel(
                      summary,
                    ).startsWith('W')
                      ? 'text-primary'
                      : 'text-muted-foreground'}"
                  >
                    {resultLabel(summary)}
                  </span>
                </summary>
                <div class="border-t border-border/60 p-4">
                  {#if box}
                    {#if openedBoxScores.has(summary.gameId)}
                      {#await loadBoxScore() then { default: BoxScore }}
                        <p class="py-2 font-mono text-xs text-muted-foreground">
                          Loading box score…
                        </p>
                        <BoxScore
                          {box}
                          opponentName={summary.homeFranchiseId === humanFranchiseId
                            ? franchiseName(summary.awayFranchiseId)
                            : franchiseName(summary.homeFranchiseId)}
                          resultLabel={resultLabel(summary)}
                        />
                      {/await}
                      {#if retainedGameIds.includes(summary.gameId)}
                        <p class="mt-2 font-mono text-[10px] text-muted-foreground">
                          Full game detail available.
                        </p>
                      {/if}
                    {/if}
                  {:else}
                    <p class="text-sm text-muted-foreground">Box score unavailable.</p>
                  {/if}
                </div>
              </details>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</section>
