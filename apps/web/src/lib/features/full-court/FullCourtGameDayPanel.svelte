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

  function loadPercentOf(detail: string | null): number | null {
    if (detail === null) return null;
    const match = /^(\d+(?:\.\d+)?)%/.exec(detail);
    return match ? Number(match[1]) : null;
  }

  function toggle(playerId: string): void {
    if (busy || onRestingChange === undefined) return;
    const next = selected.has(playerId)
      ? restingPlayerIds.filter((id) => id !== playerId)
      : [...restingPlayerIds, playerId];
    onRestingChange(next);
  }
</script>

<Panel as="section" padding="md" class="bg-surface-1/80" aria-label="Full Court game-day readiness">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2.5">
      <span class="h-2 w-2 rounded-full bg-positive"></span>
      <h3 class="font-display text-base font-extrabold tracking-wide uppercase">
        Game-day rotation &amp; health
      </h3>
      {#if readiness.fixture !== null}
        <Badge tone="neutral">{readiness.fixture.label}</Badge>
      {/if}
    </div>
    {#if readiness.fixture !== null}
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          <strong class="text-foreground">{readiness.eligibleCount}</strong> healthy
          <span aria-hidden="true">·</span>
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
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      No upcoming fixture. Player availability updates when your next matchup is scheduled.
    </p>
  {:else}
    {#each readiness.warnings as warning (warning)}
      <Alert class="mt-3" tone="warning">
        <p>{warning}</p>
      </Alert>
    {/each}

    <ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Player availability">
      {#each readiness.players as player (player.playerId)}
        {@const loadPct = loadPercentOf(player.detail)}
        {@const staminaPct = loadPct === null ? 100 : Math.max(8, Math.round(100 - loadPct))}
        <li
          class="flex min-h-11 items-center gap-2.5 rounded-xl border border-l-2 border-line-soft bg-surface-2/60 px-3 py-2 transition-colors"
          data-status={player.status}
        >
          <FullCourtPortrait {player} {art} size="sm" eager />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="truncate text-sm font-semibold" title={player.displayName}>
                {player.displayName}
              </p>
              <span class="shrink-0 font-mono text-[9px] text-muted-foreground uppercase">
                {player.positions.slice(0, 2).join('/')}
              </span>
            </div>
            {#if loadPct !== null && player.status !== 'injured' && player.status !== 'unavailable' && !player.resting}
              <div class="mt-1 flex items-center gap-2">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
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
              class="min-h-8 shrink-0 rounded-lg border px-2.5 font-mono text-[10px] font-bold tracking-[0.08em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {player.resting
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-line-strong bg-surface-1 text-muted-foreground hover:border-foreground/30 hover:text-foreground'} {busy ||
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

    {#if readiness.canRest}
      <p class="mt-2 text-[11px] text-muted-foreground">
        Rest choices apply only to this game and clear after it is played. Rested players recover
        extra stamina.
      </p>
    {/if}
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
