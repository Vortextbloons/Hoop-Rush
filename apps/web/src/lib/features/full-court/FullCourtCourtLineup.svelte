<script lang="ts">
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import { SLOT_NAMES } from '#lib/player-positions.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtTeamMinutesRow } from './full-court-coaching-presenter.ts';
  import FullCourtPlayerPicker from './FullCourtPlayerPicker.svelte';
  import TeamCourtPreview from './TeamCourtPreview.svelte';

  let {
    starters,
    bench,
    roster,
    art = null,
    locked = false,
    onSelectStarter,
  }: {
    starters: readonly FullCourtTeamMinutesRow[];
    bench: readonly FullCourtTeamMinutesRow[];
    roster: readonly SimulationPlayer[];
    art?: FullCourtArt | null;
    locked?: boolean;
    onSelectStarter: (slot: number, playerId: string) => void;
  } = $props();

  let activeSlot = $state<number | null>(null);
  const activeStarter = $derived(
    activeSlot === null
      ? null
      : (starters.find((row) => row.starterSlot === activeSlot)?.player ?? null),
  );

  function focusSlot(slot: number): void {
    if (locked) return;
    activeSlot = slot;
  }
</script>

<div class="court-editor">
  <TeamCourtPreview
    {starters}
    {bench}
    {art}
    focusedSlot={activeSlot}
    onFocusSlot={locked ? null : focusSlot}
    readOnly={locked}
  />
  {#if !locked}
    <p class="court-hint">
      {#if activeSlot === null}
        Tap a player on the court to swap him into the starting five.
      {:else}
        Choosing a new <strong>{SLOT_NAMES[activeSlot] ?? `Starter ${activeSlot + 1}`}</strong>.
      {/if}
    </p>
  {/if}
</div>

{#if activeSlot !== null && !locked}
  <FullCourtPlayerPicker
    players={roster}
    {art}
    {locked}
    label={`Change Starter ${activeSlot + 1}`}
    selectedId={activeStarter?.playerId ?? null}
    onSelect={(playerId) => {
      if (activeSlot === null) return;
      onSelectStarter(activeSlot, playerId);
      activeSlot = null;
    }}
    onClose={() => (activeSlot = null)}
  />
{/if}

<style>
  .court-editor {
    min-width: 0;
  }

  .court-hint {
    margin: 0.5rem 0 0;
    color: var(--color-muted-foreground);
    font-size: 0.6875rem;
    line-height: 1.5;
  }

  .court-hint strong {
    color: var(--color-foreground);
    font-weight: 700;
  }
</style>
