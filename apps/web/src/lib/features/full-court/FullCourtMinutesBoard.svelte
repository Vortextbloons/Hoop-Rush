<script lang="ts">
  import { Lock, LockOpen, Minus, Plus } from '@lucide/svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import Button from '#lib/components/ui/Button.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    FULL_COURT_MAX_PLAYER_MINUTES,
    FULL_COURT_MINUTE_TOTAL,
    type FullCourtTeamMinutesRow,
  } from './full-court-coaching-presenter.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  let {
    groups,
    summary,
    displayedMinutes,
    locked,
    readOnly = false,
    lockedIds = [],
    art = null,
    onMinutes,
    onToggleLock,
    onSit,
  }: {
    groups: readonly {
      label: string;
      rows: readonly FullCourtTeamMinutesRow[];
      total: number;
    }[];
    summary: string;
    displayedMinutes: number;
    locked: boolean;
    readOnly?: boolean;
    lockedIds?: readonly string[];
    art?: FullCourtArt | null;
    onMinutes: (playerId: string, minutes: number) => void;
    onToggleLock: (playerId: string) => void;
    onSit: (playerId: string) => void;
  } = $props();

  const lockedSet = $derived(new Set(lockedIds));
  const MINUTE_PRESETS = [
    { label: 'Star 36', value: 36 },
    { label: 'Starter 30', value: 30 },
    { label: 'Rotation 20', value: 20 },
    { label: 'Bench 8', value: 8 },
    { label: 'Sit 0', value: 0 },
  ] as const;

  function roleLabel(row: FullCourtTeamMinutesRow): string {
    if (row.starterSlot !== null) return `Starter ${String(row.starterSlot + 1)}`;
    return row.minutes === 0 ? 'Out of rotation' : 'Bench';
  }

  function clampMinutes(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(FULL_COURT_MAX_PLAYER_MINUTES, Math.round(value)));
  }

  function rangeFill(minutes: number): string {
    return `--ui-range-progress: ${String((minutes / FULL_COURT_MAX_PLAYER_MINUTES) * 100)}%`;
  }

  function loadTone(load: number): 'negative' | 'accent' | 'muted' {
    if (load >= 60) return 'negative';
    return load >= 25 ? 'accent' : 'muted';
  }
</script>

<div class="minute-summary">
  <div
    class="minute-meter"
    role="img"
    aria-label={`${String(displayedMinutes)} of ${String(FULL_COURT_MINUTE_TOTAL)} minutes assigned`}
  >
    <span
      class="minute-meter-fill"
      data-state={displayedMinutes === FULL_COURT_MINUTE_TOTAL
        ? 'full'
        : displayedMinutes > FULL_COURT_MINUTE_TOTAL
          ? 'over'
          : 'under'}
      style:width={`${String(Math.min(100, (displayedMinutes / FULL_COURT_MINUTE_TOTAL) * 100))}%`}
    ></span>
  </div>
  <p
    class="minute-summary-copy"
    data-state={displayedMinutes === FULL_COURT_MINUTE_TOTAL ? 'full' : 'under'}
    aria-live="polite"
  >
    {summary}
  </p>
</div>

