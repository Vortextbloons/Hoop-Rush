<script lang="ts">
  import type { HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import PlayerFace from './PlayerFace.svelte';
  import TeamLogo from './TeamLogo.svelte';

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

  let {
    players,
    manifest,
    simulationEraLabel,
    variant = 'cards',
  }: {
    players: PeakPlayerSeason[];
    manifest: HoopRushManifest;
    /** Fixed simulation environment label, e.g. "2010s". */
    simulationEraLabel?: string;
    variant?: 'cards' | 'strip';
  } = $props();

  function franchiseEntry(franchiseId: string) {
    return manifest.franchiseLineage.find((e) => e.franchiseId === franchiseId) ?? null;
  }

  function eraLabel(eraId: string) {
    return manifest.eras.find((e) => e.eraId === eraId)?.label ?? eraId;
  }
</script>

{#if variant === 'strip'}
  <div class="flex min-w-0 items-center gap-3" role="group" aria-label="Your five">
    <div class="flex shrink-0 -space-x-2">
      {#each players as player, index (player.playerId)}
        <span
          class="relative rounded-full border-2 border-card bg-card shadow-sm"
          style="z-index: {players.length - index}"
          title="{player.displayName} · {franchiseAbbreviation(player.franchiseId)} · {eraLabel(player.eraId)}"
        >
          <PlayerFace
            {player}
            {manifest}
            size="sm"
            fallbackInitials={player.firstName[0]! + player.lastName[0]!}
          />
        </span>
      {/each}
    </div>
    <div class="min-w-0">
      <p class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-base">
        Your five
      </p>
      {#if simulationEraLabel}
        <p class="font-mono text-[10px] text-muted-foreground">
          {simulationEraLabel} simulation
        </p>
      {/if}
    </div>
  </div>
{:else}
  <div class="min-w-0">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p class="font-display text-lg font-extrabold tracking-tight uppercase sm:text-xl">
        Your five
      </p>
      {#if simulationEraLabel}
        <p class="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
          {simulationEraLabel} simulation · no bench
        </p>
      {/if}
    </div>
    <ul
      class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5"
      aria-label="Your five"
    >
      {#each players as player, index (player.playerId)}
        {@const franchise = franchiseEntry(player.franchiseId)}
        <li
          class="flex min-w-0 flex-col items-center rounded-xl border border-border bg-surface-1 p-2.5 text-center sm:p-3"
        >
          <span
            class="mb-1.5 rounded bg-primary/15 px-1.5 py-px font-mono text-[9px] font-bold tracking-[0.1em] text-primary uppercase"
          >
            {SLOT_LABELS[index]}
          </span>
          <PlayerFace
            {player}
            {manifest}
            size="md"
            fallbackInitials={player.firstName[0]! + player.lastName[0]!}
          />
          <p
            class="font-display mt-2 w-full truncate text-[11px] leading-tight font-extrabold tracking-tight uppercase sm:text-xs"
            title={player.displayName}
          >
            {player.displayName}
          </p>
          <p
            class="mt-1 flex w-full items-center justify-center gap-1 font-mono text-[9px] text-muted-foreground"
          >
            {#if franchise}
              <TeamLogo
                {manifest}
                franchiseId={franchise.franchiseId}
                teamExternalId={franchise.teamExternalId}
                alt=""
                className="h-3.5 w-3.5"
              />
            {/if}
            <span class="truncate">
              {franchiseAbbreviation(player.franchiseId)} · {eraLabel(player.eraId)}
            </span>
          </p>
        </li>
      {/each}
    </ul>
  </div>
{/if}
