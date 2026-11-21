<script lang="ts">
  import { initialsOf } from '#lib/branding.js';
  import { formatPositions, SLOT_LABELS, SLOT_NAMES } from '#lib/player-positions.js';
  import type { FullCourtTeamMinutesRow } from './full-court-coaching-presenter.ts';

  let {
    starters,
    focusedSlot = null,
    onFocusSlot = null,
    readOnly = false,
  }: {
    starters: readonly FullCourtTeamMinutesRow[];
    focusedSlot?: number | null;
    onFocusSlot?: ((slot: number) => void) | null;
    readOnly?: boolean;
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
            <span class="jersey" data-tone={tone} aria-hidden="true">
              {initialsOf(row.player.displayName)}
            </span>
          {:else}
            <button
              type="button"
              class="jersey outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-tone={tone}
              aria-label={`${jersey ?? label} · ${describe(row, slot)}`}
              aria-pressed={focusedSlot === slot}
              onclick={() => focus(slot)}
            >
              {initialsOf(row.player.displayName)}
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
          <span class="jersey" data-tone="empty" aria-hidden="true">+</span>
          <span class="slot-badge">{label}</span>
          <span class="slot-name">Open {label}</span>
        {/if}
      </div>
    {/each}
  </div>

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
  .jersey {
    display: grid;
    width: 3.25rem;
    height: 3.25rem;
    margin: 0 auto;
    place-items: center;
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
  button.jersey {
    cursor: pointer;
    transition:
      transform 140ms ease,
      border-color 140ms ease;
  }
  button.jersey:hover {
    transform: scale(1.05);
  }
  .jersey[data-tone='empty'] {
    border-style: dashed;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    font-size: 1.3rem;
    box-shadow: none;
  }
  .jersey[data-tone='unavailable'] {
    border-color: var(--color-negative);
  }
  .jersey[data-tone='fatigued'] {
    border-color: var(--color-accent);
  }
  .slot[data-focused='true'] .jersey {
    box-shadow:
      0 0 0 3px rgba(255, 255, 255, 0.55),
      0 8px 18px rgba(35, 19, 5, 0.35);
  }
  .slot-badge {
    position: absolute;
    top: 2.6rem;
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
  @media (min-width: 640px) {
    .court {
      min-height: 380px;
    }
    .slot {
      width: 104px;
    }
    .jersey {
      width: 3.75rem;
      height: 3.75rem;
      font-size: 1.05rem;
    }
    .slot-badge {
      top: 3.1rem;
    }
    .slot-name {
      font-size: 0.75rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    button.jersey {
      transition: none;
    }
    button.jersey:hover {
      transform: none;
    }
  }
</style>
