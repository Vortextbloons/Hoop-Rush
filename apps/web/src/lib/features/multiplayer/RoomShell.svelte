<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { Check, Copy, Link, Users } from '@lucide/svelte';
  import { getLobbyCoordinator } from './lobby-context.svelte.js';
  import { loadLobbyId } from './multiplayer-lobby';
  import { multiplayerInviteLink } from './invite-link';
  import RoomProfiles from '#lib/features/profile/RoomProfiles.svelte';
  import type { PublicProfile } from '@hoop-rush/data-contracts';
  import Alert from '#lib/components/ui/Alert.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  let {
    roomId,
    compactMobile = false,
    title,
    summary,
    phase,
    code = null,
    participantId = null,
    members = [],
    connection = 'connected',
    error = null,
    children,
    content,
    lobbyId: suppliedLobbyId = null,
    profileKind = null,
    onProfilesChange,
  }: {
    roomId: string;
    compactMobile?: boolean;
    title: string;
    summary: string;
    phase: string;
    code?: string | null;
    participantId?: string | null;
    members?: readonly { participantId: string; online?: boolean }[];
    connection?: string;
    error?: string | null;
    children?: Snippet;
    content?: Snippet;
    lobbyId?: string | null;
    profileKind?: 'fixed-five' | 'draft-duel' | 'havoc-multiplayer' | null;
    onProfilesChange?: (players: PublicProfile[]) => void;
  } = $props();
  const coordinator = getLobbyCoordinator();
  let lobbyId = $state<string | null>(null);
  let copied = $state<'code' | 'link' | null>(null);
  let copyError = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  const lobby = $derived(
    coordinator.snapshot.lobby?.id === lobbyId ? coordinator.snapshot.lobby : null,
  );
  const roomCode = $derived(lobby?.code ?? code);
  onMount(() => {
    lobbyId = suppliedLobbyId ?? loadLobbyId(roomId);
    if (lobbyId) void coordinator.session.attach(lobbyId);
  });
  onDestroy(() => {
    if (copyTimer !== null) clearTimeout(copyTimer);
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
      if (copyTimer !== null) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyTimer = null;
        copied = null;
      }, 1500);
    } catch {
      copyError = 'Couldn’t copy. Share the room code shown here.';
    }
  }
</script>

<section class="room-shell" class:compact-mobile={compactMobile}>
  <PageHeader
    eyebrow={`Multiplayer · ${phase}`}
    {title}
    description={compactMobile ? null : summary}
  >
    {#snippet actions()}
      {#if roomCode}
        <div class="invite">
          <p class="ui-micro">Room code</p>
          <p class="room-code">{roomCode}</p>
          <ActionRow>
            {#snippet primary()}
              <Button
                tone="secondary"
                size="sm"
                class="min-h-11 md:min-h-9"
                onclick={() => copy('code')}
                aria-label={copied === 'code' ? 'Room code copied' : 'Copy room code'}
              >
                {#if copied === 'code'}<Check size={15} />{:else}<Copy size={15} />{/if}
                <span class="code-label">{copied === 'code' ? 'Copied' : 'Copy code'}</span>
                <span class="mobile-code">{roomCode}</span>
              </Button>
            {/snippet}
            {#snippet secondary()}
              <Button
                tone="secondary"
                size="sm"
                class="min-h-11 md:min-h-9"
                onclick={() => copy('link')}
                aria-label={copied === 'link' ? 'Invite link copied' : 'Copy invite link'}
              >
                {#if copied === 'link'}<Check size={15} />{:else}<Link size={15} />{/if}
                {copied === 'link' ? 'Copied' : 'Copy invite link'}
              </Button>
            {/snippet}
          </ActionRow>
          {#if !lobbyId}
            <p class="expiry ui-micro">Room codes expire after 15 minutes.</p>
          {/if}
        </div>
      {/if}
    {/snippet}
  </PageHeader>
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
  {#if error || copyError || (lobbyId && coordinator.snapshot.error)}<Alert tone="danger">
      {error ?? copyError ?? coordinator.snapshot.error}
    </Alert>{/if}
  {#if content}
    <div class="room-content">{@render content()}</div>
  {/if}
  {#if suppliedLobbyId}
    <RoomProfiles
      topic={`profile-lobby:${suppliedLobbyId}`}
      bindingId={null}
      {participantId}
      {onProfilesChange}
    />
  {:else if profileKind}
    <RoomProfiles
      topic={`profile-${profileKind}:${roomId}`}
      bindingId={`${profileKind}:${roomId}`}
      {participantId}
      {onProfilesChange}
    />
  {/if}
</section>

<style>
  .room-content {
    min-width: 0;
    margin-top: 16px;
  }
  .mobile-code {
    display: none;
  }
  .room-shell {
    margin-block: 20px 24px;
    padding: 24px;
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--color-primary);
    border-radius: 12px;
    background: var(--color-card);
  }
  .invite {
    display: grid;
    justify-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    text-align: center;
  }
  .room-code {
    font: 800 30px var(--font-mono);
    letter-spacing: 0.2em;
    padding-left: 0.2em;
  }
  .expiry {
    margin-top: 6px;
  }
  .room-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
  }
  .seats {
    display: flex;
    align-items: center;
    flex: 1;
    flex-wrap: wrap;
    gap: 12px;
  }
  .seat {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
  }
  .seat small {
    color: var(--color-muted-foreground);
  }
  .seat.online > :global(svg) {
    color: var(--color-positive);
  }
  .connection {
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.6;
  }
  a {
    font-size: 12px;
    font-weight: 700;
  }
  a:hover {
    color: var(--color-primary);
  }
  a:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  @media (min-width: 768px) {
    .compact-mobile.room-shell {
      padding: 20px;
      margin-block: 12px 16px;
    }
    .compact-mobile .room-footer {
      margin-top: 12px;
      padding-top: 10px;
    }
  }
  @media (max-width: 767px) {
    .compact-mobile.room-shell {
      margin-block: 8px 12px;
      padding: 10px;
    }
    .compact-mobile :global(.ui-page-title) {
      font-size: 23px;
      margin-block: 3px 0;
    }
    .compact-mobile :global(.ui-page-eyebrow) {
      font-size: 8px;
      letter-spacing: 0.04em;
    }
    .compact-mobile .invite {
      justify-items: flex-start;
      text-align: left;
    }
    .compact-mobile .room-code,
    .compact-mobile .expiry,
    .compact-mobile .code-label {
      display: none;
    }
    .compact-mobile .mobile-code {
      display: inline;
      font-family: var(--font-mono);
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    .compact-mobile .room-footer {
      margin-top: 8px;
      padding-top: 8px;
      gap: 8px;
    }
    .compact-mobile .seats {
      flex-basis: auto;
      gap: 10px;
    }
    .compact-mobile .seat {
      gap: 4px;
      font-size: 10px;
    }
    .compact-mobile .seat small {
      display: none;
    }
    .compact-mobile .connection {
      font-size: 10px;
    }
    .compact-mobile .room-footer > a {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
    }
  }
  @media (max-width: 560px) {
    .room-shell {
      padding: 18px;
    }
    .invite {
      justify-items: flex-start;
      text-align: left;
    }
    .seats {
      flex-basis: 100%;
      gap: 16px;
    }
  }
</style>
