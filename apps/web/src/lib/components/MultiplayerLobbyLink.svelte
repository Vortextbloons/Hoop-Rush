<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getLobby,
    loadLobbyId,
    rememberLobby,
    resumeMultiplayerGame,
  } from '$lib/multiplayer-lobby';

  let { roomId }: { roomId: string } = $props();
  let lobbyId = $state<string | null>(null);
  let error = $state<string | null>(null);
  onMount(() => {
    let mounted = true;
    let refreshing = false;
    lobbyId = loadLobbyId(roomId);
    const timer = setInterval(() => {
      if (!lobbyId || refreshing) return;
      refreshing = true;
      void getLobby(lobbyId)
        .then(async (lobby) => {
          if (!mounted) return;
          rememberLobby(lobby);
          error = null;
          if (
            !lobby.canStart &&
            lobby.gameKind &&
            lobby.gameRoomId &&
            lobby.gameRoomId !== roomId
          ) {
            await resumeMultiplayerGame(lobby.gameKind, lobby.gameRoomId);
            if (!mounted) return;
            await goto(
              lobby.gameKind === 'draft-duel'
                ? resolve('/draft-duel/room/[roomId]', { roomId: lobby.gameRoomId })
                : resolve('/multiplayer/room/[roomId]', { roomId: lobby.gameRoomId }),
            );
          }
        })
        .catch(() => {
          if (mounted) error = 'Lobby connection interrupted. Reconnecting…';
        })
        .finally(() => {
          refreshing = false;
        });
    }, 2000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  });
</script>

{#if lobbyId}
  <div class="lobby-link">
    <a href={resolve(`/multiplayer?lobby=${lobbyId}`)}>Back to lobby</a>
    <span>Keep your room and choose the next game together.</span>
    {#if error}<span role="status">{error}</span>{/if}
  </div>
{/if}

<style>
  .lobby-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--color-border);
  }
  a {
    color: var(--color-primary);
    font-weight: 700;
    text-decoration: underline;
  }
  a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }
  span {
    color: var(--color-muted-foreground);
    font-size: 12px;
  }
</style>
