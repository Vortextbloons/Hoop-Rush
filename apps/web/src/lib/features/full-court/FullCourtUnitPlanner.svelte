<script lang="ts">
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import { formatPositions } from '#lib/player-positions.js';
  import Button from '#lib/components/ui/Button.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    FULL_COURT_MAX_UNITS,
    FULL_COURT_UNIT_MINUTE_BUDGET,
    FULL_COURT_UNIT_NAME_MAX_LENGTH,
    type FullCourtNamedUnitDraft,
  } from './full-court-coaching-presenter.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  const SLOTS = [0, 1, 2, 3, 4] as const;
  const SELECT_CLASS =
    'mt-1 min-h-9 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  let {
    units,
    roster,
    art = null,
    locked = false,
    onAdd,
    onRemove,
    onRename,
    onMinutes,
    onPlayer,
    onUseAsClosingFive,
  }: {
    units: readonly FullCourtNamedUnitDraft[];
    roster: readonly SimulationPlayer[];
    art?: FullCourtArt | null;
    locked?: boolean;
    onAdd: () => void;
    onRemove: (index: number) => void;
    onRename: (index: number, name: string) => void;
    onMinutes: (index: number, minutes: number) => void;
    onPlayer: (index: number, slot: number, playerId: string) => void;
    onUseAsClosingFive: (unit: FullCourtNamedUnitDraft) => void;
  } = $props();

  const playerNames = $derived(
    new Map(roster.map((player) => [player.playerId, player.displayName])),
  );
  const playerById = $derived(new Map(roster.map((player) => [player.playerId, player])));
  const planned = $derived(units.reduce((total, unit) => total + (unit.plannedMinutes ?? 0), 0));
  const segments = $derived(
    units
      .map((unit, index) => ({ unit, index }))
      .filter((entry) => (entry.unit.plannedMinutes ?? 0) > 0),
  );
  const remaining = $derived(Math.max(0, FULL_COURT_UNIT_MINUTE_BUDGET - planned));
  const overBudget = $derived(planned > FULL_COURT_UNIT_MINUTE_BUDGET);

  function clampUnitMinutes(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(FULL_COURT_UNIT_MINUTE_BUDGET, Math.round(value)));
  }

  function unitPlayers(unit: FullCourtNamedUnitDraft): SimulationPlayer[] {
    return unit.playerIds
      .map((playerId) => playerById.get(playerId))
      .filter((player): player is SimulationPlayer => player !== undefined);
  }
</script>