<div class="minute-groups">
  {#each groups as group (group.label)}
    <section class="minute-group" aria-label={`${group.label} minutes`}>
      <header class="minute-group-head">
        <p class="ui-label" data-tone="muted">{group.label}</p>
        <p class="ui-micro">{group.total} min</p>
      </header>
      <ul class="minute-list">
        {#each group.rows as row (row.player.playerId)}
          {@const isLocked = lockedSet.has(row.player.playerId)}
          <li class="minute-row" data-starter={row.starterSlot !== null} data-locked={isLocked}>
            <div class="minute-portrait">
              <FullCourtPortrait player={row.player} {art} size="md" />
            </div>
            <div class="minute-id">
              <span class="minute-name">{row.player.displayName}</span>
              <span class="ui-micro flex flex-wrap items-center gap-x-1.5">
                <span>{roleLabel(row)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatPositions(row.player.positions)}</span>
                {#if row.closer}
                  <span class="text-accent">· Closer</span>
                {/if}
                {#if row.health !== null}
                  <span
                    class={row.health.tone === 'unavailable'
                      ? 'text-negative'
                      : row.health.tone === 'fatigued'
                        ? 'text-accent'
                        : ''}
                  >
                    · {row.health.label}
                  </span>
                {/if}
                {#if row.player.overall != null}
                  <span>· {row.player.overall} OVR</span>
                {/if}
              </span>
              <div class="minute-load">
                <span class="minute-load-label">Workload</span>
                <span
                  class="minute-load-track"
                  role="img"
                  aria-label={`Cumulative workload for ${row.player.displayName}: ${String(row.cumulativeLoad)}%`}
                  data-tone={loadTone(row.cumulativeLoad)}
                >
                  <span
                    class="minute-load-fill"
                    style:width={`${String(Math.min(100, Math.max(0, row.cumulativeLoad)))}%`}
                  ></span>
                </span>
                <span class="minute-load-value" data-tone={loadTone(row.cumulativeLoad)}>
                  {row.cumulativeLoad}%
                </span>
              </div>
            </div>

            {#if readOnly}
              <p class="minute-readout">
                {row.minutes} <span>min</span>
              </p>
            {:else}
              <div class="minute-control">
                <div class="minute-stepper">
                  <button
                    type="button"
                    class="minute-step"
                    disabled={locked || row.minutes <= 0}
                    aria-label={`Decrease minutes for ${row.player.displayName}`}
                    onclick={() => onMinutes(row.player.playerId, row.minutes - 1)}
                  >
                    <Minus size={13} aria-hidden="true" />
                  </button>
                  <label class="minute-value">
                    <span class="sr-only">Minutes for {row.player.displayName}</span>
                    <input
                      type="number"
                      inputmode="numeric"
                      min="0"
                      max={FULL_COURT_MAX_PLAYER_MINUTES}
                      step="1"
                      class="minute-input"
                      value={row.minutes}
                      disabled={locked}
                      oninput={(event) =>
                        onMinutes(
                          row.player.playerId,
                          clampMinutes(event.currentTarget.valueAsNumber),
                        )}
                    />
                    <span class="minute-unit" aria-hidden="true">min</span>
                  </label>
                  <button
                    type="button"
                    class="minute-step"
                    disabled={locked || row.minutes >= FULL_COURT_MAX_PLAYER_MINUTES}
                    aria-label={`Increase minutes for ${row.player.displayName}`}
                    onclick={() => onMinutes(row.player.playerId, row.minutes + 1)}
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </div>
                <input
                  type="range"
                  class="minute-slider ui-range"
                  min="0"
                  max={FULL_COURT_MAX_PLAYER_MINUTES}
                  step="1"
                  value={row.minutes}
                  disabled={locked}
                  style={rangeFill(row.minutes)}
                  aria-label={`Minutes slider for ${row.player.displayName}`}
                  aria-valuetext={`${String(row.minutes)} minutes`}
                  oninput={(event) =>
                    onMinutes(row.player.playerId, clampMinutes(event.currentTarget.valueAsNumber))}
                />
              </div>

              <div class="minute-actions">
                <select
                  class="minute-preset"
                  value=""
                  disabled={locked}
                  aria-label={`Quick minute preset for ${row.player.displayName}`}
                  title="Quick set minutes"
                  onchange={(event) => {
                    const raw = event.currentTarget.value;
                    if (raw === '') return;
                    onMinutes(row.player.playerId, Number(raw));
                    event.currentTarget.value = '';
                  }}
                >
                  <option value="">Set</option>
                  {#each MINUTE_PRESETS as preset (preset.value)}
                    <option value={preset.value}>{preset.label}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="minute-lock"
                  data-locked={isLocked}
                  disabled={locked}
                  aria-pressed={isLocked}
                  aria-label={isLocked
                    ? `Unlock minutes for ${row.player.displayName}`
                    : `Lock minutes for ${row.player.displayName}`}
                  title={isLocked
                    ? 'Keep this minute target when rebalancing'
                    : 'Lock this minute target'}
                  onclick={() => onToggleLock(row.player.playerId)}
                >
                  {#if isLocked}
                    <Lock size={13} aria-hidden="true" />
                  {:else}
                    <LockOpen size={13} aria-hidden="true" />
                  {/if}
                </button>
                {#if row.starterSlot === null && !row.closer && row.minutes > 0}
                  <Button
                    type="button"
                    tone="ghost"
                    size="sm"
                    disabled={locked}
                    aria-label={`Sit ${row.player.displayName}`}
                    onclick={() => onSit(row.player.playerId)}
                  >
                    Sit
                  </Button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .minute-summary {
    margin-top: 0.6rem;
  }

  .minute-meter {
    height: 0.5rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-surface-3);
  }

  .minute-meter-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-primary);
    transition: width 140ms ease;
  }

  .minute-meter-fill[data-state='full'] {
    background: var(--color-positive);
  }

  .minute-meter-fill[data-state='over'] {
    background: var(--color-negative);
  }

  .minute-summary-copy {
    margin: 0.35rem 0 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .minute-summary-copy[data-state='full'] {
    color: var(--color-positive);
  }

  .minute-groups {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.7rem;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 1024px) {
    .minute-groups {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .minute-group {
    min-width: 0;
  }

  .minute-group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0.15rem;
  }

  .minute-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0.35rem 0 0;
    padding: 0;
    list-style: none;
  }

  .minute-row {
    display: grid;
    min-width: 0;
    align-items: center;
    gap: 0.4rem 0.5rem;
    padding: 0.45rem 0.5rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.7rem;
    background: var(--color-surface-1);
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'portrait id'
      'portrait control'
      'portrait actions';
  }

  @media (min-width: 640px) {
    .minute-row {
      grid-template-columns: auto minmax(0, 1fr) minmax(7.5rem, 10rem) auto;
      grid-template-areas: 'portrait id control actions';
    }
  }

  .minute-row[data-starter='true'] {
    border-left: 3px solid color-mix(in srgb, var(--color-primary) 70%, var(--color-line-soft));
  }

  .minute-row[data-locked='true'] {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-line-soft));
  }

  .minute-portrait {
    display: flex;
    align-items: center;
    justify-content: center;
    grid-area: portrait;
  }

  .minute-id {
    display: grid;
    min-width: 0;
    gap: 0.15rem;
    grid-area: id;
  }

  .minute-name {
    overflow: hidden;
    font-size: 0.8125rem;
    font-weight: 700;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .minute-load {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.1rem;
    min-width: 0;
  }

  .minute-load-label {
    flex: none;
    color: var(--color-muted-foreground);
    font-size: 0.625rem;
  }

  .minute-load-track {
    display: block;
    height: 0.3rem;
    min-width: 1.5rem;
    flex: 0 1 3rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-surface-3);
  }

  .minute-load-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-muted-foreground);
    transition: width 140ms ease;
  }

  .minute-load-track[data-tone='accent'] .minute-load-fill {
    background: var(--color-accent);
  }

  .minute-load-track[data-tone='negative'] .minute-load-fill {
    background: var(--color-negative);
  }

  .minute-load-value {
    flex: none;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
  }

  .minute-load-value[data-tone='negative'] {
    color: var(--color-negative);
  }

  .minute-load-value[data-tone='accent'] {
    color: var(--color-accent);
  }

  .minute-load-value[data-tone='muted'] {
    color: var(--color-muted-foreground);
  }

  .minute-control {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
    grid-area: control;
  }

  .minute-readout {
    margin: 0;
    grid-area: control;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .minute-readout span {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .minute-stepper {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.2rem;
  }

  @media (min-width: 640px) {
    .minute-stepper {
      justify-content: center;
    }
  }

  .minute-step {
    display: grid;
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.4rem;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    cursor: pointer;
  }

  .minute-step:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-foreground);
  }

  .minute-step:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .minute-value {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
    padding: 0 0.2rem;
  }

  .minute-input {
    width: 2.1rem;
    min-height: 1.7rem;
    padding: 0 0.1rem;
    border: 0;
    border-bottom: 1px solid var(--color-line-soft);
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .minute-input:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 1px;
  }

  .minute-unit {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .minute-slider {
    width: 100%;
    min-width: 0;
    margin: 0;
    cursor: pointer;
  }

  .minute-slider:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .minute-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
    grid-area: actions;
  }

  .minute-actions :global(.ui-btn) {
    min-height: 1.8rem;
    padding-block: 0.25rem;
    padding-inline: 0.5rem;
  }

  .minute-preset {
    min-height: var(--ui-control-height-sm);
    max-width: 4.75rem;
    padding: 0 0.25rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.4rem;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    cursor: pointer;
  }

  .minute-preset:hover:not(:disabled) {
    border-color: var(--color-primary);
    color: var(--color-foreground);
  }

  .minute-preset:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .minute-lock {
    display: grid;
    width: 1.8rem;
    height: 1.8rem;
    place-items: center;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.4rem;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    cursor: pointer;
  }

  .minute-lock[data-locked='true'] {
    border-color: color-mix(in srgb, var(--color-accent) 60%, transparent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-2));
    color: var(--color-accent);
  }

  .minute-lock:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (max-width: 639px) {
    .minute-actions {
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .minute-stepper {
      justify-content: flex-start;
    }

    .minute-preset {
      max-width: 5.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .minute-meter-fill,
    .minute-load-fill {
      transition: none;
    }
  }
</style>
