<script lang="ts">
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import type {
    FullCourtGameDayPlayerStatus,
    FullCourtGameDayReadiness,
  } from './full-court-season-presenter.ts';

  let {
    readiness,
    restingPlayerIds,
    busy = false,
    onRestingChange,
  }: {
    readiness: FullCourtGameDayReadiness;
    restingPlayerIds: readonly string[];
    busy?: boolean;
    onRestingChange?: (playerIds: readonly string[]) => void;
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
  <SectionHeading eyebrow="Next game" title="Game-day readiness" level={2} size="sm">
    {#snippet actions()}
      {#if readiness.fixture !== null}
        <Badge tone="neutral">{readiness.fixture.label}</Badge>
      {/if}
    {/snippet}
  </SectionHeading>

  {#if readiness.fixture === null}
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
      No upcoming Full Court game. Availability appears when your next fixture is set.
    </p>
  {:else}
    <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <p class="text-xs text-muted-foreground">
        <strong class="text-foreground">{readiness.eligibleCount}</strong> healthy
        <span aria-hidden="true">·</span>
        <strong
          class={readiness.availableCount < readiness.requiredPlayers
            ? 'text-negative'
            : 'text-foreground'}>{readiness.availableCount}</strong
        >
        available after rest
      </p>
      {#if readiness.restingCount > 0}
        <Badge tone="neutral">{readiness.restingCount} resting</Badge>
      {/if}
    </div>

    {#each readiness.warnings as warning (warning)}
      <Alert class="mt-3" tone="warning">
        <p>{warning}</p>
      </Alert>
    {/each}

    <ul class="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Player availability">
      {#each readiness.players as player (player.playerId)}
        <li
          class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line-soft bg-surface-1 px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold" title={player.displayName}>
              {player.displayName}
            </p>
            <p class="ui-micro text-muted-foreground">
              {player.positions.slice(0, 2).join('/')}
              {#if player.detail !== null}
                <span aria-hidden="true">·</span>
                {player.detail}
              {/if}
            </p>
          </div>
          <Badge tone={toneOf(player.status)}>{player.statusLabel}</Badge>
          {#if onRestingChange !== undefined && (readiness.canRest || player.resting) && player.status !== 'injured' && player.status !== 'unavailable'}
            <label
              class="flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg border border-line-soft px-2.5 text-[10px] font-bold tracking-[0.08em] text-muted-foreground uppercase focus-within:ring-2 focus-within:ring-ring {player.resting
                ? 'border-primary/50 bg-primary/10 text-primary'
                : ''} {busy || !player.canRest
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer'}"
            >
              <input
                class="h-4 w-4 accent-primary"
                type="checkbox"
                checked={player.resting}
                disabled={busy || !player.canRest}
                aria-label={`Rest ${player.displayName} for ${readiness.fixture.label}`}
                onchange={() => toggle(player.playerId)}
              />
              Rest
            </label>
          {/if}
        </li>
      {/each}
    </ul>

    {#if readiness.canRest}
      <p class="mt-2 text-[11px] text-muted-foreground">
        Rest choices apply only to this game and clear after it is played.
      </p>
    {/if}
  {/if}
</Panel>
