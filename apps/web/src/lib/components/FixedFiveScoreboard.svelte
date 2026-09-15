<script lang="ts">
  import type { FixedFiveRoomSnapshot } from '@hoop-rush/data-contracts';
  let {
    snapshot,
    selfId = 'p1',
  }: {
    snapshot: FixedFiveRoomSnapshot;
    selfId?: 'p1' | 'p2';
  } = $props();
  function laneLabel(id: 'p1' | 'p2'): string {
    if (id === selfId) return id === 'p1' ? 'You · P1' : 'You · P2';
    return id === 'p1' ? 'Opponent · P1' : 'Opponent · P2';
  }
  const leader = $derived.by(() => {
    const [a, b] = snapshot.members;
    if (!a || !b) return null;
    if (a.picksCommitted === b.picksCommitted) return null;
    return a.picksCommitted > b.picksCommitted ? a.participantId : b.participantId;
  });
</script>

<div class="board-head">
  <span class="board-live"><span class="board-dot" aria-hidden="true"></span>Draft race</span>
  {#if leader}
    <span class="board-lead">{leader === selfId ? 'You lead' : 'Opp leads'}</span>
  {:else}
    <span class="board-lead board-lead--tied">Tied</span>
  {/if}
</div>
<div class="grid gap-2 sm:grid-cols-2" role="status" aria-label="Room scoreboard">
  {#each snapshot.members as member (member.participantId)}
    <div
      class="race-card rounded-xl border p-3 {member.participantId === selfId
        ? 'border-primary/50 bg-primary/5'
        : 'border-line-soft bg-card'}"
      data-leader={leader === member.participantId ? 'true' : 'false'}
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-bold tracking-widest uppercase">{laneLabel(member.participantId)}</p>
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold {member.online
            ? 'bg-positive/15 text-positive'
            : 'bg-muted text-muted-foreground'}"
        >
          <span aria-hidden="true" class="inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
          {member.online ? 'Online' : 'Offline'}
        </span>
      </div>
      <div class="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{member.picksCommitted}/5 picks</span>
        <span>{member.locked ? 'Locked' : member.ready ? 'Ready' : 'Waiting'}</span>
        {#if snapshot.deadline && snapshot.phase === 'drafting'}
          <span class="ml-auto font-mono">clock running</span>
        {/if}
      </div>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          class="race-fill h-full rounded-full bg-primary transition-all"
          style={`width: ${(member.picksCommitted / 5) * 100}%`}
        ></div>
      </div>
    </div>
  {/each}
</div>

<style>
  .board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .board-live {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-primary);
  }
  .board-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: currentColor;
    animation: board-pulse 1.1s ease-in-out infinite;
  }
  .board-lead {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-accent);
  }
  .board-lead--tied {
    color: var(--color-muted-foreground);
  }
  .race-card {
    transition:
      border-color 0.3s ease,
      box-shadow 0.3s ease,
      transform 0.3s ease;
  }
  .race-card[data-leader='true'] {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 40%, transparent);
    animation: leader-thump 0.4s ease both;
  }
  .race-fill {
    transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes board-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.8);
    }
  }
  @keyframes leader-thump {
    from {
      transform: scale(1.02);
    }
    to {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .board-dot,
    .race-card[data-leader='true'] {
      animation: none;
    }
  }
</style>
