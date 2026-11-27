<script lang="ts">
  import type { FullCourtDefensiveMatchupAssignment } from '@hoop-rush/data-contracts';
  import { Plus, RotateCcw, Trash2 } from '@lucide/svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import {
    buildFullCourtMatchupEditorView,
    type FullCourtMatchupEditorContext,
  } from './full-court-matchup-presenter.ts';

  const SELECT_CLASS =
    'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  let {
    context,
    busy = false,
    readOnly = false,
    onMatchupsChange,
    onResetMatchups,
    ariaLabel = 'Full Court defensive matchups',
  }: {
    context: FullCourtMatchupEditorContext | null;
    busy?: boolean;
    readOnly?: boolean;
    onMatchupsChange?: (assignments: readonly FullCourtDefensiveMatchupAssignment[]) => void;
    onResetMatchups?: () => void;
    ariaLabel?: string;
  } = $props();

  const view = $derived(buildFullCourtMatchupEditorView(context));
  const locked = $derived(busy || readOnly || onMatchupsChange === undefined);
  const currentAssignments = $derived(
    view === null
      ? ([] as FullCourtDefensiveMatchupAssignment[])
      : view.rows.map((row) => ({
          opponentPlayerId: row.opponentPlayerId,
          defenderPlayerId: row.defenderPlayerId,
        })),
  );

  function addMatchup(): void {
    if (locked || view === null || view.nextPair === null) return;
    onMatchupsChange?.([...currentAssignments, view.nextPair]);
  }

  function updateOpponent(index: number, opponentPlayerId: string): void {
    if (locked || view === null) return;
    if (
      currentAssignments.some(
        (entry, entryIndex) => entryIndex !== index && entry.opponentPlayerId === opponentPlayerId,
      )
    ) {
      return;
    }
    const next = currentAssignments.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, opponentPlayerId } : entry,
    );
    onMatchupsChange?.(next);
  }

  function updateDefender(index: number, defenderPlayerId: string): void {
    if (locked || view === null) return;
    if (
      currentAssignments.some(
        (entry, entryIndex) => entryIndex !== index && entry.defenderPlayerId === defenderPlayerId,
      )
    ) {
      return;
    }
    const next = currentAssignments.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, defenderPlayerId } : entry,
    );
    onMatchupsChange?.(next);
  }

  function removeMatchup(index: number): void {
    if (locked) return;
    onMatchupsChange?.(currentAssignments.filter((_entry, entryIndex) => entryIndex !== index));
  }

  function resetAll(): void {
    if (locked) return;
    if (onResetMatchups !== undefined) {
      onResetMatchups();
      return;
    }
    onMatchupsChange?.([]);
  }
</script>

{#if view !== null}
  <Panel as="section" padding="md" aria-label={ariaLabel}>
    <SectionHeading
      eyebrow="Per-fixture matchups"
      title="Defensive matchups"
      level={3}
      size="sm"
      description="Optional assignments for {view.fixture
        .label} vs {view.opponentName}. Clears after this game plays and never adds rating bonuses."
    >
      {#snippet actions()}
        <div class="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{view.fixture.label}</Badge>
          <Badge tone={view.rows.length > 0 ? 'primary' : 'neutral'}>
            {view.rows.length > 0
              ? `${String(view.rows.length)} / ${String(view.maxMatchups)} assigned`
              : 'Staff default'}
          </Badge>
        </div>
      {/snippet}
    </SectionHeading>

    {#if view.drifted && view.driftMessage !== null}
      <Alert class="mt-3" tone="warning" title="Matchup plan drifted">
        <p>{view.driftMessage}</p>
        {#snippet actions()}
          {#if !locked}
            <Button type="button" size="sm" tone="secondary" onclick={resetAll}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset for {view.fixture.label}
            </Button>
          {/if}
        {/snippet}
      </Alert>
    {/if}

    {#if view.rows.length === 0}
      <p
        class="mt-3 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        Using staff default positional coverage against {view.opponentName}. Assign up to {view.maxMatchups}
        primary defenders when both players are on the floor.
      </p>
    {:else}
      <ul class="mt-3 flex flex-col gap-2" aria-label="Assigned defensive matchups">
        {#each view.rows as row (`${String(row.index)}:${row.opponentPlayerId}:${row.defenderPlayerId}`)}
          {@const otherOpponents = new Set(
            currentAssignments
              .filter((_entry, idx) => idx !== row.index)
              .map((entry) => entry.opponentPlayerId),
          )}
          {@const otherDefenders = new Set(
            currentAssignments
              .filter((_entry, idx) => idx !== row.index)
              .map((entry) => entry.defenderPlayerId),
          )}
          <li class="rounded-xl border border-line-soft bg-surface-1 p-3">
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label class="min-w-0">
                <span class="ui-micro">Opponent target #{row.index + 1}</span>
                <select
                  class={SELECT_CLASS}
                  aria-label="Opponent target {row.index + 1}"
                  value={row.opponentPlayerId}
                  disabled={locked}
                  onchange={(event) => updateOpponent(row.index, event.currentTarget.value)}
                >
                  {#each view.opponents as player (player.playerId)}
                    <option value={player.playerId} disabled={otherOpponents.has(player.playerId)}>
                      {player.displayName} · {formatPositions(player.positions)} ({player.statusLabel})
                    </option>
                  {/each}
                </select>
              </label>

              <label class="min-w-0">
                <span class="ui-micro">Your defender #{row.index + 1}</span>
                <select
                  class={SELECT_CLASS}
                  aria-label="Your defender {row.index + 1}"
                  value={row.defenderPlayerId}
                  disabled={locked}
                  onchange={(event) => updateDefender(row.index, event.currentTarget.value)}
                >
                  {#each view.defenders as player (player.playerId)}
                    {@const takenElsewhere = otherDefenders.has(player.playerId)}
                    {@const blockedUnavailable =
                      !player.eligible && player.playerId !== row.defenderPlayerId}
                    <option value={player.playerId} disabled={takenElsewhere || blockedUnavailable}>
                      {player.displayName} · {formatPositions(player.positions)} ({player.statusLabel})
                    </option>
                  {/each}
                </select>
              </label>

              <Button
                type="button"
                tone="ghost"
                size="sm"
                disabled={locked}
                aria-label="Remove matchup {row.index + 1}"
                onclick={() => removeMatchup(row.index)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Remove
              </Button>
            </div>

            {#if row.fallbackWarning !== null}
              <p class="mt-2 text-[11px] font-medium text-accent">{row.fallbackWarning}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if !locked}
      <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <Button
          type="button"
          size="sm"
          tone="secondary"
          disabled={!view.canAdd}
          onclick={addMatchup}
        >
          <Plus size={14} aria-hidden="true" />
          Add matchup
        </Button>
        {#if view.rows.length > 0 || view.drifted}
          <Button type="button" size="sm" tone="ghost" onclick={resetAll}>
            <RotateCcw size={14} aria-hidden="true" />
            Reset to staff defaults
          </Button>
        {/if}
        <p class="min-w-0 flex-1 text-[11px] text-muted-foreground">
          Each defender covers at most one target. Bench, resting, injured, or fouled-out players
          fall back to normal staff coverage.
        </p>
      </div>
    {/if}
  </Panel>
{/if}
