<script lang="ts">
  import { formatPositions, SLOT_LABELS, SLOT_NAMES } from '#lib/player-positions.js';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtTeamMinutesRow } from './full-court-coaching-presenter.ts';

  let {
    starters,
    bench = [],
    focusedSlot = null,
    onFocusSlot = null,
    readOnly = false,
    art = null,
  }: {
    starters: readonly FullCourtTeamMinutesRow[];
    bench?: readonly FullCourtTeamMinutesRow[];
    focusedSlot?: number | null;
    onFocusSlot?: ((slot: number) => void) | null;
    readOnly?: boolean;
    art?: FullCourtArt | null;
  } = $props();

  const SLOT_POSITIONS = [
    { left: 50, top: 76 },
    { left: 21, top: 55 },
    { left: 79, top: 55 },
    { left: 33, top: 29 },
    { left: 67, top: 29 },
  ] as const;

  const bySlot = $derived(new Map(starters.map((row) => [row.starterSlot ?? -1, row])));
  const focusHandler = $derived(readOnly ? null : onFocusSlot);
  const benchMinutes = $derived(bench.reduce((total, row) => total + row.minutes, 0));

  function describe(row: FullCourtTeamMinutesRow | undefined, slot: number): string {
    const name = SLOT_NAMES[slot] ?? `Slot ${String(slot + 1)}`;
    if (row === undefined) return `${name} empty`;
    const health = row.health === null ? '' : `, ${row.health.label}`;
    return `${name}: ${row.player.displayName}, ${String(row.minutes)} minutes${health}`;
  }
</script>

