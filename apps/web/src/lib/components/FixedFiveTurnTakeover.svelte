<script lang="ts">
  import { arenaRivalTurn, arenaYourTurn } from '$lib/arena-sound';
  let {
    turn,
    label = '',
    ordinal = 0,
    total = 10,
    mode = 'duel',
  }: {
    turn: 'you' | 'rival' | null;
    label?: string;
    ordinal?: number;
    total?: number;
    mode?: string;
  } = $props();

  let lastTurn = $state<string | null>(null);

  $effect(() => {
    if (turn && turn !== lastTurn) {
      lastTurn = turn;
      if (turn === 'you') arenaYourTurn();
      else arenaRivalTurn();
    }
    if (!turn) lastTurn = null;
  });
</script>

{#if turn}
  <div class={['turn-status', { yours: turn === 'you' }]} role="status" aria-live="polite">
    <div>
      <p class="turn-label">
        {mode === 'duel'
          ? 'Duel draft'
          : mode === 'sandbox-shared-82'
            ? 'Sandbox draft'
            : 'Shared draft'} · Pick {Math.min(ordinal + 1, total)} of {total}
      </p>
      <h3>{turn === 'you' ? 'You’re on the clock' : 'Opponent is picking'}</h3>
      <p class="turn-description">{label}</p>
    </div>
    <div class="turn-rail" aria-hidden="true">
      {#each Array.from({ length: total }, (_, i) => i) as i (i)}<span
          class:done={i < ordinal}
          class:current={i === ordinal}
        ></span>{/each}
    </div>
  </div>
{/if}

<style>
  .turn-status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
    padding: 18px 20px;
    border: 1px solid var(--color-line-soft);
    border-left: 3px solid var(--color-line-strong);
    border-radius: 9px;
    background: var(--color-card);
  }
  .turn-status.yours {
    border-left-color: var(--color-primary);
  }
  .turn-label {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h3 {
    font-family: var(--font-display);
    font-size: 27px;
    font-weight: 800;
    line-height: 1.1;
    margin: 5px 0;
  }
  .turn-description {
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .turn-rail {
    display: flex;
    gap: 5px;
    width: 150px;
    flex-shrink: 0;
  }
  .turn-rail > span {
    height: 6px;
    flex: 1;
    background: var(--color-surface-3);
    border-radius: 2px;
  }
  .turn-rail .done {
    background: var(--color-primary);
  }
  .turn-rail .current {
    background: var(--color-accent);
  }
  @media (max-width: 640px) {
    .turn-status {
      flex-direction: column;
      align-items: stretch;
      gap: 14px;
      padding: 16px;
    }
    .turn-rail {
      width: 100%;
    }
  }
</style>
