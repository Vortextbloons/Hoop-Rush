<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    Position,
  } from '@hoop-rush/data-contracts';
  import { POSITIONS } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import {
    capStatusClass,
    capStatusShortLabel,
    initialsOf,
  } from '../cap-rush/cap-rush-presentation.js';
  import {
    exactMoney,
    seatLabel,
    seatOrder,
    seatPayrollSummary,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    localSeat,
    art = null,
    highlightSignings = null,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    highlightSignings?: Partial<Record<CapRushMultiplayerSeatId, Position | null>> | null;
  } = $props();
</script>

<section aria-label="Team payroll summary" class="grid min-w-0 grid-cols-2 gap-2">
  {#each seatOrder(localSeat) as seat (seat)}
    {@const summary = seatPayrollSummary(state, seat)}
    {@const franchise = state.franchises?.[seat] ?? null}
    {@const team = franchise === null || art === null ? null : art.teamFor(franchise.franchiseId)}
    {@const name = franchise?.displayName ?? seatLabel(seat)}
    {@const highlightPosition = highlightSignings?.[seat] ?? null}
    {@const signing =
      highlightPosition === null
        ? null
        : (state.recruitment?.signings.find(
            (entry) => entry.seat === seat && entry.position === highlightPosition,
          ) ?? null)}
    <article
      class="min-w-0 rounded-xl border bg-card px-2.5 py-2 {seat === localSeat
        ? 'border-primary/40'
        : 'border-border'}"
      data-seat={seat}
    >
      <div class="flex min-w-0 items-center gap-1.5">
        {#if team !== null && art !== null && franchise !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={team.franchiseId}
            teamExternalId={team.teamExternalId}
            className="h-5 w-5"
          />
        {:else}
          <span
            class="grid h-5 w-5 shrink-0 place-items-center rounded bg-surface-3 font-display text-[9px] font-extrabold text-muted-foreground"
            aria-hidden="true">{initialsOf(name)}</span
          >
        {/if}
        <div class="min-w-0 flex-1">
          <p
            class="truncate font-mono text-[8px] font-bold tracking-[0.1em] text-muted-foreground uppercase"
          >
            {seat === localSeat ? 'Your team' : 'Opponent'}
          </p>
          <p class="truncate font-display text-sm leading-tight font-extrabold uppercase">
            {name}
          </p>
        </div>
        <span
          class="shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase {capStatusClass(
            summary.status,
          )}">{capStatusShortLabel(summary.status)}</span
        >
      </div>

      <dl class="mt-1.5 flex flex-col gap-0.5">
        <div class="flex min-w-0 items-center justify-between gap-1.5">
          <dt class="font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase">
            Commit
          </dt>
          <dd
            class="shrink-0 font-mono text-[9px] font-bold tabular-nums"
            title="Signed payroll plus the current binding lead"
          >
            {exactMoney(summary.payrollDollars)}
          </dd>
        </div>
        <div class="flex min-w-0 items-center justify-between gap-1.5">
          <dt class="font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase">
            Room
          </dt>
          <dd
            class="shrink-0 font-mono text-[9px] font-bold tabular-nums"
            class:text-negative={summary.headroomDollars < 0}
          >
            {exactMoney(summary.headroomDollars)}
          </dd>
        </div>
      </dl>

      <div class="mt-1.5 flex items-center gap-0.5">
        {#each POSITIONS as position (position)}
          <span
            class="grid h-5 w-5 place-items-center rounded border font-mono text-[8px] font-bold {summary.filledPositions.includes(
              position,
            )
              ? 'border-primary/50 bg-primary/15 text-primary'
              : 'border-dashed border-border text-muted-foreground'}"
            class:signing-chip={signing?.position === position}>{position}</span
          >
        {/each}
      </div>

      {#if signing !== null}
        <p class="signing-note mt-1 truncate font-mono text-[9px] font-bold text-positive">
          {signing.source === 'auto' ? 'Auto-signed' : 'Signed'}
          {signing.displayName} · {exactMoney(signing.salaryDollars)}
        </p>
      {/if}

      {#if summary.bindingPlayerName !== null}
        <p class="mt-1 truncate font-mono text-[9px] text-accent">
          Leading {summary.bindingPlayerName}
          {#if summary.bindingBidDollars !== null}· {exactMoney(summary.bindingBidDollars)}{/if}
        </p>
      {/if}
    </article>
  {/each}
</section>

<style>
  .signing-chip {
    animation: signing-chip 320ms ease-out;
  }
  .signing-note {
    animation: signing-note 320ms ease-out;
  }
  @keyframes signing-chip {
    0% {
      transform: scale(1);
    }
    45% {
      transform: scale(1.25);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-positive) 45%, transparent);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes signing-note {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .signing-chip,
    .signing-note {
      animation: none;
    }
  }
</style>
