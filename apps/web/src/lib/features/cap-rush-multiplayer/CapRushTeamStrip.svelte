<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    Position,
  } from '@hoop-rush/data-contracts';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_FIRST_APRON_DOLLARS,
    CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS,
    POSITIONS,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import {
    capStatusClass,
    capStatusShortLabel,
    initialsOf,
    formatMillions,
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

<section
  aria-label="Team payroll summary"
  class="grid min-w-0 grid-cols-1 gap-2 min-[400px]:grid-cols-2"
>
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

      <div class="mt-3 min-w-0">
        <div
          class="relative h-2.5 overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-label={`${name} salary committed`}
          aria-valuemin={0}
          aria-valuemax={CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS}
          aria-valuenow={Math.min(
            CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS,
            Math.max(0, summary.payrollDollars),
          )}
          aria-valuetext={`${exactMoney(summary.payrollDollars)} committed, ${exactMoney(summary.headroomDollars)} remaining`}
        >
          <span
            class="absolute inset-y-0 left-0 bg-positive/70"
            style:width={`${(CAP_RUSH_CAP_LINE_DOLLARS / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100}%`}
          ></span>
          <span
            class="absolute inset-y-0 bg-accent/70"
            style:left={`${(CAP_RUSH_CAP_LINE_DOLLARS / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100}%`}
            style:width={`${((CAP_RUSH_FIRST_APRON_DOLLARS - CAP_RUSH_CAP_LINE_DOLLARS) / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100}%`}
          ></span>
          <span
            class="absolute inset-y-0 right-0 bg-primary/70"
            style:width={`${((CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS - CAP_RUSH_FIRST_APRON_DOLLARS) / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100}%`}
          ></span>
          <span
            class="salary-marker absolute inset-y-0 w-0.5 bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.65)]"
            style:left={`clamp(0px, calc(${Math.min(100, Math.max(0, (summary.payrollDollars / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100))}% - 1px), calc(100% - 2px))`}
          ></span>
        </div>
        <div class="mt-1 flex justify-between gap-1 font-mono text-[8px] text-muted-foreground">
          <span>$0</span>
          <span>Cap {formatMillions(CAP_RUSH_CAP_LINE_DOLLARS)}</span>
          <span>Limit {formatMillions(CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS)}</span>
        </div>
      </div>

      <dl class="mt-1.5 flex flex-col gap-0.5">
        <div class="flex min-w-0 items-center justify-between gap-1.5">
          <dt class="font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase">
            Committed
          </dt>
          <dd
            class="shrink-0 font-mono text-[9px] font-bold tabular-nums"
            title="Signed payroll plus your highest winning offer"
          >
            {exactMoney(summary.payrollDollars)}
          </dd>
        </div>
        <div class="flex min-w-0 items-center justify-between gap-1.5">
          <dt class="font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase">
            Salary left
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
  .salary-marker {
    transition: left 240ms ease-out;
  }
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
    .salary-marker {
      transition: none;
    }
    .signing-chip,
    .signing-note {
      animation: none;
    }
  }
</style>
