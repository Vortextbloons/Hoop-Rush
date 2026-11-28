<script lang="ts">
  import type { FullCourtAwardCandidate, FullCourtAwardsBoard } from '@hoop-rush/engine';
  import { Crown, Trophy } from '@lucide/svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  let {
    awards,
    art = null,
  }: {
    awards: FullCourtAwardsBoard;
    art?: FullCourtArt | null;
  } = $props();

  const mvp = $derived(awards.mvp.winner);
  const finalsMvp = $derived(awards.finalsMvp.winner);
  const mvpIdentity = $derived(
    mvp === null || art === null ? null : art.teamFor(mvp.player.teamId),
  );
  const finalsIdentity = $derived(
    finalsMvp === null || art === null ? null : art.teamFor(finalsMvp.player.teamId),
  );

  function metaFor(candidate: FullCourtAwardCandidate | null, gamesLabel: string): string | null {
    if (candidate === null) return null;
    const positions = candidate.player.positions.slice(0, 2).join('/');
    return `${positions} · ${String(candidate.player.games)} ${gamesLabel}`;
  }

  function perGameStats(candidate: FullCourtAwardCandidate | null) {
    if (candidate === null) return [];
    return [
      { label: 'PTS', value: candidate.player.ppg.toFixed(1) },
      { label: 'REB', value: candidate.player.rpg.toFixed(1) },
      { label: 'AST', value: candidate.player.apg.toFixed(1) },
    ];
  }

  function finalsGamesLabel(candidate: FullCourtAwardCandidate | null): string {
    return candidate?.player.games === 1 ? 'Finals game' : 'Finals games';
  }
</script>

{#if awards.hasPlayerStats}
  <div class="grid items-stretch gap-3 md:grid-cols-2">
    <MvpCard
      class="h-full"
      label="League MVP"
      tone="primary"
      name={mvp?.player.displayName ?? null}
      team={mvp?.player.teamName ?? null}
      position={metaFor(mvp, 'GP')}
      stats={perGameStats(mvp)}
      emptyCopy="No league MVP was recorded for this run."
    >
      {#snippet icon()}<Trophy size={18} aria-hidden="true" />{/snippet}
      {#snippet logo()}
        {#if art !== null && mvpIdentity !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={mvpIdentity.franchiseId}
            teamExternalId={mvpIdentity.teamExternalId}
            className="h-full w-full"
          />
        {/if}
      {/snippet}
      {#snippet portrait()}
        {#if mvp !== null}
          <FullCourtPortrait player={mvp.player} {art} size="xl" eager />
        {/if}
      {/snippet}
    </MvpCard>

    <MvpCard
      class="h-full"
      label="Finals MVP"
      tone="accent"
      name={finalsMvp?.player.displayName ?? null}
      team={finalsMvp?.player.teamName ?? null}
      position={metaFor(finalsMvp, finalsGamesLabel(finalsMvp))}
      stats={perGameStats(finalsMvp)}
      emptyCopy="No Finals MVP was recorded for this run."
    >
      {#snippet icon()}<Crown size={18} aria-hidden="true" />{/snippet}
      {#snippet logo()}
        {#if art !== null && finalsIdentity !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={finalsIdentity.franchiseId}
            teamExternalId={finalsIdentity.teamExternalId}
            className="h-full w-full"
          />
        {/if}
      {/snippet}
      {#snippet portrait()}
        {#if finalsMvp !== null}
          <FullCourtPortrait player={finalsMvp.player} {art} size="xl" eager />
        {/if}
      {/snippet}
    </MvpCard>
  </div>
{/if}
