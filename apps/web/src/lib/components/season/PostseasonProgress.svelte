<script lang="ts">
  import { untrack } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import type { HubPostseasonProgress } from '$lib/season/season-postseason-presentation';
  import type { HoopRushManifest, SeasonPostseasonScoreline } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import LiveSimModal from '$lib/components/season/LiveSimModal.svelte';
  import { SIM_BAR_FILL_MS } from '$lib/components/season/live-sim-animation';
  const RECENT_SIZE = 3;
  let {
    progress,
    onCancel,
    onRetry,
    label,
    franchiseAbbrev = (id: string) => id,
    humanFranchiseId = null,
    manifest = null,
  }: {
    progress: HubPostseasonProgress;
    onCancel: () => void;
    onRetry: () => void;
    label: string;
    franchiseAbbrev?: (franchiseId: string) => string;
    humanFranchiseId?: string | null;
    manifest?: HoopRushManifest | null;
  } = $props();
  const percent = $derived(
    progress.gamesTotal > 0
      ? Math.min(100, Math.round((progress.gamesCompleted / progress.gamesTotal) * 100))
      : 0,
  );
  const isRunning = $derived(progress.phase === 'running');
  const isActive = $derived(
    progress.phase === 'running' ||
      progress.phase === 'cancelled' ||
      progress.phase === 'failed' ||
      progress.phase === 'complete',
  );
  let dismissed = $state(false);
  const dialogOpen = $derived(isActive && !dismissed);
  function showLive() {
    dismissed = false;
  }
  function involvesHuman(line: SeasonPostseasonScoreline): boolean {
    if (humanFranchiseId === null) return false;
    return line.homeFranchiseId === humanFranchiseId || line.awayFranchiseId === humanFranchiseId;
  }
  function teamExternalIdOf(franchiseId: string): string {
    if (manifest === null) return '';
    return franchiseIdentityOf(manifest, franchiseId)?.teamExternalId ?? '';
  }
  const humanExternalId = $derived(
    humanFranchiseId === null ? '' : teamExternalIdOf(humanFranchiseId),
  );
  function headlineOf(line: SeasonPostseasonScoreline): string {
    const away = franchiseAbbrev(line.awayFranchiseId);
    const home = franchiseAbbrev(line.homeFranchiseId);
    return `Final: ${away} ${String(line.awayScore)} @ ${home} ${String(line.homeScore)}`;
  }
  let recent = $state<SeasonPostseasonScoreline[]>([]);
  $effect(() => {
    const id = progress.latestGameId;
    const line = progress.latestResult;
    const prior = untrack(() => recent);
    if (line === null || id === null) return;
    if (prior.some((entry) => entry.gameId === id)) return;
    recent = [...prior.slice(-(RECENT_SIZE - 1)), line];
  });
  const feed = $derived([...recent].reverse());
  const countsText = $derived(
    progress.gamesTotal > 0
      ? `${String(progress.gamesCompleted)} / ${String(progress.gamesTotal)} games`
      : null,
  );
</script>

