<script lang="ts">import type { FixedFiveRoomSnapshot } from '@hoop-rush/data-contracts';
let { snapshot, selfId = 'p1' }: {
    snapshot: FixedFiveRoomSnapshot;
    selfId?: 'p1' | 'p2';
} = $props();
function laneLabel(id: 'p1' | 'p2'): string {
    if (id === selfId)
        return id === 'p1' ? 'You · P1' : 'You · P2';
    return id === 'p1' ? 'Opponent · P1' : 'Opponent · P2';
}
</script>

<div class="grid gap-2 sm:grid-cols-2" role="status" aria-label="Room scoreboard">
  {#each snapshot.members as member (member.participantId)}
    <div
      class="rounded-xl border p-3 {member.participantId === selfId
        ? 'border-primary/50 bg-primary/5'
        : 'border-line-soft bg-card'}"
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
          class="h-full rounded-full bg-primary transition-all"
          style={`width: ${(member.picksCommitted / 5) * 100}%`}
        ></div>
      </div>
    </div>
  {/each}
</div>
