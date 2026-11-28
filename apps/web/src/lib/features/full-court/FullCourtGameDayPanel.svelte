<script lang="ts">
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type {
    FullCourtGameDayPlayerStatus,
    FullCourtGameDayReadiness,
  } from './full-court-season-presenter.ts';

  let {
    readiness,
    restingPlayerIds,
    busy = false,
    onRestingChange,
    art = null,
  }: {
    readiness: FullCourtGameDayReadiness;
    restingPlayerIds: readonly string[];
    busy?: boolean;
    onRestingChange?: (playerIds: readonly string[]) => void;
    art?: FullCourtArt | null;
  } = $props();

  const selected = $derived(new Set(restingPlayerIds));

  function toneOf(status: FullCourtGameDayPlayerStatus) {
    switch (status) {
      case 'ready':
        return 'positive' as const;
      case 'fatigued':
        return 'accent' as const;
      case 'injured':
      case 'unavailable':
        return 'negative' as const;
      default:
        return 'neutral' as const;
    }
  }

  function toggle(playerId: string): void {
    if (busy || onRestingChange === undefined) return;
    const next = selected.has(playerId)
      ? restingPlayerIds.filter((id) => id !== playerId)
      : [...restingPlayerIds, playerId];
    onRestingChange(next);
  }
</script>

<Panel as="section" padding="md" aria-label="Full Court game-day readiness">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span
        class="h-2 w-2 rounded-full {readiness.availableCount < readiness.requiredPlayers
          ? 'bg-negative'
          : 'bg-positive'}"
        aria-hidden="true"
      ></span>
      <h3 class="font-display text-base font-extrabold tracking-wide uppercase">
        Rotation &amp; health
      </h3>
      {#if readiness.fixture !== null}
        <span class="ui-micro">{readiness.fixture.label}</span>
      {/if}
    </div>
    {#if readiness.fixture !== null}
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          <strong class="text-foreground">{readiness.eligibleCount}</strong> healthy ·
          <strong
            class={readiness.availableCount < readiness.requiredPlayers
              ? 'text-negative'
              : 'text-foreground'}>{readiness.availableCount}</strong
          >
          active
        </span>
        {#if readiness.restingCount > 0}
          <Badge tone="accent">{readiness.restingCount} resting</Badge>
        {/if}
      </div>
    {/if}
  </div>

  {#if readiness.fixture === null}
    <p class="mt-2 text-xs text-muted-foreground">No upcoming fixture.</p>
  {:else}
    {#if readiness.availableCount < readiness.requiredPlayers || readiness.restConflict}
      {#each readiness.warnings as warning (warning)}
        <Alert class="mt-2.5" tone="warning">
          <p>{warning}</p>
        </Alert>
      {/each}
    {:else if readiness.warnings.length > 0}
      <p class="mt-1.5 text-xs text-muted-foreground">
        {readiness.warnings[0]}
      </p>
    {/if}

    <ul class="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Player availability">
      {#each readiness.players as player (player.playerId)}
        {@const loadPct = player.loadPercent}
        {@const staminaPct = Math.max(8, Math.round(100 - loadPct))}
        <li
          class="flex min-h-11 items-center gap-2.5 rounded-lg border border-l-2 border-line-soft bg-surface-1 px-2.5 py-1.5 transition-colors"
          data-status={player.status}
        >
          <FullCourtPortrait {player} {art} size="sm" eager />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-1.5">
              <p class="truncate text-xs font-bold" title={player.displayName}>
                {player.displayName}
              </p>
              <span class="ui-micro shrink-0">
                {player.positions.slice(0, 2).join('/')}
              </span>
            </div>
            {#if loadPct > 0 && (player.status === 'ready' || player.status === 'fatigued')}
              <div class="mt-1 flex items-center gap-2">
                <div class="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    class="h-full rounded-full transition-all {loadPct >= 60
                      ? 'bg-accent'
                      : 'bg-positive'}"
                    style={`width: ${String(staminaPct)}%`}
                  ></div>
                </div>
                <span class="font-mono text-[9px] text-muted-foreground tabular-nums">
                  {loadPct}% load
                </span>
              </div>
            {:else if player.detail !== null}
              <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{player.detail}</p>
            {/if}
          </div>

          <Badge tone={toneOf(player.status)}>{player.statusLabel}</Badge>

          {#if onRestingChange !== undefined && (readiness.canRest || player.resting) && player.status !== 'injured' && player.status !== 'unavailable'}
            <button
              type="button"
              disabled={busy || !player.canRest}
              aria-pressed={player.resting}
              aria-label={`Rest ${player.displayName} for ${readiness.fixture.label}`}
              onclick={() => toggle(player.playerId)}
              class="min-h-7 shrink-0 rounded-md border px-2 font-mono text-[9px] font-bold tracking-[0.06em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {player.resting
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-line-strong bg-surface-2 text-muted-foreground hover:text-foreground'} {busy ||
              !player.canRest
                ? 'cursor-not-allowed opacity-45'
                : 'cursor-pointer'}"
            >
              {player.resting ? 'Resting' : 'Rest'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Panel>

<style>
  [data-status='ready'] {
    border-left-color: color-mix(in oklab, var(--color-positive) 70%, var(--color-line-soft));
  }
  [data-status='fatigued'] {
    border-left-color: color-mix(in oklab, var(--color-accent) 70%, var(--color-line-soft));
  }
  [data-status='injured'],
  [data-status='unavailable'] {
    border-left-color: color-mix(in oklab, var(--color-negative) 70%, var(--color-line-soft));
  }
  [data-status='resting'] {
    border-left-color: color-mix(in oklab, var(--color-primary) 70%, var(--color-line-soft));
  }
</style>