<div class="court-shell">
  <div class="court" role="group" aria-label="Starting five on the court">
    <span class="court-arc" aria-hidden="true"></span>
    <span class="court-rim" aria-hidden="true"></span>
    <span class="court-key" aria-hidden="true"></span>

    {#each SLOT_POSITIONS as position, slot (slot)}
      {@const row = bySlot.get(slot)}
      {@const label = SLOT_LABELS[slot] ?? ''}
      <div
        class="slot"
        data-focused={focusedSlot === slot ? 'true' : undefined}
        style:left={`${position.left}%`}
        style:top={`${position.top}%`}
      >
        {#if row !== undefined}
          {@const tone = row.health?.tone ?? 'available'}
          {@const focus = focusHandler}
          {@const jersey = focus === null ? null : `Change ${SLOT_NAMES[slot] ?? label}`}
          {#if focus === null}
            <span class="portrait" data-tone={tone} aria-hidden="true">
              <FullCourtPortrait player={row.player} {art} size="court" />
            </span>
          {:else}
            <button
              type="button"
              class="portrait portrait-button outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-tone={tone}
              aria-label={`${jersey ?? label} · ${describe(row, slot)}`}
              aria-pressed={focusedSlot === slot}
              onclick={() => focus(slot)}
            >
              <FullCourtPortrait player={row.player} {art} size="court" />
            </button>
          {/if}
          <span class="slot-badge">{label}</span>
          <span class="slot-name" title={row.player.displayName}>{row.player.displayName}</span>
          <span class="slot-meta">
            {row.minutes}
            <span class="slot-unit">MIN</span>
            {#if row.closer}<span class="slot-closer">CLOSE</span>{/if}
          </span>
        {:else}
          <span class="portrait" data-tone="empty" aria-hidden="true">+</span>
          <span class="slot-badge">{label}</span>
          <span class="slot-name">Open {label}</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if bench.length > 0}
    <section class="bench-rail" aria-label="Bench rotation">
      <div class="bench-head">
        <p class="bench-label">Bench</p>
        <p class="bench-total">
          {bench.length}
          {bench.length === 1 ? 'player' : 'players'} · {benchMinutes}
          <span class="bench-unit">min</span>
        </p>
      </div>
      <ul class="bench-list">
        {#each bench as row (row.player.playerId)}
          {@const tone = row.health?.tone ?? 'available'}
          <li class="bench-card" data-tone={tone}>
            <FullCourtPortrait player={row.player} {art} size="sm" />
            <span class="bench-copy">
              <span class="bench-name" title={row.player.displayName}>{row.player.displayName}</span
              >
              <span class="bench-meta">
                {row.minutes}
                <span class="bench-unit">MIN</span>
                {#if row.health !== null}<span class="bench-health">· {row.health.label}</span>{/if}
              </span>
            </span>
            {#if row.closer}<span class="bench-closer">CLOSE</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <ul class="sr-only">
    {#each starters as row (row.player.playerId)}
      <li>
        {SLOT_NAMES[row.starterSlot ?? 0]}: {row.player.displayName}, {formatPositions(
          row.player.positions,
        )}, {row.minutes} minutes
      </li>
    {/each}
  </ul>
</div>

<style>
  .court-shell {
    min-width: 0;
  }
  .court {
    position: relative;
    min-height: 300px;
    overflow: hidden;
    border-radius: 0.75rem;
    background: var(--color-court-wood);
    background-image: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.07) 0 2px,
      transparent 2px 64px
    );
    box-shadow: inset 0 0 70px rgba(78, 39, 6, 0.28);
  }
  .court::before {
    content: '';
    position: absolute;
    left: 9%;
    right: 9%;
    top: -2px;
    height: 62%;
    border: 2px solid rgba(255, 255, 255, 0.66);
    border-top: 0;
  }
  .court-arc {
    position: absolute;
    left: 19%;
    top: -38%;
    width: 62%;
    height: 84%;
    border: 2px solid rgba(255, 255, 255, 0.66);
    border-radius: 50%;
  }
  .court-key {
    position: absolute;
    left: 50%;
    top: 0;
    width: 34%;
    height: 46%;
    transform: translateX(-50%);
    border: 2px solid rgba(255, 255, 255, 0.52);
    border-top: 0;
    border-radius: 0 0 60px 60px;
  }
  .court-rim {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 70px;
    width: 50px;
    height: 10px;
    transform: translateX(-50%);
    border: 3px solid var(--color-court-rim);
    border-radius: 50%;
  }
  .slot {
    position: absolute;
    z-index: 3;
    width: 84px;
    transform: translate(-50%, -50%);
    text-align: center;
  }
  .portrait {
    box-sizing: content-box;
    display: grid;
    width: 3rem;
    height: 3rem;
    margin: 0 auto;
    place-items: center;
    overflow: hidden;
    border: 3px solid rgba(255, 255, 255, 0.92);
    border-radius: 999px;
    background: #20242c;
    color: #f3f5f8;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    box-shadow: 0 6px 16px rgba(35, 19, 5, 0.3);
  }
  .portrait :global(> div) {
    border-radius: 999px;
  }
  .portrait-button {
    padding: 0;
    cursor: pointer;
    transition:
      transform 140ms ease,
      border-color 140ms ease;
  }
  .portrait-button:hover {
    transform: scale(1.05);
  }
  .portrait[data-tone='empty'] {
    border-style: dashed;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    font-size: 1.3rem;
    box-shadow: none;
  }
  .portrait[data-tone='unavailable'] {
    border-color: var(--color-negative);
  }
  .portrait[data-tone='fatigued'] {
    border-color: var(--color-accent);
  }
  .slot[data-focused='true'] .portrait {
    box-shadow:
      0 0 0 3px rgba(255, 255, 255, 0.55),
      0 8px 18px rgba(35, 19, 5, 0.35);
  }
  .slot-badge {
    position: absolute;
    top: 2.75rem;
    left: 0;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1.4;
  }
  .slot-name {
    display: block;
    margin-top: 0.55rem;
    overflow: hidden;
    color: #241406;
    font-family: var(--font-display);
    font-size: 0.65rem;
    font-weight: 800;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slot-meta {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.15rem;
    color: #3c2409;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    line-height: 1.3;
  }
  .slot-unit {
    font-size: 0.5rem;
    letter-spacing: 0.08em;
  }
  .slot-closer {
    margin-left: 0.15rem;
    padding: 0 0.15rem;
    border-radius: 0.2rem;
    background: rgba(36, 20, 6, 0.24);
    color: #241406;
    font-size: 0.45rem;
    letter-spacing: 0.06em;
  }
  .bench-rail {
    margin-top: 0.75rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }
  .bench-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .bench-label,
  .bench-total {
    margin: 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .bench-total {
    font-weight: 700;
    letter-spacing: 0.08em;
  }
  .bench-unit {
    font-size: 0.9em;
    letter-spacing: 0.06em;
  }
  .bench-list {
    display: flex;
    gap: 0.5rem;
    margin: 0.5rem 0 0;
    padding: 0 0 0.1rem;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .bench-card {
    display: flex;
    flex: 0 0 auto;
    min-width: 10.5rem;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.55rem;
    background: var(--color-surface-2);
  }
  .bench-card[data-tone='unavailable'] {
    border-color: color-mix(in oklab, var(--color-negative) 55%, var(--color-line-soft));
  }
  .bench-card[data-tone='fatigued'] {
    border-color: color-mix(in oklab, var(--color-accent) 55%, var(--color-line-soft));
  }
  .bench-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.1rem;
  }
  .bench-name {
    max-width: 8rem;
    overflow: hidden;
    color: var(--color-foreground);
    font-family: var(--font-display);
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bench-meta {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .bench-health {
    color: inherit;
  }
  .bench-closer {
    margin-left: auto;
    padding: 0 0.2rem;
    border-radius: 0.2rem;
    background: color-mix(in oklab, var(--color-accent) 16%, transparent);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 0.45rem;
    font-weight: 800;
    letter-spacing: 0.06em;
  }
  @media (min-width: 640px) {
    .court {
      min-height: 380px;
    }
    .slot {
      width: 104px;
    }
    .portrait {
      width: 3.5rem;
      height: 3.5rem;
      font-size: 1.05rem;
    }
    .slot-badge {
      top: 3.3rem;
    }
    .slot-name {
      font-size: 0.75rem;
    }
    .bench-list {
      flex-wrap: wrap;
      overflow-x: visible;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .portrait-button {
      transition: none;
    }
    .portrait-button:hover {
      transform: none;
    }
  }
</style>