{#if isActive}
  <LiveSimModal
    open={dialogOpen}
    onOpenChange={(next) => {
      if (!next) dismissed = true;
    }}
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-b from-primary/10 to-transparent px-4 py-3"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {#if progress.phase === 'running'}
          <span class="sim-live-pill" role="status">
            <span class="sim-live-dot" aria-hidden="true"></span> Simming
          </span>
        {:else if progress.phase === 'complete'}
          <span class="sim-live-pill" data-tone="final">Final</span>
        {:else}
          <span class="sim-live-pill" data-tone="muted">{progress.phase}</span>
        {/if}
        <Dialog.Title class="font-display text-base font-extrabold uppercase tracking-tight">
          {label}
        </Dialog.Title>
      </div>
      <div class="flex items-center gap-2">
        {#if countsText !== null}
          <span class="font-mono text-xs text-muted-foreground tabular-nums">{countsText}</span>
        {:else}
          <span class="font-mono text-[10px] text-muted-foreground">Starting…</span>
        {/if}
        <Dialog.Close
          aria-label={isRunning ? 'Hide live sim' : 'Close'}
          class="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          <X class="h-4 w-4" />
        </Dialog.Close>
      </div>
    </div>

    <div class="flex flex-col gap-3 px-4 py-4">
      <div>
        {#if feed.length > 0}
          <ul class="grid gap-2 sm:grid-cols-3" aria-label="Latest postseason finals">
            {#each feed as entry (entry.gameId)}
              {@const spot = progress.latestGameId === entry.gameId && involvesHuman(entry)}
              {@const awayExternalId = teamExternalIdOf(entry.awayFranchiseId)}
              {@const homeExternalId = teamExternalIdOf(entry.homeFranchiseId)}
              <li class="sim-ticker-card" data-spot={spot}>
                <span
                  class="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Final{#if spot}
                    · You{/if}
                </span>
                <span class="flex items-center gap-1.5">
                  {#if manifest !== null && awayExternalId !== ''}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={entry.awayFranchiseId}
                      teamExternalId={awayExternalId}
                      size="sm"
                    />
                  {/if}
                  <span class="font-display text-lg font-extrabold tabular-nums">
                    {franchiseAbbrev(entry.awayFranchiseId)}
                    {entry.awayScore}–{entry.homeScore}
                    {franchiseAbbrev(entry.homeFranchiseId)}
                  </span>
                  {#if manifest !== null && homeExternalId !== ''}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={entry.homeFranchiseId}
                      teamExternalId={homeExternalId}
                      size="sm"
                    />
                  {/if}
                </span>
                <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                  {headlineOf(entry)}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-xs text-muted-foreground" role="status">
            {isRunning
              ? 'Warming the worker… finals stream here as games complete.'
              : 'Finals will appear here while simming.'}
          </p>
        {/if}
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.gamesTotal || 1}
        aria-valuenow={progress.gamesCompleted}
        aria-valuetext={progress.gamesTotal > 0
          ? `${String(progress.gamesCompleted)} of ${String(progress.gamesTotal)} postseason games`
          : 'starting'}
      >
        <div class="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <span role="status">
            {progress.gamesTotal > 0
              ? `${String(progress.gamesCompleted)} of ${String(progress.gamesTotal)} games`
              : 'Starting…'}
          </span>
          <span class="font-bold tabular-nums">{percent}%</span>
        </div>
        <div class="sim-bar mt-2" aria-hidden="true">
          <div
            class="sim-bar-fill"
            data-active={isRunning}
            style="width: {percent}%; transition: width {SIM_BAR_FILL_MS}ms linear"
          ></div>
        </div>
      </div>

      {#if progress.phase === 'running'}
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={onCancel}
            class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong motion-reduce:transition-none"
          >
            Cancel
          </button>
          <p class="w-full text-xs text-muted-foreground">
            Use Hide (top right) to tuck this away — the sim keeps running until you cancel it.
          </p>
        </div>
      {/if}

      {#if progress.phase === 'cancelled'}
        <div class="rounded-lg bg-surface-2 p-3 text-sm">
          <p class="font-semibold">Postseason simulation cancelled.</p>
          <p class="mt-1 text-muted-foreground">
            Games already committed stay saved. Retry continues from the current matchup.
          </p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
            >
              Retry
            </button>
            <Dialog.Close
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
            >
              Close
            </Dialog.Close>
          </div>
        </div>
      {/if}

      {#if progress.phase === 'failed' && progress.error}
        <div
          role="alert"
          class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <p class="font-semibold">The postseason simulation failed.</p>
          <p class="mt-1 text-muted-foreground">{progress.error.message}</p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
            >
              Retry
            </button>
            <Dialog.Close
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
            >
              Close
            </Dialog.Close>
          </div>
        </div>
      {/if}

      {#if progress.phase === 'complete'}
        <p class="rounded-lg bg-primary/10 px-3 py-2 text-sm font-bold text-primary" role="status">
          Postseason simulation complete. Results are saved.
        </p>
        <Dialog.Close
          class="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Close
        </Dialog.Close>
      {/if}
    </div>

    <p class="sr-only" role="status" aria-live="polite">
      {progress.phase === 'running'
        ? `${label} started`
        : progress.phase === 'complete'
          ? `${label} complete`
          : progress.phase === 'cancelled'
            ? `${label} cancelled`
            : progress.phase === 'failed'
              ? `${label} failed`
              : ''}
    </p>
  </LiveSimModal>

  {#if !dialogOpen}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3"
      role="status"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {#if progress.phase === 'running'}
          <span class="sim-live-pill" role="status">
            <span class="sim-live-dot" aria-hidden="true"></span> Simming
          </span>
        {:else if progress.phase === 'complete'}
          <span class="sim-live-pill" data-tone="final">Final</span>
        {:else}
          <span class="sim-live-pill" data-tone="muted">{progress.phase}</span>
        {/if}
        {#if manifest !== null && humanFranchiseId !== null && humanExternalId !== ''}
          <SeasonTeamLogo
            {manifest}
            franchiseId={humanFranchiseId}
            teamExternalId={humanExternalId}
            size="md"
            eager
          />
        {/if}
        <p class="truncate text-sm font-semibold">
          {label}{countsText !== null ? ` · ${countsText}` : ''}
        </p>
      </div>
      <button
        type="button"
        onclick={showLive}
        class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        {progress.phase === 'running' ? 'Watch live' : 'Show results'}
      </button>
    </div>
  {/if}
{/if}
