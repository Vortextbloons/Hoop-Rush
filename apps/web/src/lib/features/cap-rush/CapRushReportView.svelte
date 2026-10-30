<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { getManifest, getPlayersIndex } from '#lib/data.js';
  import type { HoopRushManifest, PlayersIndex } from '@hoop-rush/data-contracts';
  import {
    POSITIONS,
    capRushConferenceRoundName,
    capRushRoundName,
    type CapRushPlayerSeasonLine,
    type CapRushReport,
  } from '@hoop-rush/data-contracts';
  import { havocMutationDefinitionOf } from '@hoop-rush/engine';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import CapRushBracket from './CapRushBracket.svelte';
  import { Crown, Trophy } from '@lucide/svelte';
  import { trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
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
  const spins = $derived(
    report.spin === null ? [] : [report.spin, ...(report.additionalSpins ?? [])],
  );
  const aggregate = $derived(report.aggregate);
  const winsPerMillion = $derived(report.winsPerMillion);
  const mvp = $derived(report.mvp);
  const postseason = $derived(report.postseason ?? null);
  const roundName = $derived(
    postseason !== null && 'format' in postseason && postseason.format === 'conference'
      ? capRushConferenceRoundName
      : capRushRoundName,
  );
  const finalsMvpFace = $derived(
    postseason === null
      ? null
      : (playerIndex?.players.find((entry) => entry.playerId === postseason.finalsMvp.playerId) ??
          null),
  );
  const teamUsagePossessions = $derived(
    usagePossessions(
      totalOf('fieldGoalsAttempted'),
      totalOf('freeThrowsAttempted'),
      totalOf('turnovers'),
    ),
  );

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
    {
      key: 'trueShooting',
      label: 'TS%',
      value: (line: CapRushPlayerSeasonLine) =>
        trueShootingPct(line.points, line.fieldGoalsAttempted, line.freeThrowsAttempted),
    },
    {
      key: 'usage',
      label: 'USG%',
      value: (line: CapRushPlayerSeasonLine) =>
        usagePct(
          usagePossessions(line.fieldGoalsAttempted, line.freeThrowsAttempted, line.turnovers),
          teamUsagePossessions,
        ),
    },
  ];
  const statTotals = $derived({
    label: 'Season totals',
    value: (column: PlayerStatColumn<CapRushPlayerSeasonLine>) => {
      if (column.key === 'trueShooting') {
        return trueShootingPct(
          totalOf('points'),
          totalOf('fieldGoalsAttempted'),
          totalOf('freeThrowsAttempted'),
        );
      }
      if (column.key === 'usage') {
        return usagePct(teamUsagePossessions, teamUsagePossessions);
      }
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
          Perfect season &middot; 82&ndash;0
        </p>
      </div>
    </div>
  {/if}

  {#if postseason !== null}
    <section
      class="rounded-2xl border p-5 sm:p-7 {postseason.isUserChampion
        ? 'border-accent/50 bg-accent/10'
        : 'border-border bg-card'}"
      aria-label="Postseason result"
    >
      <div class="flex flex-wrap items-center gap-4">
        <Trophy
          size={34}
          class="shrink-0 {postseason.isUserChampion ? 'text-accent' : 'text-muted-foreground'}"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p
            class="font-mono text-[10px] font-bold tracking-[0.16em] uppercase {postseason.isUserChampion
              ? 'text-accent'
              : 'text-muted-foreground'}"
          >
            {postseason.isUserChampion ? 'Cap Rush champion' : 'Champion'}
          </p>
          <h2 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
            {postseason.championName}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {#if postseason.isUserChampion}
              Your five won four best-of-seven rounds.
            {:else if postseason.userOutcome.status === 'not-qualified'}
              Your {recordLabel(aggregate.wins, aggregate.losses)} regular season missed the top
              {'format' in postseason && postseason.format === 'conference' ? 'eight' : 'sixteen'}.
            {:else}
              Your run ended in the {postseason.userOutcome.round === null
                ? 'postseason'
                : roundName(postseason.userOutcome.round).toLowerCase()}. The bracket finished
              without you.
            {/if}
          </p>
        </div>
        {#if postseason.seed !== null}
          <span
            class="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] font-bold text-primary uppercase"
            >Your seed · {postseason.seed}</span
          >
        {/if}
      </div>
    </section>

    <section class="rounded-2xl border border-accent/40 bg-card p-5 sm:p-7" aria-label="Finals MVP">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
        Finals MVP
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-4">
        <div class="shrink-0">
          {#if manifest && finalsMvpFace}
            <PlayerFace
              player={finalsMvpFace}
              {manifest}
              size="xl"
              fallbackInitials={initialsOf(postseason.finalsMvp.displayName)}
            />
          {:else}
            <span
              class="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-3 font-display text-xl font-extrabold"
              aria-hidden="true">{initialsOf(postseason.finalsMvp.displayName)}</span
            >
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {postseason.finalsMvp.displayName}
          </h3>
          <p class="font-mono text-[10px] text-muted-foreground uppercase">
            {postseason.finalsMvp.slot} · {postseason.championName} · {postseason.finalsMvp.games}
            Finals games
          </p>
          <dl class="mt-3 grid grid-cols-4 gap-2">
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">PTS</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(postseason.finalsMvp.totalPoints, postseason.finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">REB</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(postseason.finalsMvp.totalRebounds, postseason.finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">AST</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(postseason.finalsMvp.totalAssists, postseason.finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">Game score</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(postseason.finalsMvp.totalGameScore, postseason.finalsMvp.games)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p class="mt-3 text-[11px] text-muted-foreground">
        Cumulative Finals game score
        <strong class="text-foreground">{postseason.finalsMvp.totalGameScore.toFixed(1)}</strong>.
        Ranked by cumulative Finals game score, then Finals points, assists, rebounds and stable
        player ID.
      </p>
    </section>

    <CapRushBracket
      series={postseason.series}
      standings={postseason.standings}
      {manifest}
      userTeamId={report.franchise?.franchiseId ?? null}
    />
  {:else}
    <p class="rounded-2xl border border-line-soft bg-surface-1 p-4 text-xs text-muted-foreground">
      This is a regular-season run. It was played before Cap Rush postseasons existed, so it has no
      bracket or Finals MVP.
    </p>
  {/if}

  <section
    class="report-hero rounded-2xl border border-border bg-card p-5 sm:p-7"
    aria-label="Final report"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          {variantLabel(report.variant)} &middot; Season report
        </p>
        <h2
          class="font-display mt-2 text-7xl leading-none font-extrabold tracking-tight tabular-nums sm:text-8xl"
        >
          {recordLabel(aggregate.wins, aggregate.losses)}
          {#if aggregate.perfectSeason}
            <span class="text-accent">&middot; 82&ndash;0</span>
          {/if}
        </h2>
        <p class="mt-3 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {aggregate.games} games &middot; {aggregate.pointsFor} for &middot; {aggregate.pointsAgainst}
          against
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

    <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line-soft pt-4">
      <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
        Efficiency
      </p>
      <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
        {winsPerMillion === null ? '\u2014' : winsPerMillion.toFixed(2)}
      </p>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        wins per $1M of player payroll
        <span class="font-mono"
          >&middot; {aggregate.wins} wins &divide; {formatMillions(report.payrollDollars)}</span
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
              <div>
                <dt>TS%</dt>
                <dd>
                  {trueShootingPct(line.points, line.fieldGoalsAttempted, line.freeThrowsAttempted)}
                </dd>
              </div>
              <div>
                <dt>USG%</dt>
                <dd>
                  {usagePct(
                    usagePossessions(
                      line.fieldGoalsAttempted,
                      line.freeThrowsAttempted,
                      line.turnovers,
                    ),
                    teamUsagePossessions,
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <div class="grid gap-4">
    <section
      class="rounded-2xl border border-border bg-card p-5 sm:p-7"
      aria-label="Cap status and applied penalties"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="report-label">Payroll impact</p>
          <h3 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
            Cap status
          </h3>
        </div>
        <span
          class="inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.1em] uppercase {capStatusClass(
            report.payrollStatus,
          )}">{capStatusLabel(report.payrollStatus)}</span
        >
      </div>
      <div class="mt-4 rounded-xl border border-line-soft bg-surface-1 p-4">
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Applied penalties
        </p>
        <p class="mt-1 text-sm font-bold">{apronPenaltyTitle(report.payrollStatus)}</p>
        {#if penaltyRows.length > 0}
          <dl class="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {#each penaltyRows as row (row.label)}
              <div class="flex items-center justify-between gap-3 border-t border-line-soft py-2">
                <dt class="text-xs font-semibold">{row.label}</dt>
                <dd
                  class="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary tabular-nums"
                >
                  &minus;{row.reduction}
                </dd>
              </div>
            {/each}
          </dl>
        {/if}
      </div>
      <div class="mt-4">
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Season effects
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-2">
          <div class="rounded-xl border border-line-soft px-3 py-3">
            <dt class="text-xs text-muted-foreground">Forced isolations</dt>
            <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
              {report.apronTriggers.isolations.toLocaleString()}
            </dd>
          </div>
          <div class="rounded-xl border border-line-soft px-3 py-3">
            <dt class="text-xs text-muted-foreground">Defensive strikes</dt>
            <dd class="font-display mt-1 text-2xl font-extrabold tabular-nums">
              {report.apronTriggers.strikes.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
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
        {#if spins.length === 0}
          <p class="mt-4 text-lg font-bold">No spin purchased</p>
        {:else}
          <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each spins as spin (spin.targetCardId)}
              {@const mutation = havocMutationDefinitionOf(spin.mutationId)}
              {@const spinTarget =
                players.find((line) => line.cardId === spin.targetCardId) ?? null}
              <details class="group min-w-0 rounded-xl border border-line-soft bg-surface-1 p-3">
                <summary
                  class="cursor-pointer list-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span class="flex items-start justify-between gap-2">
                    <span class="min-w-0">
                      <span class="block text-sm font-bold">{mutation.name}</span>
                      <span class="mt-1 block text-xs text-muted-foreground"
                        >{spinTarget === null
                          ? spin.targetCardId
                          : `${spinTarget.displayName} - ${spinTarget.slot}`}</span
                      >
                    </span>
                    <HavocTierBadge tier={spin.tier} size="sm" />
                  </span>
                  <span
                    class="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span
                      ><span class="capitalize">{spin.purchase}</span> &middot; {formatMillions(
                        spin.priceDollars,
                      )}</span
                    >
                    <span class="font-semibold text-primary group-open:hidden">Show details</span>
                    <span class="hidden font-semibold text-primary group-open:inline"
                      >Hide details</span
                    >
                  </span>
                </summary>
                <div
                  class="mt-3 border-t border-line-soft pt-3 text-xs leading-relaxed text-muted-foreground"
                >
                  <p>{mutation.description}</p>
                  {#if mutation.downside}<p class="mt-2 text-destructive">
                      Downside: {mutation.downside}
                    </p>{/if}
                </div>
              </details>
            {/each}
          </div>
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
      Season statistics <span class="text-sm text-muted-foreground">&middot; per game</span>
    </h3>
    <div class="mt-4 overflow-x-auto rounded-xl border border-line-soft bg-surface-1">
      <PlayerStatsTable
        columns={statColumns}
        rows={players}
        rowKey={(line) => line.slot}
        totals={statTotals}
        caption="Season totals and averages for the five signed slots"
        tableClass="min-w-[860px] text-xs"
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
