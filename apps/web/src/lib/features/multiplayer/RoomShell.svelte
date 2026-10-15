<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { Check, Copy, Link, Users } from '@lucide/svelte';
  import { getLobbyCoordinator } from './lobby-context.svelte';
  import { loadLobbyId } from './multiplayer-lobby';
  import { multiplayerInviteLink } from './invite-link';
  let {
    roomId,
    title,
    summary,
    phase,
    code = null,
    participantId = null,
    members = [],
    connection = 'connected',
    error = null,
    children,
    lobbyId: suppliedLobbyId = null,
  }: {
    roomId: string;
    title: string;
    summary: string;
    phase: string;
    code?: string | null;
    participantId?: string | null;
    members?: readonly { participantId: string; online?: boolean }[];
    connection?: string;
    error?: string | null;
    children?: Snippet;
    lobbyId?: string | null;
  } = $props();
  const coordinator = getLobbyCoordinator();
  let lobbyId = $state<string | null>(null);
  let copied = $state<'code' | 'link' | null>(null);
  let copyError = $state<string | null>(null);
  const lobby = $derived(
    coordinator.snapshot.lobby?.id === lobbyId ? coordinator.snapshot.lobby : null,
  );
  const roomCode = $derived(lobby?.code ?? code);
  onMount(() => {
    lobbyId = suppliedLobbyId ?? loadLobbyId(roomId);
    if (lobbyId) void coordinator.session.attach(lobbyId);
  });
  async function copy(kind: 'code' | 'link') {
    if (!roomCode) return;
    copyError = null;
    try {
      await navigator.clipboard.writeText(
        kind === 'code'
          ? roomCode
          : new URL(resolve(multiplayerInviteLink(roomCode)), window.location.origin).href,
      );
      copied = kind;
    } catch {
      copyError = 'Copy failed. Share the room code shown here.';
    }
  }
</script>

<header class="room-shell">
  <div class="heading">
    <div>
      <p class="eyebrow">Multiplayer · {phase}</p>
      <h1>{title}</h1>
      <p class="summary">{summary}</p>
    </div>
    {#if roomCode}
      <div class="invite">
        <span>Room code</span><strong>{roomCode}</strong>
        <div class="actions">
          <button type="button" onclick={() => copy('code')} aria-label="Copy room code"
            >{#if copied === 'code'}<Check size={15} />{:else}<Copy size={15} />{/if} Code</button
          >
          <button type="button" onclick={() => copy('link')}
            >{#if copied === 'link'}<Check size={15} />{:else}<Link size={15} />{/if} Invite</button
          >
        </div>
      </div>
    {/if}
  </div>
  <div class="room-footer">
    <div class="seats" aria-label="Room participants">
      {#each ['p1', 'p2'] as seat (seat)}
        {@const member = members.find((entry) => entry.participantId === seat)}
        <span class="seat" class:online={member?.online}
          ><Users size={14} aria-hidden="true" /><strong
            >{seat === 'p1' ? 'Host' : 'Guest'}{participantId === seat ? ' · You' : ''}</strong
          ><small
            >{member
              ? member.online === true
                ? 'Online'
                : member.online === false
                  ? 'Offline'
                  : 'Joined'
              : 'Open seat'}</small
          ></span
        >
      {/each}
    </div>
    <p class="connection" role="status">
      {connection === 'connected'
        ? 'Connected'
        : connection === 'idle'
          ? 'Connecting…'
          : connection === 'error'
            ? 'Connection interrupted'
            : 'Reconnecting…'}
    </p>
    {#if lobbyId}<a href={resolve(`/multiplayer?lobby=${lobbyId}`)}>Room lobby →</a>{/if}
    {@render children?.()}
  </div>
  {#if error || copyError || (lobbyId && coordinator.snapshot.error)}<p class="error" role="alert">
      {error ?? copyError ?? coordinator.snapshot.error}
    </p>{/if}
</header>

<style>
  .room-shell {
    margin-block: 20px 24px;
    padding: 24px;
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--color-primary);
    border-radius: 12px;
    background: var(--color-card);
  }
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .eyebrow {
    color: var(--color-primary);
    font: 700 10px var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  h1 {
    margin-block: 7px;
    font: 800 clamp(27px, 4vw, 42px)/1.1 var(--font-display);
  }
  .summary,
  .connection {
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.6;
  }
  .invite {
    flex-shrink: 0;
    text-align: center;
  }
  .invite > span {
    color: var(--color-muted-foreground);
    font-size: 10px;
  }
  .invite > strong {
    display: block;
    font: 800 30px var(--font-mono);
    letter-spacing: 0.2em;
    padding-left: 0.2em;
  }
  .actions,
  .seats,
  .seat,
  .room-footer {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .actions {
    justify-content: center;
    gap: 8px;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 11px;
    cursor: pointer;
  }
  button:hover,
  a:hover {
    color: var(--color-primary);
  }
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  .room-footer {
    flex-wrap: wrap;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
  }
  .seats {
    flex: 1;
    flex-wrap: wrap;
  }
  .seat {
    gap: 7px;
    font-size: 11px;
  }
  .seat small {
    color: var(--color-muted-foreground);
  }
  .seat.online > :global(svg) {
    color: var(--color-positive);
  }
  a {
    font-size: 12px;
    font-weight: 700;
  }
  .error {
    margin-top: 14px;
    color: var(--color-destructive);
    font-size: 12px;
  }
  @media (max-width: 560px) {
    .room-shell {
      padding: 18px;
    }
    .heading {
      flex-direction: column;
      align-items: stretch;
      gap: 18px;
    }
    .invite {
      text-align: left;
    }
    .invite > strong {
      padding-left: 0;
    }
    .actions {
      justify-content: flex-start;
    }
    .seats {
      flex-basis: 100%;
      gap: 16px;
    }
  }
</style>
