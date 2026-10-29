<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { getManifest, getPlayersIndex } from '#lib/data.js';
  import type { HoopRushManifest, PlayersIndex } from '@hoop-rush/data-contracts';
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
    formatShootingPercentage,
    initialsOf,
    recordLabel,
    variantLabel,
  } from './cap-rush-presentation.ts';

  let { report }: { report: CapRushReport } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let playerIndex = $state.raw<PlayersIndex | null>(null);
  onMount(() => {
    let mounted = true;
    void Promise.allSettled([getManifest(), getPlayersIndex()]).then(([branding, index]) => {
      if (!mounted) return;
      if (branding.status === 'fulfilled') manifest = branding.value;
      if (index.status === 'fulfilled') playerIndex = index.value;
    });
    return () => {
      mounted = false;
    };
  });

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

  const statColumns: PlayerStatColumn<CapRushPlayerSeasonLine>[] = [
    ...(
      [
        ['points', 'Pts'],
        ['rebounds', 'Reb'],
        ['assists', 'Ast'],
        ['steals', 'Stl'],
        ['blocks', 'Blk'],
        ['turnovers', 'TO'],
      ] as const
    ).map(([key, label]) => ({
      key,
      label,
      value: (line: CapRushPlayerSeasonLine) => formatAverage(line[key], line.gamesPlayed),
      ...(key === 'points' ? { cellClass: 'font-bold' } : {}),
    })),
    ...(
      [
        ['fieldGoals', 'FG%', 'fieldGoalsMade', 'fieldGoalsAttempted'],
        ['freeThrows', 'FT%', 'freeThrowsMade', 'freeThrowsAttempted'],
        ['threes', '3P%', 'threesMade', 'threesAttempted'],
      ] as const
    ).map(([key, label, made, attempted]) => ({
      key,
      label,
      value: (line: CapRushPlayerSeasonLine) =>
        formatShootingPercentage(line[made], line[attempted]),
    })),
  ];
  const statTotals = $derived({
    label: 'Season totals',
    value: (column: PlayerStatColumn<CapRushPlayerSeasonLine>) => {
      const shooting = {
        fieldGoals: ['fieldGoalsMade', 'fieldGoalsAttempted'],
        freeThrows: ['freeThrowsMade', 'freeThrowsAttempted'],
        threes: ['threesMade', 'threesAttempted'],
      } as const;
      const fields = shooting[column.key as keyof typeof shooting];
      if (fields) return formatShootingPercentage(totalOf(fields[0]), totalOf(fields[1]));
      return totalOf(
        column.key as 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers',
      );
    },
  });

  function totalOf(
    field:
      | 'points'
      | 'rebounds'
      | 'assists'
      | 'steals'
      | 'blocks'
      | 'turnovers'
      | 'fieldGoalsMade'
      | 'fieldGoalsAttempted'
      | 'freeThrowsMade'
      | 'freeThrowsAttempted'
      | 'threesMade'
      | 'threesAttempted',
  ): number {
    return players.reduce((total, line: CapRushPlayerSeasonLine) => total + line[field], 0);
  }
</script>

