<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { ArrowRight, Users } from '@lucide/svelte';
  import type { MultiplayerLobby } from '@hoop-rush/data-contracts';
  import {
    getLobby,
    loadLobbyId,
    rememberLobby,
    resumeMultiplayerGame,
  } from '#lib/features/multiplayer/multiplayer-lobby.js';

  let { roomId, completed = false }: { roomId: string; completed?: boolean } = $props();
  let lobbyId = $state<string | null>(null);
  let lobby = $state<MultiplayerLobby | null>(null);
  let error = $state<string | null>(null);
  onMount(() => {
    let mounted = true;
    let refreshing = false;
    lobbyId = loadLobbyId(roomId);
    function refresh() {
      if (!lobbyId || refreshing) return;
      refreshing = true;
      void getLobby(lobbyId)
        .then(async (next) => {
          if (!mounted) return;
          lobby = next;
          rememberLobby(next);
          error = null;
          if (!next.canStart && next.gameKind && next.gameRoomId && next.gameRoomId !== roomId) {
            await resumeMultiplayerGame(next.gameKind, next.gameRoomId);
            if (!mounted) return;
            await goto(
              next.gameKind === 'draft-duel'
                ? resolve('/draft-duel/room/[roomId]', { roomId: next.gameRoomId })
                : resolve('/multiplayer/room/[roomId]', { roomId: next.gameRoomId }),
            );
          }
        })
        .catch(() => {
          if (mounted) error = 'Lobby connection interrupted. Reconnecting…';
        })
        .finally(() => {
          refreshing = false;
        });
    }
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
</script>

{#if lobbyId}
  {#if completed}
    <section class="next-match" aria-label="Play together again">
      <div class="room-mark"><Users size={24} aria-hidden="true" /></div>
      <div class="next-copy">
        <p class="eyebrow">Same room · Next game</p>
        <h2>Keep the matchup going.</h2>
        <p>Return to your lobby to pick another mode. Your opponent stays with you.</p>
        {#if lobby}<div class="room-facts">
            <span>ROOM <strong>{lobby.code}</strong></span><span
              >{lobby.guestJoined ? '2 players in room' : 'Waiting for your opponent'}</span
            >
          </div>{/if}
      </div>
      <a class="next-action" href={resolve(`multiplayer/?lobby=${lobbyId}`)}>
        {lobby?.participantId === 'p2' ? 'Return to lobby' : 'Choose next game'}
        <ArrowRight size={18} aria-hidden="true" />
      </a>

      {#if error}
        <p class="connection" role="status">{error}</p>
      {/if}
    </section>
  {:else}
    <a
      class="room-control"
      href={resolve(`multiplayer/?lobby=${lobbyId}`)}
      aria-label="Back to room lobby"
    >
      <Users size={17} aria-hidden="true" />
      <span
        >Room lobby{#if lobby}<small>{lobby.code}</small>{/if}</span
      >
      <ArrowRight size={15} aria-hidden="true" />
    </a>
    {#if error}<p class="connection" role="status">{error}</p>{/if}
  {/if}
{/if}

<style>
  .room-control {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface-1);
    color: var(--color-foreground);
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  .room-control small {
    display: block;
    color: var(--color-muted-foreground);
    font: 11px var(--font-mono);
    letter-spacing: 0.14em;
  }
  .room-control:hover {
    border-color: var(--color-primary);
  }
  .next-match {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px;
    margin-block: 24px;
    border: 1px solid var(--color-primary);
    border-radius: 16px;
    background: var(--color-surface-1);
    box-shadow: inset 4px 0 var(--color-primary);
  }
  .room-mark {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
  .next-copy {
    flex: 1;
  }
  .eyebrow {
    color: var(--color-primary);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h2 {
    margin-block: 5px 6px;
    font-family: var(--font-display);
    font-size: clamp(20px, 3vw, 27px);
    font-weight: 800;
  }
  .next-copy > p:not(.eyebrow),
  .connection {
    color: var(--color-muted-foreground);
    font-size: 13px;
    line-height: 1.6;
  }
  .room-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 12px;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .room-facts strong {
    margin-left: 5px;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    letter-spacing: 0.14em;
  }
  .next-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 13px 18px;
    border-radius: 10px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 13px;
    font-weight: 800;
    white-space: nowrap;
  }
  .next-action:hover {
    filter: brightness(1.08);
  }
  .connection {
    flex-basis: 100%;
  }
  a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }
  @media (max-width: 640px) {
    .next-match {
      flex-wrap: wrap;
      gap: 14px;
      padding: 20px;
    }
    .room-mark {
      display: none;
    }
    .next-copy {
      flex-basis: 100%;
    }
    .next-action {
      width: 100%;
    }
  }
</style>
