<script lang="ts">
  import { resolve } from '$app/paths';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
  import type { HavocHubState } from '$lib/havoc/havoc-hub-state.svelte';
  import { havocObjectiveStatusOf, havocRecordLabel, mutationNameOf } from './havoc-presentation';
  import HavocGamecast from './HavocGamecast.svelte';
  import HavocLineupLock from './HavocLineupLock.svelte';

  let {
    hub,
    onOpenResult,
    onAbandoned,
  }: {
    hub: HavocHubState;
    onOpenResult: () => void;
    onAbandoned: () => void;
  } = $props();

  let abandonOpen = $state(false);
  const run = $derived(hub.run);
  const objective = $derived(run === null ? null : havocObjectiveStatusOf(run));
  const progressPercent = $derived(
    run === null
      ? 0
      : Math.round(((hub.progress?.gamesCompleted ?? run.havocCursor) / HAVOC_GAME_COUNT) * 100),
  );
  const havocComplete = $derived((run?.havocCursor ?? 0) >= HAVOC_GAME_COUNT);

  async function confirmAbandon(): Promise<void> {
    const accepted = await hub.abandon();
    if (accepted) {
      abandonOpen = false;
      onAbandoned();
    }
  }
</script>

<section class="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6 sm:py-10" data-havoc-hub>
  {#if hub.loading}
    <p class="font-mono text-sm text-muted-foreground" aria-live="polite">Loading your run…</p>
  {:else if run === null}
    <div class="mx-auto w-full max-w-xl rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        No active Havoc run
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Start a draft to build five mutated player-seasons and take on the 82-game challenge.
      </p>
      <a
        href={resolve('/havoc')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Go to Havoc setup
      </a>
    </div>
  {:else if run.phase === 'draft'}
    <div class="mx-auto w-full max-w-xl rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Draft in progress
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Your draft is saved. Head back to finish picking five.
      </p>
      <a
        href={resolve('/havoc')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Continue draft
      </a>
    </div>
  {:else}
    <header class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Hoop Havoc · Season run
        </p>
        <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
          {havocRecordLabel(run.havocWins, run.havocLosses)}
        </h1>
        {#if objective !== null}
          <p
            class="mt-1 text-sm font-semibold"
            data-havoc-objective
            data-havoc-objective-tone={objective.tone}
          >
            {objective.label} — {objective.detail}
          </p>
        {/if}
      </div>
      <button
        type="button"
        data-havoc-abandon
        onclick={() => (abandonOpen = true)}
        class="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
      >
        Abandon run
      </button>
    </header>

    {#if hub.gamecast !== null}
      <div class="mt-5">
        <HavocGamecast
          state={hub.gamecast}
          onAccept={() => void hub.acceptWatchedGame()}
          onClose={() => hub.closeGamecast()}
        />
      </div>
    {:else}
      <section aria-labelledby="havoc-next-game" class="mt-5 rounded-xl bg-surface-1 p-4 sm:p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2
              id="havoc-next-game"
              class="font-display text-lg font-extrabold tracking-tight uppercase"
            >
              {#if havocComplete}
                Season complete
              {:else}
                Game {run.nextGameNumber} of {HAVOC_GAME_COUNT}
              {/if}
            </h2>
            {#if !havocComplete && run.nextOpponentDisplayName !== null}
              <p class="mt-1 text-sm text-muted-foreground">
                {run.nextHumanHome === true ? 'Home vs' : 'Away at'}
                <span class="font-semibold text-foreground">{run.nextOpponentDisplayName}</span>
              </p>
            {/if}
          </div>
          <span class="font-mono text-xs text-muted-foreground" data-havoc-progress-label>
            {hub.progress?.gamesCompleted ?? run.havocCursor} / {HAVOC_GAME_COUNT}
          </span>
        </div>

        <div
          class="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Havoc season progress"
          aria-valuemin="0"
          aria-valuemax={HAVOC_GAME_COUNT}
          aria-valuenow={hub.progress?.gamesCompleted ?? run.havocCursor}
        >
          <div
            class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style="width: {progressPercent}%"
          ></div>
        </div>

        {#if havocComplete}
          <button
            type="button"
            data-havoc-open-result
            onclick={onOpenResult}
            class="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            Season results & comparison
          </button>
        {:else}
          <div class="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              data-havoc-watch
              onclick={() => void hub.watchNext()}
              disabled={hub.watchBusy || hub.busy}
              class="inline-flex min-h-12 touch-manipulation items-center justify-center rounded-lg border border-primary px-3 py-3 text-xs font-extrabold tracking-wide text-primary uppercase outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hub.watchBusy ? 'Preparing tape…' : 'Watch game'}
            </button>
            <button
              type="button"
              data-havoc-next-game
              onclick={() => void hub.nextGame()}
              disabled={hub.busy}
              class="inline-flex min-h-12 touch-manipulation items-center justify-center rounded-lg bg-primary px-3 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next game
            </button>
            <button
              type="button"
              data-havoc-next-ten
              onclick={() => void hub.nextTen()}
              disabled={hub.busy}
              class="inline-flex min-h-12 touch-manipulation items-center justify-center rounded-lg bg-primary px-3 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next ten
            </button>
            <button
              type="button"
              data-havoc-finish-season
              onclick={() => void hub.finishSeason()}
              disabled={hub.busy}
              class="inline-flex min-h-12 touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Finish season
            </button>
            {#if hub.busy}
              <button
                type="button"
                data-havoc-cancel
                onclick={() => void hub.cancel()}
                disabled={hub.cancelling}
                class="col-span-2 inline-flex min-h-11 touch-manipulation items-center justify-center rounded-lg border border-destructive/50 px-4 py-2 text-xs font-semibold text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                {hub.cancelling ? 'Stopping…' : 'Stop after this game'}
              </button>
            {/if}
          </div>
        {/if}

        {#if hub.notice !== null}
          <p role="status" class="mt-3 rounded-lg bg-surface-2 p-3 text-xs">{hub.notice}</p>
        {/if}
      </section>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <HavocLineupLock slots={run.lineup} />

        <section aria-labelledby="havoc-results-heading" class="min-w-0 rounded-xl bg-surface-1">
          <div class="border-b border-border/70 px-4 py-3">
            <h2
              id="havoc-results-heading"
              class="font-display text-base font-extrabold tracking-tight uppercase"
            >
              Results
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {hub.games.length} of {HAVOC_GAME_COUNT} games accepted.
            </p>
          </div>
          {#if hub.games.length === 0}
            <p class="px-4 py-3 text-xs text-muted-foreground">
              No games played yet. Simulate or watch game 1.
            </p>
          {:else}
            <ul
              class="havoc-scroll-y grid max-h-96 grid-cols-1 gap-1.5 overflow-y-auto overscroll-contain p-3 sm:grid-cols-2"
            >
              {#each hub.games as game (game.gameNumber)}
                <li
                  class="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
                  data-havoc-game-result={game.gameNumber}
                >
                  <span class="min-w-0">
                    <span class="block font-mono text-[10px] text-muted-foreground uppercase">
                      Game {game.gameNumber} · {game.humanSide === 'home' ? 'Home' : 'Away'}
                    </span>
                    <span class="block font-mono text-sm font-bold">
                      {game.humanScore}–{game.opponentScore}
                    </span>
                  </span>
                  <span
                    class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase {game.outcome ===
                    'win'
                      ? 'bg-primary/15 text-primary'
                      : 'bg-destructive/15 text-destructive'}"
                  >
                    {game.outcome === 'win' ? 'W' : 'L'}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>

      <section
        aria-labelledby="havoc-stats-heading"
        class="mt-5 rounded-xl bg-surface-1 p-4 sm:p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="havoc-stats-heading"
              class="font-display text-base font-extrabold tracking-tight uppercase"
            >
              Season stats
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              Totals from every accepted game, including clones and replacements.
            </p>
          </div>
          <button
            type="button"
            data-havoc-load-stats
            onclick={() => void hub.loadSeasonStats()}
            disabled={hub.statsLoading || hub.games.length === 0}
            class="inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-border px-4 py-2 text-xs font-semibold outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
          >
            {hub.statsLoading
              ? 'Folding stats…'
              : hub.seasonStats === null
                ? 'Load season stats'
                : 'Reload stats'}
          </button>
        </div>

        {#if hub.seasonStats !== null}
          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div class="havoc-scroll-x hidden sm:block">
                <table class="w-full min-w-[30rem] text-xs" data-havoc-player-stats>
                  <thead>
                    <tr
                      class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
                    >
                      <th scope="col" class="px-2 py-1.5 text-left font-medium">Player</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">G</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Pts</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Reb</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Ast</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Stl</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Blk</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">TO</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each hub.seasonStats.players as player (player.instanceId)}
                      <tr class="border-b border-border/40">
                        <th
                          scope="row"
                          class="max-w-40 truncate px-2 py-1.5 text-left font-semibold"
                        >
                          {player.displayName}
                          <span
                            class="block font-mono text-[10px] font-normal text-muted-foreground"
                          >
                            {player.slot} · {player.kind}
                          </span>
                        </th>
                        <td class="px-2 py-1.5 text-right font-mono">{player.games}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold">{player.points}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.rebounds}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.assists}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.steals}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.blocks}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.turnovers}</td>
                        <td class="px-2 py-1.5 text-right font-mono">{player.fouls}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <ul class="flex flex-col gap-2 sm:hidden" data-havoc-player-stats-mobile>
                {#each hub.seasonStats.players as player (player.instanceId)}
                  <li class="rounded-lg bg-surface-2 p-3">
                    <p class="flex items-baseline justify-between gap-2">
                      <span class="min-w-0 truncate text-sm font-semibold"
                        >{player.displayName}</span
                      >
                      <span class="shrink-0 font-mono text-sm font-bold">{player.points} pts</span>
                    </p>
                    <p class="mt-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                      {player.slot} · {player.kind} · {player.games} g
                    </p>
                    <dl class="mt-2 grid grid-cols-4 gap-1.5 text-center">
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">Reb</dt>
                        <dd class="font-mono text-xs font-bold">{player.rebounds}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">Ast</dt>
                        <dd class="font-mono text-xs font-bold">{player.assists}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">Stl</dt>
                        <dd class="font-mono text-xs font-bold">{player.steals}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">Blk</dt>
                        <dd class="font-mono text-xs font-bold">{player.blocks}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">TO</dt>
                        <dd class="font-mono text-xs font-bold">{player.turnovers}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">PF</dt>
                        <dd class="font-mono text-xs font-bold">{player.fouls}</dd>
                      </div>
                      <div class="col-span-2 rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">Games</dt>
                        <dd class="font-mono text-xs font-bold">{player.games}</dd>
                      </div>
                    </dl>
                  </li>
                {/each}
              </ul>
            </div>
            <div>
              <div class="havoc-scroll-x hidden sm:block">
                <table class="w-full min-w-[26rem] text-xs" data-havoc-mutation-stats>
                  <thead>
                    <tr
                      class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
                    >
                      <th scope="col" class="px-2 py-1.5 text-left font-medium">Mutation</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Triggers</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Pts Δ</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">FTs</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">TOs canceled</th>
                      <th scope="col" class="px-2 py-1.5 text-right font-medium">Extra poss.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each hub.seasonStats.mutations as mutation (mutation.mutationId)}
                      <tr class="border-b border-border/40">
                        <th scope="row" class="px-2 py-1.5 text-left font-semibold">
                          {mutationNameOf(mutation.mutationId)}
                        </th>
                        <td class="px-2 py-1.5 text-right font-mono">{mutation.triggers}</td>
                        <td class="px-2 py-1.5 text-right font-mono font-bold">
                          {mutation.pointsDelta}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono"
                          >{mutation.freeThrowsGranted}</td
                        >
                        <td class="px-2 py-1.5 text-right font-mono">
                          {mutation.turnoversCancelled}
                        </td>
                        <td class="px-2 py-1.5 text-right font-mono">
                          {mutation.extraPossessionsEarned}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <ul class="flex flex-col gap-2 sm:hidden" data-havoc-mutation-stats-mobile>
                {#each hub.seasonStats.mutations as mutation (mutation.mutationId)}
                  <li class="rounded-lg bg-surface-2 p-3">
                    <p class="flex items-baseline justify-between gap-2">
                      <span class="min-w-0 truncate text-sm font-semibold"
                        >{mutationNameOf(mutation.mutationId)}</span
                      >
                      <span class="shrink-0 font-mono text-sm font-bold"
                        >{mutation.triggers} trig · {mutation.pointsDelta} pts</span
                      >
                    </p>
                    <dl class="mt-2 grid grid-cols-3 gap-1.5 text-center">
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">FTs</dt>
                        <dd class="font-mono text-xs font-bold">{mutation.freeThrowsGranted}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">TO ✕</dt>
                        <dd class="font-mono text-xs font-bold">{mutation.turnoversCancelled}</dd>
                      </div>
                      <div class="rounded bg-surface-3/60 px-1 py-1">
                        <dt class="font-mono text-[9px] text-muted-foreground uppercase">+Poss</dt>
                        <dd class="font-mono text-xs font-bold">
                          {mutation.extraPossessionsEarned}
                        </dd>
                      </div>
                    </dl>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    {#if hub.error !== null}
      <p
        role="alert"
        class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
      >
        {hub.error}
      </p>
    {/if}

    <Dialog.Root bind:open={abandonOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          class="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none"
        >
          <div class="flex items-start justify-between gap-3">
            <Dialog.Title class="font-display text-xl font-extrabold tracking-tight uppercase">
              Abandon this run?
            </Dialog.Title>
            <Dialog.Close
              aria-label="Cancel"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
            >
              <X class="h-4 w-4" />
            </Dialog.Close>
          </div>
          <p class="mt-3 text-sm text-muted-foreground">
            The run leaves your active save and joins Hall of Freaks as an unsuccessful run. No
            progress is deleted.
          </p>
          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close
              class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
              Stay
            </Dialog.Close>
            <button
              type="button"
              data-havoc-confirm-abandon
              onclick={() => void confirmAbandon()}
              disabled={hub.busy}
              class="inline-flex min-h-11 items-center justify-center rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Abandon run
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {/if}
</section>
