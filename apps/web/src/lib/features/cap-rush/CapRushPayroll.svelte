<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import {
    apronPenaltyRows,
    apronPenaltyTitle,
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from './cap-rush-presentation.ts';

  let { view }: { view: CapRushDraftView } = $props();

  const payroll = $derived(view.payrollDollars);
  const pct = $derived(Math.min(100, (payroll / view.hardLimitDollars) * 100));
  const penaltyRows = $derived(apronPenaltyRows(view.status));
  const target = $derived(view.slots.find((slot) => slot.highestPaid) ?? null);
</script>

<section
  class="rounded-2xl border border-border bg-card px-4 py-2.5 sm:px-5 sm:py-3"
  aria-label="Payroll and apron status"
>
  <div
    class="grid gap-3 lg:grid-cols-[minmax(170px,210px)_minmax(0,1fr)_minmax(250px,auto)] lg:items-center lg:gap-5"
  >
    <div class="flex items-center justify-between gap-3 lg:block">
      <div>
        <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
          Player payroll
        </p>
        <p class="font-display mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums">
          {formatMillions(payroll)}
        </p>
      </div>
      <span
        class="inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.1em] uppercase lg:mt-1 {capStatusClass(
          view.status,
        )}">{capStatusLabel(view.status)}</span
      >
    </div>

    <div class="min-w-0">
      <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
        <span class="absolute inset-y-0 left-0 w-[80%] bg-positive/70"></span>
        <span class="absolute inset-y-0 left-[80%] w-[10%] bg-accent/70"></span>
        <span class="absolute inset-y-0 left-[90%] w-[10%] bg-primary/70"></span>
        {#if pct > 0}
          <span
            class="absolute inset-y-0 w-0.5 bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.65)]"
            style:left={`calc(${pct}% - 1px)`}
          ></span>
        {/if}
      </div>
      <div
        class="mt-1.5 flex font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase sm:text-[9px]"
      >
        <span class="flex w-[80%] justify-between"><span>$0</span><span>$120M</span></span>
        <span class="invisible w-[10%] text-center sm:visible">$135M</span>
        <span class="w-[10%] text-right">$150M</span>
      </div>
    </div>

    <dl class="grid grid-cols-3 gap-2">
      <div class="min-w-0 rounded-lg bg-surface-1 px-2 py-1 sm:px-2.5 sm:py-1.5">
        <dt class="truncate font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          Room
        </dt>
        <dd
          class="mt-0.5 text-[11px] font-extrabold tabular-nums sm:text-xs"
          class:text-negative={view.remainingRoomDollars < 0}
        >
          {formatMillions(view.remainingRoomDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-lg bg-surface-1 px-2 py-1 sm:px-2.5 sm:py-1.5">
        <dt class="truncate font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          Limit
        </dt>
        <dd class="mt-0.5 text-[11px] font-extrabold tabular-nums sm:text-xs">
          {formatMillions(view.hardLimitDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-lg bg-surface-1 px-2 py-1 sm:px-2.5 sm:py-1.5">
        <dt class="truncate font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          Target
        </dt>
        <dd class="mt-0.5 truncate text-[11px] font-extrabold sm:text-xs">
          {target?.player?.displayName ?? '—'}
        </dd>
      </div>
    </dl>
  </div>

  <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2.5">
    {#if view.status === 'illegal'}
      <p class="text-[11px] font-bold text-negative">
        Over the hard limit — reduce salaries below $150M.
      </p>
    {:else}
      <p class="text-[11px] font-bold">{apronPenaltyTitle(view.status)}</p>
      {#if penaltyRows.length > 0}
        <details class="text-[10px] text-muted-foreground">
          <summary
            class="cursor-pointer font-mono tracking-[0.08em] uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            View rating cuts
          </summary>
          <ul class="mt-1 flex flex-wrap gap-1.5">
            {#each penaltyRows as row (row.label)}
              <li
                class="rounded border border-line-soft bg-surface-1 px-1.5 py-0.5 font-mono text-[9px] font-semibold"
              >
                {row.label} <span class="text-primary">−{row.reduction}</span>
              </li>
            {/each}
          </ul>
        </details>
      {:else}
        <p class="hidden text-[10px] text-muted-foreground sm:block">
          Every player keeps their original ratings.
        </p>
      {/if}
    {/if}
  </div>
</section>
