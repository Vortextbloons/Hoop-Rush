<script lang="ts">
  import { UserRound, Check, Users } from '@lucide/svelte';
  import type { FixedFiveRoomSnapshot, PublicProfile } from '@hoop-rush/data-contracts';
  let {
    snapshot,
    selfId = 'p1',
    profiles = [],
  }: {
    snapshot: FixedFiveRoomSnapshot;
    selfId?: 'p1' | 'p2';
    profiles?: PublicProfile[];
  } = $props();
  const seats = $derived([selfId, selfId === 'p1' ? 'p2' : 'p1'] as const);
  const drafting = $derived(snapshot.phase === 'drafting');
</script>

<div class="player-seats" aria-label="Players in this room">
  {#each seats as id (id)}
    {@const member = snapshot.members.find((item) => item.participantId === id)}
    {@const profile = profiles.find((item) => item.participantId === id)}
    <div class={['player-seat', { yours: id === selfId, empty: !member }]}>
      <div class="seat-top">
        <span class="player-avatar"
          >{#if profile}{profile.avatar === 'ball'
              ? '🏀'
              : profile.avatar === 'crown'
                ? '👑'
                : profile.name.slice(0, 2).toUpperCase()}{:else if member}<UserRound
              size={21}
              aria-hidden="true"
            />{:else}<Users size={21} aria-hidden="true" />{/if}</span
        >
        <div class="player-name">
          <strong
            class:profile-blue={profile?.nameColor === 'blue'}
            class:profile-orange={profile?.nameColor === 'orange'}
            >{profile?.name ?? (id === selfId ? 'You' : member ? 'Opponent' : 'Open seat')}</strong
          ><small
            >{id === 'p1' ? 'Room host' : member ? 'Challenger' : 'Waiting for a challenger'}</small
          >
        </div>
        {#if member}<span class={['presence', { online: member.online }]}
            ><span aria-hidden="true"></span>{member.online ? 'Online' : 'Offline'}</span
          >{/if}
      </div>
      {#if member && snapshot.phase !== 'lobby'}
        <div class="seat-progress">
          <span
            >{member.locked || member.picksCommitted === 5
              ? 'Five is set'
              : drafting
                ? 'Building lineup'
                : 'Lineup'}<strong>{member.picksCommitted}/5</strong></span
          >
          <div class="pick-pips" aria-label={`${member.picksCommitted} of 5 picks made`}>
            {#each [0, 1, 2, 3, 4] as pick (pick)}<span class:filled={pick < member.picksCommitted}
                >{#if pick < member.picksCommitted}<Check size={11} aria-hidden="true" />{/if}</span
              >{/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .profile-blue {
    color: #60a5fa;
  }
  .profile-orange {
    color: #fb923c;
  }
  .player-seats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .player-seat {
    min-width: 0;
    border: 1px solid var(--color-line-soft);
    border-radius: 10px;
    background: var(--color-card);
    padding: 18px;
  }
  .yours {
    border-left: 3px solid var(--color-primary);
  }
  .empty {
    border-style: dashed;
    background: var(--color-surface-1);
  }
  .seat-top {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .player-avatar {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    border-radius: 9px;
    color: var(--color-muted-foreground);
    background: var(--color-surface-2);
  }
  .yours .player-avatar {
    color: var(--color-primary);
  }
  .player-name {
    min-width: 0;
    flex: 1;
  }
  .player-name strong {
    display: block;
    font-family: var(--font-display);
    font-size: 23px;
    line-height: 1.1;
    font-weight: 700;
  }
  .player-name small {
    display: block;
    font-size: 10px;
    color: var(--color-muted-foreground);
    margin-top: 5px;
  }
  .presence {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    color: var(--color-muted-foreground);
    font-size: 10px;
  }
  .presence > span {
    width: 5px;
    height: 5px;
    background: currentColor;
    border-radius: 50%;
  }
  .presence.online {
    color: var(--color-positive);
  }
  .seat-progress {
    border-top: 1px solid var(--color-line-soft);
    margin-top: 16px;
    padding-top: 12px;
  }
  .seat-progress > span {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .seat-progress strong {
    color: var(--color-foreground);
    font-family: var(--font-mono);
  }
  .pick-pips {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 5px;
    margin-top: 9px;
  }
  .pick-pips > span {
    display: grid;
    place-items: center;
    height: 15px;
    border-radius: 3px;
    background: var(--color-surface-3);
  }
  .pick-pips > span.filled {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }
  @media (max-width: 640px) {
    .player-seats {
      grid-template-columns: 1fr;
    }
    .player-seat {
      padding: 14px;
    }
  }
</style>
