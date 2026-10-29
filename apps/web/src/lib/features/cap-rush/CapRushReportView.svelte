<script lang="ts">
  import {
    CAP_RUSH_GAME_COUNT,
    POSITIONS,
    type CapRushPlayerSeasonLine,
    type CapRushReport,
  } from '@hoop-rush/data-contracts';
  import { havocMutationDefinitionOf } from '@hoop-rush/engine';
  import { Crown, Sparkles, Trophy } from '@lucide/svelte';
  import {
    apronPenaltyRows,
    apronPenaltyTitle,
    capStatusClass,
    capStatusLabel,
    formatAverage,
    formatMillions,
    recordLabel,
    variantLabel,
  } from './cap-rush-presentation.ts';

  let { report }: { report: CapRushReport } = $props();

  const players = $derived(
    report.players
      .slice()
      .sort((left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot)),
  );
  const penaltyRows = $derived(apronPenaltyRows(report.payrollStatus));
  const spin = $derived(report.spin);
  const spinTarget = $derived(
    spin === null ? null : (players.find((line) => line.cardId === spin.targetCardId) ?? null),
  );
  const mutation = $derived(spin === null ? null : havocMutationDefinitionOf(spin.mutationId));
  const aggregate = $derived(report.aggregate);
  const winsPerMillion = $derived(report.winsPerMillion);
  const mvp = $derived(report.mvp);

  function totalOf(
    field: 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers',
  ): number {
    return players.reduce((total, line: CapRushPlayerSeasonLine) => total + line[field], 0);
  }
</script>