<div class="unit-plan">
  <div class="unit-strip-wrap">
    <div class="unit-strip-head">
      <p class="ui-label">Second-quarter plan</p>
      <p class="ui-micro" data-over={overBudget}>
        {planned} / {FULL_COURT_UNIT_MINUTE_BUDGET} min
      </p>
    </div>
    <div
      class="unit-strip"
      data-over={overBudget}
      role="img"
      aria-label={`Second-quarter unit plan: ${String(planned)} of ${String(FULL_COURT_UNIT_MINUTE_BUDGET)} minutes across ${String(segments.length)} named units`}
    >
      {#each segments as segment, index (segment.unit.name + String(segment.index))}
        <span
          class="unit-strip-segment"
          style:width={`${String(((segment.unit.plannedMinutes ?? 0) / FULL_COURT_UNIT_MINUTE_BUDGET) * 100)}%`}
          style:opacity={`${String(Math.max(0.45, 1 - index * 0.1))}`}
        >
          <span class="unit-strip-label">{segment.unit.name || 'Unit'}</span>
          <span class="unit-strip-min">{segment.unit.plannedMinutes}</span>
        </span>
      {/each}
      {#if overBudget}
        <span class="unit-strip-over">Over budget</span>
      {:else if remaining > 0}
        <span
          class="unit-strip-open"
          style:width={`${String((remaining / FULL_COURT_UNIT_MINUTE_BUDGET) * 100)}%`}
        >
          Open
        </span>
      {/if}
    </div>
    <div class="unit-strip-scale" aria-hidden="true">
      <span>Tip-off Q2</span>
      <span>12:00</span>
    </div>
  </div>

  {#if units.length === 0}
    <p class="unit-empty">
      No named units. Add a five you can reuse in a closing rule or copy to the closing five.
    </p>
  {:else}
    <ul class="unit-list">
      {#each units as unit, index (index)}
        {@const players = unitPlayers(unit)}
        <li class="unit-card">
          <div class="unit-card-head">
            <div class="unit-portraits" aria-hidden="true">
              {#each SLOTS as slot (slot)}
                {@const player = playerById.get(unit.playerIds[slot] ?? '')}
                {#if player !== undefined}
                  <FullCourtPortrait {player} {art} size="xs" />
                {:else}
                  <span class="unit-portrait-empty">+</span>
                {/if}
              {/each}
            </div>
            <label class="unit-minutes">
              <span class="ui-micro">Planned minutes</span>
              <span class="unit-minutes-control">
                <input
                  type="range"
                  min="0"
                  max={FULL_COURT_UNIT_MINUTE_BUDGET}
                  step="1"
                  value={unit.plannedMinutes ?? 0}
                  disabled={locked}
                  aria-label={`Planned minutes slider for ${unit.name || 'unit'}`}
                  aria-valuetext={`${String(unit.plannedMinutes ?? 0)} minutes`}
                  oninput={(event) =>
                    onMinutes(index, clampUnitMinutes(event.currentTarget.valueAsNumber))}
                />
                <input
                  type="number"
                  min="0"
                  max={FULL_COURT_UNIT_MINUTE_BUDGET}
                  step="1"
                  class="unit-minutes-input"
                  value={unit.plannedMinutes ?? 0}
                  disabled={locked}
                  aria-label={`Planned minutes for ${unit.name || 'unit'}`}
                  oninput={(event) =>
                    onMinutes(index, clampUnitMinutes(event.currentTarget.valueAsNumber))}
                />
                <span class="ui-micro" aria-hidden="true">min</span>
              </span>
            </label>
          </div>

          <div class="unit-card-controls">
            <label class="min-w-0 flex-1">
              <span class="ui-micro">Unit name</span>
              <input
                type="text"
                class="unit-name"
                maxlength={FULL_COURT_UNIT_NAME_MAX_LENGTH}
                value={unit.name}
                disabled={locked}
                oninput={(event) => onRename(index, event.currentTarget.value)}
              />
            </label>
            <div class="flex flex-wrap gap-1.5">
              <Button
                tone="secondary"
                size="sm"
                type="button"
                disabled={locked}
                onclick={() => onUseAsClosingFive(unit)}
              >
                Use as closing five
              </Button>
              <Button
                tone="ghost"
                size="sm"
                type="button"
                disabled={locked}
                onclick={() => onRemove(index)}
              >
                Remove
              </Button>
            </div>
          </div>

          <div class="unit-lineup">
            {#each SLOTS as slot (slot)}
              <label class="min-w-0">
                <span class="ui-micro">Player {slot + 1}</span>
                <select
                  class={SELECT_CLASS}
                  value={unit.playerIds[slot] ?? ''}
                  disabled={locked}
                  onchange={(event) => onPlayer(index, slot, event.currentTarget.value)}
                >
                  {#each roster as player (player.playerId)}
                    <option value={player.playerId}>
                      {player.displayName} · {formatPositions(player.positions)}
                    </option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>

          {#if players.length < SLOTS.length}
            <p class="unit-warning">
              This unit has {players.length} of 5 players. Choose a full five to use it.
            </p>
          {/if}
          {#if unit.name.trim().length === 0}
            <p class="unit-warning">Give this unit a name so you can find it in a rule.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="mt-3">
    <Button
      tone="secondary"
      type="button"
      disabled={locked || units.length >= FULL_COURT_MAX_UNITS}
      onclick={onAdd}
    >
      Add named unit
    </Button>
  </div>
</div>

<style>
  .unit-plan {
    display: grid;
    gap: 0.75rem;
  }

  .unit-strip-wrap {
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }

  .unit-strip-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .unit-strip-head [data-over='true'] {
    color: var(--color-negative);
  }

  .unit-strip {
    display: flex;
    height: 1.55rem;
    margin-top: 0.45rem;
    overflow: hidden;
    border-radius: 0.45rem;
    background: var(--color-surface-3);
  }

  .unit-strip-segment,
  .unit-strip-open,
  .unit-strip-over {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    overflow: hidden;
    padding: 0 0.35rem;
    background: var(--color-primary);
    color: var(--color-primary-foreground, #0b0b0b);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .unit-strip-segment + .unit-strip-segment,
  .unit-strip-segment + .unit-strip-open {
    border-left: 1px solid color-mix(in srgb, var(--color-background) 65%, transparent);
  }

  .unit-strip-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .unit-strip-min {
    opacity: 0.75;
  }

  .unit-strip-open {
    background:
      repeating-linear-gradient(
        135deg,
        transparent 0 4px,
        color-mix(in srgb, var(--color-line-soft) 70%, transparent) 4px 5px
      ),
      var(--color-surface-2);
    color: var(--color-muted-foreground);
  }

  .unit-strip-over {
    flex: 1;
    background: var(--color-negative);
    color: #fff;
  }

  .unit-strip-scale {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .unit-empty {
    margin: 0;
    padding: 0.6rem 0.7rem;
    border: 1px dashed var(--color-line-soft);
    border-radius: 0.7rem;
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .unit-list {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .unit-card {
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.8rem;
    background: var(--color-surface-1);
  }

  .unit-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .unit-portraits {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .unit-portrait-empty {
    display: grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    border: 1px dashed var(--color-line-soft);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    font-size: 0.6rem;
  }

  .unit-minutes {
    display: grid;
    min-width: 11rem;
    gap: 0.15rem;
  }

  .unit-minutes-control {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .unit-minutes-control input[type='range'] {
    width: 7rem;
    accent-color: var(--color-primary);
  }

  .unit-minutes-input {
    width: 2.6rem;
    min-height: 1.7rem;
    padding: 0 0.2rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.4rem;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .unit-card-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem;
    margin-top: 0.55rem;
  }

  .unit-name {
    margin-top: 0.15rem;
    min-height: 2.25rem;
    width: 100%;
    min-width: 0;
    padding: 0 0.55rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.55rem;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .unit-lineup {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.55rem;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 7.5rem), 1fr));
  }

  .unit-warning {
    margin: 0.45rem 0 0;
    color: var(--color-accent);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1.4;
  }
</style>
