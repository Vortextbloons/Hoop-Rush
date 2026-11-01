<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import { seatLabel, seatOrder } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    animate = false,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    animate?: boolean;
  } = $props();

  const franchises = $derived(state.franchises);
</script>

{#if franchises !== null}
  <section
    class="grid grid-cols-2 gap-2"
    aria-label="Assigned franchises"
    data-franchise-reveal={animate ? 'true' : 'false'}
  >
    {#each seatOrder(localSeat) as seat (seat)}
      {@const franchise = franchises[seat]}
      {@const team = art === null ? null : art.teamFor(franchise.franchiseId)}
      <article
        class="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-2.5 py-2 {seat ===
        localSeat
          ? 'border-primary/40'
          : 'border-border'} {animate ? 'franchise-reveal' : ''}"
        data-seat={seat}
      >
        {#if team !== null && art !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={team.franchiseId}
            teamExternalId={team.teamExternalId}
            className="h-8 w-8"
          />
        {:else}
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded bg-surface-3 font-display text-[10px] font-extrabold text-muted-foreground"
            aria-hidden="true">{initialsOf(franchise.displayName)}</span
          >
        {/if}
        <div class="min-w-0">
          <p
            class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
          >
            {seat === localSeat ? 'Your franchise' : `${seatLabel(seat)} franchise`}
          </p>
          <p class="truncate font-display text-sm leading-tight font-extrabold uppercase">
            {franchise.displayName}
          </p>
        </div>
      </article>
    {/each}
  </section>
{/if}

<style>
  .franchise-reveal {
    animation: franchise-reveal 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .franchise-reveal[data-seat='p2'] {
    animation-delay: 80ms;
  }
  @keyframes franchise-reveal {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .franchise-reveal {
      animation: none;
    }
  }
</style>