<div class="flex flex-col gap-3" data-cap-rush-report>
  {#if aggregate.perfectSeason}
    <div
      class="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-4 sm:p-5"
      role="status"
    >
      <Trophy size={22} class="shrink-0 text-accent" aria-hidden="true" />
      <div class="min-w-0">
        <p class="font-display text-lg font-extrabold tracking-tight uppercase text-accent">
          Perfect season · 82–0
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          All {CAP_RUSH_GAME_COUNT} games won. No losses on the schedule.
        </p>
      </div>
    </div>
  {/if}

  <section class="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Final report">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          {variantLabel(report.variant)} · Season report
        </p>
        <h2 class="font-display mt-1 text-3xl font-extrabold tracking-tight tabular-nums">
          {recordLabel(aggregate.wins, aggregate.losses)}
          {#if aggregate.perfectSeason}
            <span class="text-accent">· 82–0</span>
          {/if}
        </h2>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground uppercase">
          {aggregate.games} games · {aggregate.pointsFor} for · {aggregate.pointsAgainst} against
        </p>
      </div>
      <span
        class="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {capStatusClass(
          report.payrollStatus,
        )}">{capStatusLabel(report.payrollStatus)}</span
      >
    </div>

    <dl class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div class="min-w-0 rounded-xl bg-surface-1 p-3">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Player payroll
        </dt>
        <dd class="font-display mt-0.5 text-xl font-extrabold tabular-nums">
          {formatMillions(report.payrollDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-xl bg-surface-1 p-3">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Mutation spend
        </dt>
        <dd
          class="font-display mt-0.5 text-xl font-extrabold tabular-nums {report.spinSpendDollars ===
          0
            ? 'text-muted-foreground'
            : ''}"
        >
          {report.spinSpendDollars === 0 ? 'None' : formatMillions(report.spinSpendDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-xl bg-surface-1 p-3">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Total spend
        </dt>
        <dd class="font-display mt-0.5 text-xl font-extrabold tabular-nums">
          {formatMillions(report.totalSpendDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-xl bg-surface-1 p-3">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Unused normal-cap budget
        </dt>
        <dd
          class="font-display mt-0.5 text-xl font-extrabold tabular-nums"
          class:text-negative={report.unusedCapDollars < 0}
        >
          {formatMillions(report.unusedCapDollars)}
        </dd>
      </div>
    </dl>
    <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
      Player payroll is the five salaries only. Mutation spend is the spin price, and total spend
      adds the two. Unused normal-cap budget is what is left under the $120M cap.
    </p>

    <div class="mt-4 rounded-xl bg-surface-1 p-3">
      <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
        Efficiency
      </p>
      <p class="font-display mt-0.5 text-2xl font-extrabold tabular-nums">
        {winsPerMillion === null ? '—' : winsPerMillion.toFixed(2)}
      </p>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        wins per $1M of player payroll
        <span class="font-mono"
          >· {aggregate.wins} wins ÷ {formatMillions(report.payrollDollars)}</span
        >
      </p>
    </div>
  </section>

  <section class="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Your five">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
        The five you signed
      </h3>
      <p class="font-mono text-[10px] text-muted-foreground uppercase">
        Target slot {report.targetSlot}
      </p>
    </div>
    <ul class="mt-3 space-y-2">
      {#each players as line (line.slot)}
        <li class="flex items-center justify-between gap-2 rounded-xl bg-surface-1 px-2.5 py-2">
          <span class="flex min-w-0 items-center gap-2">
            <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold"
              >{line.slot}</span
            >
            <span class="min-w-0">
              <span class="block truncate text-sm font-bold">{line.displayName}</span>
              <span class="font-mono text-[9px] text-muted-foreground uppercase">
                {line.gamesPlayed} GP · {formatAverage(line.points, line.gamesPlayed)} pts
              </span>
            </span>
          </span>
          <span class="shrink-0 font-display text-base font-extrabold tabular-nums"
            >{formatMillions(line.salaryDollars)}</span
          >
        </li>
      {/each}
    </ul>
    <div
      class="mt-3 flex items-center justify-between border-t border-line-soft pt-2.5 text-sm font-bold"
    >
      <span class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
        >Total player payroll</span
      >
      <span class="font-display text-lg tabular-nums">{formatMillions(report.payrollDollars)}</span>
    </div>
  </section>

  <div class="grid gap-3 lg:grid-cols-2">
    <section
      class="rounded-2xl border border-border bg-card p-4 sm:p-5"
      aria-label="Cap status and applied penalties"
    >
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
        Cap status · {capStatusLabel(report.payrollStatus)}
      </h3>
      <p class="mt-1 text-xs font-semibold">{apronPenaltyTitle(report.payrollStatus)}</p>
      {#if penaltyRows.length === 0}
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          No rating reductions applied. Every signed player kept their original ratings.
        </p>
      {:else}
        <table class="ui-stats-table mt-3 text-[11px]">
          <caption class="sr-only">Rating reductions applied by the apron</caption>
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
            >
              <th scope="col" class="px-2 py-1 text-left font-medium">Rating</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Reduction</th>
            </tr>
          </thead>
          <tbody>
            {#each penaltyRows as row (row.label)}
              <tr class="border-b border-border/40">
                <th scope="row" class="px-2 py-1 text-left font-semibold">{row.label}</th>
                <td class="px-2 py-1 text-right font-mono text-primary">−{row.reduction}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <dl class="mt-3 grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Forced isolations
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {report.apronTriggers.isolations}
          </dd>
        </div>
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Defensive strikes
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {report.apronTriggers.strikes}
          </dd>
        </div>
      </dl>
    </section>

    <section
      class="rounded-2xl border border-border bg-card p-4 sm:p-5"
      aria-label="Cap Roulette spin"
    >
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">Mutation spin</h3>
      {#if spin === null || mutation === null}
        <p class="mt-2 text-sm font-semibold">No spin purchased.</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          {#if report.variant === 'roulette'}
            You skipped the spin, so your five played unmutated and no mutation spend was added.
          {:else}
            Cap Clash has no spin. Your five played unmutated and no mutation spend was added.
          {/if}
        </p>
      {:else}
        <div class="mt-2 flex items-center gap-2">
          <Sparkles size={15} class="shrink-0 text-accent" aria-hidden="true" />
          <p class="text-sm font-bold">{mutation.name}</p>
        </div>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{mutation.description}</p>
        <dl class="mt-3 grid grid-cols-2 gap-2">
          <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Spin type
            </dt>
            <dd class="text-xs font-extrabold capitalize">{spin.purchase}</dd>
          </div>
          <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Price
            </dt>
            <dd class="font-mono text-xs font-extrabold tabular-nums">
              {formatMillions(spin.priceDollars)}
            </dd>
          </div>
          <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Tier
            </dt>
            <dd class="font-mono text-xs font-extrabold tabular-nums">Tier {spin.tier}</dd>
          </div>
          <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Target
            </dt>
            <dd class="truncate text-xs font-extrabold">
              {spinTarget === null
                ? spin.targetCardId
                : `${spinTarget.displayName} · ${spinTarget.slot}`}
            </dd>
          </div>
        </dl>
      {/if}
    </section>
  </div>

  <section
    class="rounded-2xl border border-border bg-card p-4 sm:p-5"
    aria-label="Season player statistics"
  >
    <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
      Season statistics
    </h3>
    <div class="mt-3 overflow-x-auto">
      <table class="ui-stats-table text-[11px]">
        <caption class="sr-only"> Season totals and averages for the five signed slots </caption>
        <thead>
          <tr
            class="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
          >
            <th scope="col" class="px-2 py-1 text-left font-medium">Slot</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">GP</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Min</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Pts</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Reb</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Ast</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Stl</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">Blk</th>
            <th scope="col" class="px-2 py-1 text-right font-medium">TO</th>
          </tr>
        </thead>
        <tbody>
          {#each players as line (line.slot)}
            <tr class="border-b border-border/40">
              <th scope="row" class="max-w-44 truncate px-2 py-1 text-left font-semibold">
                <span
                  class="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  >{line.slot}</span
                >{line.displayName}
              </th>
              <td class="px-2 py-1 text-right font-mono">{line.gamesPlayed}</td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.minutes, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono font-bold">
                {formatAverage(line.points, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.rebounds, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.assists, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.steals, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.blocks, line.gamesPlayed)}
              </td>
              <td class="px-2 py-1 text-right font-mono">
                {formatAverage(line.turnovers, line.gamesPlayed)}
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="font-semibold">
            <th scope="row" class="px-2 py-1 text-left">Season totals</th>
            <td class="px-2 py-1 text-right font-mono">{aggregate.games}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('minutes')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('points')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('rebounds')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('assists')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('steals')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('blocks')}</td>
            <td class="px-2 py-1 text-right font-mono">{totalOf('turnovers')}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>

  <section class="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="League MVP">
    <h3 class="font-display text-base font-extrabold tracking-tight uppercase">League MVP</h3>
    {#if mvp === null}
      <p class="mt-2 text-xs text-muted-foreground">No league MVP was recorded for this run.</p>
    {:else}
      <div class="mt-2 flex flex-wrap items-center gap-2">
        {#if mvp.isUserTeam}
          <Crown size={16} class="shrink-0 text-accent" aria-hidden="true" />
        {/if}
        <p class="text-sm font-bold">{mvp.displayName}</p>
        <span class="font-mono text-[10px] text-muted-foreground uppercase">
          {mvp.teamName}{#if mvp.slot !== null}
            · {mvp.slot}{/if} · {mvp.appearances} GP
        </span>
        <span
          class="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] uppercase"
          >{mvp.isUserTeam ? 'Your lineup' : 'Opponent'}</span
        >
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            MVP score
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">{mvp.mvpScore.toFixed(2)}</dd>
        </div>
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Game score
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {mvp.averageGameScore.toFixed(1)}
          </dd>
        </div>
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Pts / Reb / Ast
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {mvp.averagePoints.toFixed(1)} / {mvp.averageRebounds.toFixed(1)} / {mvp.averageAssists.toFixed(
              1,
            )}
          </dd>
        </div>
        <div class="rounded-lg bg-surface-1 px-2.5 py-1.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            League baseline TS
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {report.leagueBaselineTs.toFixed(3)}
          </dd>
        </div>
      </dl>
      <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        The MVP covers your five slots and every frozen opponent using the shared background league
        schedule and formula.
        {#if report.hasMutationScoring}
          Mutation scoring is included, so your field is not a balanced comparison against ordinary
          opponents.
        {:else}
          No mutation scoring was recorded in this season.
        {/if}
      </p>
    {/if}
  </section>
</div>