<div class="flex flex-col gap-4" data-cap-rush-report>
  {#if aggregate.perfectSeason}
    <div
      class="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-4 sm:p-5"
      role="status"
    >
      <Trophy size={22} class="shrink-0 text-accent" aria-hidden="true" />
      <div class="min-w-0">
        <p class="font-display text-lg font-extrabold tracking-tight uppercase text-accent">
          Perfect season Â· 82â€“0
        </p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          All {CAP_RUSH_GAME_COUNT} games won. No losses on the schedule.
        </p>
      </div>
    </div>
  {/if}

  <section
    class="report-hero rounded-2xl border border-border bg-card p-5 sm:p-7"
    aria-label="Final report"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          {variantLabel(report.variant)} Â· Season report
        </p>
        <h2
          class="font-display mt-2 text-7xl leading-none font-extrabold tracking-tight tabular-nums sm:text-8xl"
        >
          {recordLabel(aggregate.wins, aggregate.losses)}
          {#if aggregate.perfectSeason}
            <span class="text-accent">Â· 82â€“0</span>
          {/if}
        </h2>
        <p class="mt-3 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {aggregate.games} games Â· {aggregate.pointsFor} for Â· {aggregate.pointsAgainst} against
        </p>
      </div>
      <span
        class="inline-flex items-center rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {capStatusClass(
          report.payrollStatus,
        )}">{capStatusLabel(report.payrollStatus)}</span
      >
    </div>

    <dl class="mt-6 grid grid-cols-3 gap-3 border-t border-line-soft pt-5">
      <div>
        <dt class="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
          Points / game
        </dt>
        <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {formatAverage(aggregate.pointsFor, aggregate.games)}
        </dd>
      </div>
      <div>
        <dt class="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
          Allowed / game
        </dt>
        <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {formatAverage(aggregate.pointsAgainst, aggregate.games)}
        </dd>
      </div>
      <div>
        <dt class="font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
          Margin / game
        </dt>
        <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {formatAverage(aggregate.pointsFor - aggregate.pointsAgainst, aggregate.games)}
        </dd>
      </div>
    </dl>
    <dl
      class="mt-5 grid grid-cols-2 gap-2 border-t border-line-soft pt-5 {report.variant ===
      'roulette'
        ? 'lg:grid-cols-4'
        : 'lg:grid-cols-3'}"
    >
      <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-3 sm:p-4">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Player payroll
        </dt>
        <dd class="font-display mt-0.5 text-xl font-extrabold tabular-nums">
          {formatMillions(report.payrollDollars)}
        </dd>
      </div>
      {#if report.variant === 'roulette'}
        <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-3 sm:p-4">
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
      {/if}
      <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-3 sm:p-4">
        <dt class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          Total spend
        </dt>
        <dd class="font-display mt-0.5 text-xl font-extrabold tabular-nums">
          {formatMillions(report.totalSpendDollars)}
        </dd>
      </div>
      <div class="min-w-0 rounded-xl border border-line-soft bg-surface-1 p-3 sm:p-4">
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
      Player payroll is the five salaries only. {#if report.variant === 'roulette'}Mutation spend is
        the spin price, and total spend adds the two.{/if}
      Unused normal-cap budget is what is left under the $120M cap.
    </p>

    <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line-soft pt-4">
      <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
        Efficiency
      </p>
      <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
        {winsPerMillion === null ? 'â€”' : winsPerMillion.toFixed(2)}
      </p>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        wins per $1M of player payroll
        <span class="font-mono"
          >Â· {aggregate.wins} wins Ã· {formatMillions(report.payrollDollars)}</span
        >
      </p>
    </div>
  </section>

  <section class="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-label="Your five">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          The roster
        </p>
        <h3 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
          Your starting five
        </h3>
      </div>
      <p class="text-xs text-muted-foreground">
        Player payroll <strong class="font-display ml-1 text-lg text-foreground"
          >{formatMillions(report.payrollDollars)}</strong
        >
      </p>
    </div>
    <ul class="report-player-grid">
      {#each players as line (line.slot)}
        {@const face = playerIndex?.players.find((entry) => entry.playerId === line.playerId)}
        <li class="report-player">
          <div class="report-player-top">
            <span>{line.slot}</span>{#if line.slot === report.targetSlot}<span class="report-target"
                ><Crown size={12} aria-hidden="true" /> Target</span
              >{/if}
          </div>
          <div class="report-portrait">
            {#if manifest && face}
              <PlayerFace
                player={face}
                {manifest}
                size="xl"
                fallbackInitials={initialsOf(line.displayName)}
              />
            {:else}
              <span class="report-initials" aria-hidden="true">{initialsOf(line.displayName)}</span>
            {/if}
          </div>
          <div class="report-player-info">
            <h4>{line.displayName}</h4>
            <p>{formatMillions(line.salaryDollars)} &middot; {line.gamesPlayed} GP</p>
            <dl class="report-player-stats">
              <div>
                <dt>PTS</dt>
                <dd>{formatAverage(line.points, line.gamesPlayed)}</dd>
              </div>
              <div>
                <dt>REB</dt>
                <dd>{formatAverage(line.rebounds, line.gamesPlayed)}</dd>
              </div>
              <div>
                <dt>AST</dt>
                <dd>{formatAverage(line.assists, line.gamesPlayed)}</dd>
              </div>
            </dl>
          </div>
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-[11px] text-muted-foreground">
      Per-game averages &middot; Target is the highest-paid player.
    </p>
  </section>

  <div class="grid gap-4 {report.variant === 'roulette' ? 'lg:grid-cols-2' : ''}">
    <section
      class="rounded-2xl border border-border bg-card p-5 sm:p-7"
      aria-label="Cap status and applied penalties"
    >
      <h3 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Cap status Â· {capStatusLabel(report.payrollStatus)}
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
                <td class="px-2 py-1 text-right font-mono text-primary">âˆ’{row.reduction}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <dl class="mt-3 grid grid-cols-2 gap-2">
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Forced isolations
          </dt>
          <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
            {report.apronTriggers.isolations}
          </dd>
        </div>
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Defensive strikes
          </dt>
          <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
            {report.apronTriggers.strikes}
          </dd>
        </div>
      </dl>
    </section>

    {#if report.variant === 'roulette'}
      <section
        class="rounded-2xl border border-border bg-card p-5 sm:p-7"
        aria-label="Cap Roulette spin"
      >
        <p class="report-label">The wild card</p>
        <h3 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
          Mutation spin
        </h3>
        {#if spin === null || mutation === null}
          <p class="mt-4 text-lg font-bold">No spin purchased</p>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
            You skipped the spin, so your five played unmutated and no mutation spend was added.
          </p>
        {:else}
          <div class="mt-2 flex items-center gap-2">
            <Sparkles size={15} class="shrink-0 text-accent" aria-hidden="true" />
            <p class="text-sm font-bold">{mutation.name}</p>
          </div>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{mutation.description}</p>
          <dl class="mt-3 grid grid-cols-2 gap-2">
            <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Spin type
              </dt>
              <dd class="text-xs font-extrabold capitalize">{spin.purchase}</dd>
            </div>
            <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Price
              </dt>
              <dd class="font-mono text-xs font-extrabold tabular-nums">
                {formatMillions(spin.priceDollars)}
              </dd>
            </div>
            <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Tier
              </dt>
              <dd class="font-mono text-xs font-extrabold tabular-nums">Tier {spin.tier}</dd>
            </div>
            <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
              <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
                Target
              </dt>
              <dd class="truncate text-xs font-extrabold">
                {spinTarget === null
                  ? spin.targetCardId
                  : `${spinTarget.displayName} Â· ${spinTarget.slot}`}
              </dd>
            </div>
          </dl>
        {/if}
      </section>
    {/if}
  </div>

  <section
    class="rounded-2xl border border-border bg-card p-5 sm:p-7"
    aria-label="Season player statistics"
  >
    <p class="report-label">The box score</p>
    <h3 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
      Season statistics
    </h3>
    <p class="mt-1 text-xs text-muted-foreground">
      Per-game averages and shooting percentages, with season totals below.
    </p>
    <div class="mt-4 overflow-x-auto rounded-xl border border-line-soft bg-surface-1">
      <PlayerStatsTable
        columns={statColumns}
        rows={players}
        rowKey={(line) => line.slot}
        totals={statTotals}
        caption="Season totals and averages for the five signed slots"
        tableClass="min-w-[720px] text-xs"
        headClass="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
        rowClass={() => 'border-b border-border/40'}
        playerCellClass="px-3 py-2 text-left font-semibold"
        playerHeadCellClass="px-2 py-1 text-left font-medium"
        headCellClass="px-2 py-1 text-right font-medium"
        statCellClass="px-2 py-1 text-right font-mono"
        footClass="font-semibold"
        playerTotalCellClass="px-2 py-1 text-left"
        totalCellClass="px-2 py-1 text-right font-mono"
      >
        {#snippet identity(line)}
          {@const face = playerIndex?.players.find((entry) => entry.playerId === line.playerId)}
          <div class="flex min-w-40 items-center gap-2">
            {#if manifest && face}
              <PlayerFace
                player={face}
                {manifest}
                size="sm"
                fallbackInitials={initialsOf(line.displayName)}
              />
            {:else}
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs text-muted-foreground"
                >{initialsOf(line.displayName)}</span
              >
            {/if}
            <span
              ><span class="block">{line.displayName}</span><span
                class="font-mono text-[9px] text-muted-foreground">{line.slot}</span
              ></span
            >
          </div>
        {/snippet}
      </PlayerStatsTable>
    </div>
  </section>

  <section class="rounded-2xl border border-border bg-card p-5 sm:p-7" aria-label="League MVP">
    <p class="report-label">Season honors</p>
    <h3 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">League MVP</h3>
    {#if mvp === null}
      <p class="mt-2 text-xs text-muted-foreground">No league MVP was recorded for this run.</p>
    {:else}
      {@const mvpFace = playerIndex?.players.find((entry) => entry.playerId === mvp.playerId)}
      <div class="mvp-feature mt-4">
        <div class="mvp-portrait">
          {#if manifest && mvpFace}
            <PlayerFace
              player={mvpFace}
              {manifest}
              size="xl"
              fallbackInitials={initialsOf(mvp.displayName)}
            />
          {:else}
            <span class="report-initials" aria-hidden="true">{initialsOf(mvp.displayName)}</span>
          {/if}
        </div>
        <div class="min-w-0">
          <p class="report-label">
            {mvp.isUserTeam ? 'Your lineup' : 'Opponent'} &middot; {mvp.appearances} GP
          </p>
          <p class="font-display mt-1 text-3xl leading-tight font-extrabold tracking-tight">
            {mvp.displayName}
          </p>
          <p class="mt-1 text-xs text-muted-foreground">
            {mvp.teamName}{#if mvp.slot !== null}
              &middot; {mvp.slot}{/if}
          </p>
        </div>
        <dl class="mvp-production">
          <div>
            <dt>PTS</dt>
            <dd>{mvp.averagePoints.toFixed(1)}</dd>
          </div>
          <div>
            <dt>REB</dt>
            <dd>{mvp.averageRebounds.toFixed(1)}</dd>
          </div>
          <div>
            <dt>AST</dt>
            <dd>{mvp.averageAssists.toFixed(1)}</dd>
          </div>
        </dl>
      </div>
      <dl class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            MVP score
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">{mvp.mvpScore.toFixed(2)}</dd>
        </div>
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Game score
          </dt>
          <dd class="font-mono text-xs font-extrabold tabular-nums">
            {mvp.averageGameScore.toFixed(1)}
          </dd>
        </div>
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
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
        {:else if report.variant === 'roulette'}
          No mutation scoring was recorded in this season.
        {/if}
      </p>
    {/if}
  </section>
</div>

<style>
  .report-label {
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .mvp-feature {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.25rem;
    overflow: hidden;
    padding: 1rem 1.25rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background:
      radial-gradient(
        ellipse at left,
        color-mix(in srgb, var(--color-accent) 14%, transparent),
        transparent 65%
      ),
      var(--color-surface-1);
  }
  .mvp-portrait :global(> div) {
    background: transparent;
  }
  .mvp-production {
    display: flex;
    gap: 1.5rem;
    margin-left: auto;
  }
  .mvp-production dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .mvp-production dd {
    margin-top: 0.25rem;
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 600px) {
    .mvp-production {
      width: 100%;
      margin-left: 0;
    }
  }

  .report-player-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.6rem;
    margin-top: 1.25rem;
  }
  .report-player {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }
  .report-player-top {
    display: flex;
    justify-content: space-between;
    gap: 0.25rem;
    padding: 0.65rem 0.75rem 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .report-target {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--color-accent);
  }
  .report-portrait {
    display: grid;
    place-items: end center;
    height: 110px;
    background: radial-gradient(
      ellipse at center bottom,
      color-mix(in srgb, var(--color-primary) 20%, transparent),
      transparent 70%
    );
  }
  .report-portrait :global(> div) {
    background: transparent;
  }
  .report-initials {
    display: grid;
    width: 6rem;
    height: 6rem;
    place-items: center;
    color: var(--color-muted-foreground);
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
  }
  .report-player-info {
    padding: 0.75rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .report-player-info h4 {
    min-height: 2.5em;
    font-size: 0.85rem;
    font-weight: 800;
    line-height: 1.25;
  }
  .report-player-info > p {
    margin-top: 0.3rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .report-player-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
    margin-top: 0.8rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .report-player-stats dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .report-player-stats dd {
    margin-top: 0.2rem;
    font-size: 0.85rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 700px) {
    .report-player-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .report-hero {
    border-top: 3px solid var(--color-primary);
    background-image: radial-gradient(
      ellipse at top right,
      color-mix(in srgb, var(--color-primary) 12%, transparent),
      transparent 55%
    );
  }
</style>
