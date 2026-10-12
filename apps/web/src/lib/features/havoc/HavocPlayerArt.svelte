<script lang="ts">
  import { onMount } from 'svelte';
  import type { HoopRushManifest, PlayersIndex } from '@hoop-rush/data-contracts';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import { initialsOf } from '$lib/season/season-branding';

  let {
    playerId,
    playerVersionId,
    displayName,
    franchiseId,
    seasonKey,
    large = false,
  }: {
    playerId?: string;
    playerVersionId?: string | null;
    displayName: string;
    franchiseId?: string | null;
    seasonKey?: string | null;
    large?: boolean;
  } = $props();
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let index = $state.raw<PlayersIndex | null>(null);
  const player = $derived(
    index?.players.find(
      (entry) =>
        (playerId ? entry.playerId === playerId : entry.displayName === displayName) &&
        (!franchiseId || entry.franchiseId === franchiseId) &&
        (!seasonKey || entry.seasonKey === seasonKey),
    ) ??
      index?.players.find((entry) =>
        playerId ? entry.playerId === playerId : entry.displayName === displayName,
      ),
  );
  const team = $derived(
    manifest?.modernFranchiseSlots.find(
      (slot) => slot.franchiseId === (franchiseId ?? player?.franchiseId),
    ),
  );
  onMount(() => {
    let mounted = true;
    void Promise.allSettled([getManifest(), getPlayersIndex()]).then(([branding, players]) => {
      if (!mounted) return;
      if (branding.status === 'fulfilled') manifest = branding.value;
      if (players.status === 'fulfilled') index = players.value;
    });
    return () => {
      mounted = false;
    };
  });
</script>

<div class="h-player-art" class:large data-player-version={playerVersionId}>
  {#if manifest && player}
    <PlayerFace {manifest} {player} size="xl" fallbackInitials={initialsOf(displayName)} />
  {:else}
    <span class="h-initials" aria-hidden="true">{initialsOf(displayName)}</span>
  {/if}
  {#if manifest && team}
    <span class="h-team-crest">
      <TeamLogo
        {manifest}
        franchiseId={team.franchiseId}
        teamExternalId={team.teamExternalId}
        alt={team.displayName}
        className="h-5 w-5"
      />
    </span>
  {/if}
</div>

<style>
  .h-player-art {
    position: relative;
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    flex-shrink: 0;
  }
  .h-player-art :global(> div) {
    width: 100%;
    height: 100%;
    background: transparent;
    border-radius: 0;
  }
  .large {
    width: 100%;
    height: 160px;
  }
  .large :global(img) {
    object-fit: contain;
    transform: none;
  }
  .h-initials {
    font-family: var(--font-display);
    font-size: 3rem;
    font-weight: 900;
    opacity: 0.5;
  }
  .h-team-crest {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 3px;
    background: #eef2ff;
    border-radius: 7px;
  }
  .large .h-team-crest {
    right: 16px;
    bottom: 12px;
  }
</style>
