<script lang="ts">
  import type { FullCourtDefensiveMatchupAssignment } from '@hoop-rush/data-contracts';
  import { Plus, RotateCcw, Trash2 } from '@lucide/svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
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
    canCustomize = false,
    art = null,
    onMatchupsChange,
    onResetMatchups,
    ariaLabel = 'Full Court defensive matchups',
  }: {
    context: FullCourtMatchupEditorContext | null;
    busy?: boolean;
    readOnly?: boolean;
    canCustomize?: boolean;
    art?: FullCourtArt | null;
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
    <SectionHeading title="Defensive matchups" level={3} size="sm">
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

    {#if context !== null}
      <div class="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Opponent roster" role="group">
        {#each [{ label: 'Starters', starter: true }, { label: 'Bench', starter: false }] as group (group.label)}
          <div>
            <h4 class="mb-2 text-sm font-semibold">{group.label}</h4>
            <ul class="grid gap-1.5">
              {#each view.opponents.filter((option) => option.starter === group.starter) as option (option.playerId)}
                {@const player = context.opponentTeam.roster.find(
                  (entry) => entry.playerId === option.playerId,
                )}
                {@const minutes = option.plannedMinutes}
                {#if player !== undefined}
                  <li class="rounded-lg border border-line-soft bg-surface-1 p-2">
                    <details>
                      <summary
                        class="cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          class="inline-flex w-[calc(100%-1.25rem)] min-w-0 items-center gap-2 align-middle"
                        >
                          <FullCourtPortrait {player} {art} size="sm" />
                          <span class="min-w-0 flex-1">
                            <span class="block text-sm font-semibold">{player.displayName}</span>
                            <span class="text-xs text-muted-foreground"
                              >{formatPositions(player.positions)}{option.available
                                ? ''
                                : ' · Out'}</span
                            >
                          </span>
                          <span class="shrink-0 text-right text-xs tabular-nums">
                            {#if player.overall !== undefined}<strong class="block"
                                >{player.overall} OVR</strong
                              >{/if}
                            {#if minutes !== null && option.available}<span
                                class="text-muted-foreground">{minutes} projected min</span
                              >{/if}
                          </span>
                        </span>
                      </summary>
                      {#if player.anchors !== undefined}
                        <p class="mt-2 text-xs font-semibold">Source season averages</p>
                        <p class="mt-1 text-xs tabular-nums text-muted-foreground">
                          {player.anchors.pointsPerGame.toFixed(1)} pts ·
                          {player.anchors.reboundsPerGame.toFixed(1)} reb ·
                          {player.anchors.assistsPerGame.toFixed(1)} ast
                        </p>
                      {/if}
                      <p class="mt-2 text-xs font-semibold">Player ratings</p>
                      <dl class="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {#each [['Inside scoring', player.ratings.insideScoring], ['Three-point shot', player.ratings.threePoint], ['Passing', player.ratings.passing], ['Defensive rebounding', player.ratings.defensiveRebound], ['Perimeter defense', player.ratings.perimeterDefense], ['Interior defense', player.ratings.interiorDefense]] as [label, rating] (label)}
                          <div class="flex justify-between gap-2">
                            <dt class="text-muted-foreground">{label}</dt>
                            <dd class="font-semibold tabular-nums">{rating}</dd>
                          </div>
                        {/each}
                      </dl>
                    </details>
                  </li>
                {/if}
              {:else}
                <li class="text-xs text-muted-foreground">No players listed.</li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}

    {#if canCustomize}
      <p class="mt-3 text-xs text-muted-foreground">
        Switch to Mastermind to assign individual defenders.
      </p>
    {/if}

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
        The staff will choose who guards each player. {readOnly
          ? ''
          : `You can assign up to ${view.maxMatchups} defenders.`}
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
            {#if readOnly}
              <p class="text-sm">
                <strong
                  >{view.defenders.find((player) => player.playerId === row.defenderPlayerId)
                    ?.displayName ?? 'Unavailable defender'}</strong
                >
                guards {view.opponents.find((player) => player.playerId === row.opponentPlayerId)
                  ?.displayName ?? 'Unavailable opponent'}
              </p>
            {:else}
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
                      <option
                        value={player.playerId}
                        disabled={otherOpponents.has(player.playerId)}
                      >
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
                      <option
                        value={player.playerId}
                        disabled={takenElsewhere || blockedUnavailable}
                      >
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
            {/if}

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
