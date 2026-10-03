<script lang="ts">
  import { Dialog } from 'bits-ui';
  import LiveSimModal from '$lib/components/season/LiveSimModal.svelte';
  import type { CollectionGameRecordUnion } from '@hoop-rush/data-contracts';
  import GamecastCourt from './GamecastCourt.svelte';
  import { clockLabel, quickCastEvents, QUICK_CAST_BEAT_MS } from './collection-gamecast';

  let {
    record,
    nameOf,
    onComplete,
  }: {
    record: CollectionGameRecordUnion | null;
    nameOf: (cardId: string) => string;
    onComplete: () => void;
  } = $props();
  let cursor = $state(0);
  let heading: HTMLElement | undefined;
  const events = $derived(record ? quickCastEvents(record.events) : []);
  const event = $derived(events[cursor] ?? null);
  const final = $derived(event?.kind === 'final');

  $effect(() => {
    if (!record) return;
    const index = cursor;
    const count = events.length;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(
      () => {
        if (reduced || index >= count - 1) onComplete();
        else cursor = index + 1;
      },
      reduced ? 150 : QUICK_CAST_BEAT_MS,
    );
    return () => clearTimeout(timer);
  });
</script>

<LiveSimModal
  open={true}
  fitContent
  onOpenChange={() => undefined}
  onOpenAutoFocus={(event) => {
    event.preventDefault();
    heading?.focus({ preventScroll: true });
  }}
>
  <div class="quick-cast">
    <header bind:this={heading} tabindex="-1">
      <div>
        <p class="kicker">Ultimate Run · SimCast</p>
        <Dialog.Title class="cast-title"
          >{final ? 'Final whistle' : 'Under the lights'}</Dialog.Title
        >
      </div>
      <span class="live-pill" class:final
        ><i></i>{final ? 'Final' : record ? 'Highlights' : 'Tip-off'}</span
      >
    </header>
    <Dialog.Description class="cast-description">
      {record ? 'Highlights from your recorded game.' : 'Your matchup is taking the court…'}
    </Dialog.Description>
    <div class="scoreboard" aria-label="Game score">
      <div>
        <span>Your team</span>{#key event?.homeScore}<strong>{event?.homeScore ?? '—'}</strong
          >{/key}
      </div>
      <p>
        {event
          ? final
            ? 'FINAL'
            : `${event.period > 4 ? `OT${event.period - 4}` : `Q${event.period}`} · ${clockLabel(event.secondsRemaining)}`
          : 'TIP-OFF'}
      </p>
      <div>
        <span>CPU</span>{#key event?.awayScore}<strong>{event?.awayScore ?? '—'}</strong>{/key}
      </div>
    </div>
    <GamecastCourt {event} {nameOf} playing={!final} duration={QUICK_CAST_BEAT_MS} />
    <div class="cast-progress" aria-hidden="true">
      {#each [0, 1, 2, 3, 4] as beat (beat)}<span class:lit={record !== null && beat <= cursor}
        ></span>{/each}
    </div>
    <footer>
      <span
        >{final
          ? 'Opening your recap…'
          : record
            ? 'A quick look at the action'
            : 'Preparing the gamecast…'}</span
      >
      <button type="button" disabled={!record} onclick={onComplete}>Skip to recap →</button>
    </footer>
  </div>
</LiveSimModal>

<style>
  .quick-cast {
    padding: 1.25rem;
    color: #f5f1e4;
    background: radial-gradient(ellipse at 50% 0, #48311780, transparent 65%), #10171c;
    --ur-line: #ffffff1a;
    --ur-muted: #a5afb4;
    --ur-paper: #f5f1e4;
    --ur-apex: #ffc53d;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .kicker {
    color: #ffc53d;
    font: 800 0.6rem var(--font-mono);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .quick-cast :global(.cast-title) {
    font: 900 1.65rem var(--font-display);
    text-transform: uppercase;
  }
  .quick-cast :global(.cast-description) {
    margin-top: 0.35rem;
    color: #a5afb4;
    font-size: 0.75rem;
  }
  .live-pill {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: 1px solid #ffc53d55;
    border-radius: 99px;
    padding: 0.4rem 0.65rem;
    color: #ffc53d;
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .live-pill i {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1s infinite;
  }
  .live-pill.final i {
    animation: none;
  }
  .scoreboard {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 1rem;
    padding: 0.8rem;
    border: 1px solid #ffffff1a;
    border-radius: 0.7rem;
    background: #080f14;
    text-align: center;
  }
  .scoreboard div {
    display: grid;
  }
  .scoreboard span {
    color: #a5afb4;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .scoreboard strong {
    font: 900 3rem var(--font-display);
    font-variant-numeric: tabular-nums;
    animation: score-in 0.24s ease-out;
  }
  .scoreboard p {
    color: #ffc53d;
    font: 700 0.65rem var(--font-mono);
  }
  .quick-cast :global(.simcast) {
    margin: 0.8rem 0;
  }
  .quick-cast :global(svg) {
    max-height: 150px;
  }
  .quick-cast :global(.play-call) {
    padding: 0.65rem 0.9rem;
  }
  .quick-cast :global(.court-heading) {
    padding: 0.55rem 0.9rem;
  }
  .cast-progress {
    display: flex;
    gap: 0.3rem;
    margin-bottom: 0.8rem;
  }
  .cast-progress span {
    flex: 1;
    height: 3px;
    background: #ffffff1a;
    transition: background 0.2s;
  }
  .cast-progress .lit {
    background: #ffc53d;
  }
  footer {
    color: #a5afb4;
    font-size: 0.65rem;
  }
  button {
    min-height: 44px;
    color: #ffc53d;
    font-weight: 800;
  }
  button:disabled {
    opacity: 0.4;
  }
  button:focus-visible {
    outline: 2px solid #ffc53d;
    outline-offset: 3px;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @keyframes score-in {
    from {
      opacity: 0.4;
      transform: translateY(5px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-pill i,
    .scoreboard strong {
      animation: none;
    }
    .cast-progress span {
      transition: none;
    }
  }
  @media (max-width: 640px) {
    .quick-cast {
      padding: 0.85rem;
    }
    footer {
      gap: 0.4rem;
    }
    .quick-cast :global(svg) {
      max-height: 100px;
    }
  }
</style>
