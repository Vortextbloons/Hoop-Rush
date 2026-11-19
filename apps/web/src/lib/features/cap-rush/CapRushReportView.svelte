<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import { getManifest, getPlayersIndex } from '#lib/data.js';
  import type { HoopRushManifest, PlayersIndex } from '@hoop-rush/data-contracts';
  import {
    POSITIONS,
    capRushConferenceRoundName,
    type CapRushPlayerSeasonLine,
    type CapRushReport,
  } from '@hoop-rush/data-contracts';
  import { capRushPostseasonPlayerStats, havocMutationDefinitionOf } from '@hoop-rush/engine';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
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
  const roundName = capRushConferenceRoundName;
  const finalsMvpFace = $derived(
    postseason === null
      ? null
      : (playerIndex?.players.find((entry) => entry.playerId === postseason.finalsMvp.playerId) ??
          null),
  );
  type StatsPhase = 'regular' | 'postseason';
  type StatsView = StatsPhase | 'compare';
  type StatsRow = CapRushPlayerSeasonLine & { phase: StatsPhase };

  const statsOptions: readonly { value: StatsView; label: string }[] = [
    { value: 'regular', label: 'Regular season' },
    { value: 'postseason', label: 'Postseason' },
    { value: 'compare', label: 'Compare' },
  ];
  let statsView = $state<StatsView>('regular');
  const playoffStats = $derived(
    postseason === null
      ? null
      : capRushPostseasonPlayerStats({
          players,
          games: postseason.series.flatMap((series) => series.games),
        }),
  );
  const postseasonMessage = $derived(
    postseason?.userOutcome.status === 'not-qualified'
      ? 'Your team did not qualify for the postseason.'
      : 'Postseason box scores are unavailable for this run.',
  );
  const regularRows = $derived(players.map((line): StatsRow => ({ ...line, phase: 'regular' })));
  const playoffRows = $derived(
    (playoffStats?.players ?? [])
      .map((line): StatsRow => ({ ...line, phase: 'postseason' }))
      .sort((left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot)),
  );
  const comparing = $derived(statsView === 'compare' && playoffStats !== null);
  const statRows = $derived.by(() => {
    if (statsView === 'postseason') return playoffRows;
    if (!comparing) return regularRows;
    return [...regularRows, ...playoffRows].sort(
      (left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot),
    );
  });
  const usageByPhase = $derived({
    regular: teamUsageOf(regularRows),
    postseason: teamUsageOf(playoffRows),
  });

  const statColumns: PlayerStatColumn<StatsRow>[] = [
    { key: 'gamesPlayed', label: 'GP', value: (line) => line.gamesPlayed },
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
      value: (line) =>
        usagePct(
          usagePossessions(line.fieldGoalsAttempted, line.freeThrowsAttempted, line.turnovers),
          usageByPhase[line.phase],
        ),
    },
  ];
  const statTotals = $derived([
    ...(statsView === 'postseason'
      ? []
      : [totalsFor('Regular-season totals', regularRows, aggregate.games, usageByPhase.regular)]),
    ...(playoffStats !== null && statsView !== 'regular'
      ? [totalsFor('Postseason totals', playoffRows, playoffStats.games, usageByPhase.postseason)]
      : []),
  ]);

  function totalsFor(
    label: string,
    rows: readonly StatsRow[],
    games: number,
    teamUsage: number,
  ): PlayerStatsTotals<StatsRow> {
    return {
      label,
      value: (column) => {
        if (column.key === 'gamesPlayed') return games;
        if (column.key === 'trueShooting') {
          return trueShootingPct(
            totalOf(rows, 'points'),
            totalOf(rows, 'fieldGoalsAttempted'),
            totalOf(rows, 'freeThrowsAttempted'),
          );
        }
        if (column.key === 'usage') return usagePct(teamUsage, teamUsage);
        const shooting = {
          fieldGoals: ['fieldGoalsMade', 'fieldGoalsAttempted'],
          freeThrows: ['freeThrowsMade', 'freeThrowsAttempted'],
          threes: ['threesMade', 'threesAttempted'],
        } as const;
        const fields = shooting[column.key as keyof typeof shooting];
        if (fields)
          return formatShootingPercentage(totalOf(rows, fields[0]), totalOf(rows, fields[1]));
        return totalOf(
          rows,
          column.key as 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers',
        );
      },
    };
  }

  function teamUsageOf(rows: readonly StatsRow[]): number {
    return usagePossessions(
      totalOf(rows, 'fieldGoalsAttempted'),
      totalOf(rows, 'freeThrowsAttempted'),
      totalOf(rows, 'turnovers'),
    );
  }

  function totalOf(
    rows: readonly StatsRow[],
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
    return rows.reduce((total, line) => total + line[field], 0);
  }
</script>

<div class="flex flex-col gap-4" data-cap-rush-report>
  {#if aggregate.perfectSeason}
    <Alert tone="warning" title="Perfect season &middot; 82&ndash;0" class="rounded-2xl p-4 sm:p-5">
      {#snippet icon()}<Trophy size={22} aria-hidden="true" />{/snippet}
    </Alert>
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
          <p class="ui-label {postseason.isUserChampion ? 'text-accent' : 'text-muted-foreground'}">
            {postseason.isUserChampion ? 'Cap Rush champion' : 'Champion'}
          </p>
          <h2 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase">
            {postseason.championName}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            {#if postseason.isUserChampion}
              Your five won four best-of-seven rounds.
            {:else if postseason.userOutcome.status === 'not-qualified'}
              Your {recordLabel(aggregate.wins, aggregate.losses)} regular season missed the top eight.
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
      {#if postseason.isUserChampion}
        <AchievementReveal bindingId={`cap-rush:${report.runId}`} />
      {/if}
    </section>

    <Panel as="section" padding="none" class="border-accent/40 p-5 sm:p-7" aria-label="Finals MVP">
      <p class="ui-label text-accent">Finals MVP</p>
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
          <StatGrid class="mt-3" columns={4} mobile={2}>
            <StatTile
              label="PTS"
              size="sm"
              value={formatAverage(postseason.finalsMvp.totalPoints, postseason.finalsMvp.games)}
            />
            <StatTile
              label="REB"
              size="sm"
              value={formatAverage(postseason.finalsMvp.totalRebounds, postseason.finalsMvp.games)}
            />
            <StatTile
              label="AST"
              size="sm"
              value={formatAverage(postseason.finalsMvp.totalAssists, postseason.finalsMvp.games)}
            />
            <StatTile
              label="Game score"
              size="sm"
              value={formatAverage(postseason.finalsMvp.totalGameScore, postseason.finalsMvp.games)}
            />
          </StatGrid>
        </div>
      </div>
      <p class="mt-3 text-[11px] text-muted-foreground">
        Cumulative Finals game score
        <strong class="text-foreground">{postseason.finalsMvp.totalGameScore.toFixed(1)}</strong>.
        Ranked by cumulative Finals game score, then Finals points, assists, rebounds and stable
        player ID.
      </p>
    </Panel>

    <CapRushBracket
      series={postseason.series}
      standings={postseason.standings}
      {manifest}
      userTeamId={report.franchise?.franchiseId ?? null}
    />
  {:else}
    <Alert tone="info" class="rounded-2xl">
      This is a regular-season run. It was played before Cap Rush postseasons existed, so it has no
      bracket or Finals MVP.
    </Alert>
  {/if}

  <Panel as="section" padding="none" class="report-hero p-5 sm:p-7" aria-label="Final report">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="ui-label">
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

    <StatGrid class="mt-6 border-t border-line-soft pt-5" columns={3} mobile={3} gap="md">
      <StatTile
        label="Points / game"
        size="lg"
        value={formatAverage(aggregate.pointsFor, aggregate.games)}
      />
      <StatTile
        label="Allowed / game"
        size="lg"
        value={formatAverage(aggregate.pointsAgainst, aggregate.games)}
      />
      <StatTile
        label="Margin / game"
        size="lg"
        value={formatAverage(aggregate.pointsFor - aggregate.pointsAgainst, aggregate.games)}
      />
    </StatGrid>
    <StatGrid
      class="mt-5 border-t border-line-soft pt-5"
      columns={report.variant === 'roulette' ? 4 : 3}
      mobile={2}
      gap="md"
    >
      <StatTile
        label="Player payroll"
        size="md"
        surface="tile"
        value={formatMillions(report.payrollDollars)}
      />
      {#if report.variant === 'roulette'}
        <StatTile
          label="Mutation spend"
          size="md"
          surface="tile"
          tone={report.spinSpendDollars === 0 ? 'muted' : 'default'}
          value={report.spinSpendDollars === 0 ? 'None' : formatMillions(report.spinSpendDollars)}
        />
      {/if}
      <StatTile
        label="Total spend"
        size="md"
        surface="tile"
        value={formatMillions(report.totalSpendDollars)}
      />
      <StatTile
        label="Unused normal-cap budget"
        size="md"
        surface="tile"
        tone={report.unusedCapDollars < 0 ? 'negative' : 'default'}
        value={formatMillions(report.unusedCapDollars)}
      />
    </StatGrid>

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
  </Panel>

  <Panel as="section" class="p-5 sm:p-7" aria-label="Your five">
    <SectionHeading eyebrow="The roster" title="Your starting five" level={3} size="lg">
      {#snippet actions()}
        <p class="text-xs text-muted-foreground">
          Player payroll <strong class="font-display ml-1 text-lg text-foreground"
            >{formatMillions(report.payrollDollars)}</strong
          >
        </p>
      {/snippet}
    </SectionHeading>
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
                    usageByPhase.regular,
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </li>
      {/each}
    </ul>
  </Panel>

  <div class="grid gap-4">
    <Panel as="section" class="p-5 sm:p-7" aria-label="Cap status and applied penalties">
      <SectionHeading eyebrow="Payroll impact" title="Cap status" level={3} align="start">
        {#snippet actions()}
          <span
            class="inline-flex rounded-full border px-3 py-1 font-mono text-[10px] font-bold tracking-[0.1em] uppercase {capStatusClass(
              report.payrollStatus,
            )}">{capStatusLabel(report.payrollStatus)}</span
          >
        {/snippet}
      </SectionHeading>
      <Panel padding="none" class="mt-4 p-4">
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Applied penalties
        </p>
        <p class="mt-1 text-sm font-bold">{apronPenaltyTitle(report.payrollStatus)}</p>
        {#if report.payrollStatus === 'first-apron' || report.payrollStatus === 'second-apron'}
          <p class="mt-1 text-xs text-muted-foreground">
            Intercepted passes are not included in season effect totals.
          </p>
        {/if}
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
      </Panel>
      {#if report.apronTriggers.isolations > 0 || report.payrollStatus === 'second-apron' || report.apronTriggers.strikes > 0}
        <div class="mt-4">
          <p class="ui-label" data-tone="muted">Season effects</p>
          <StatGrid class="mt-2" columns={2} mobile={1}>
            {#if report.apronTriggers.isolations > 0}
              <StatTile
                label="Forced isolations"
                size="lg"
                surface="tile"
                value={report.apronTriggers.isolations.toLocaleString()}
              />
            {/if}
            {#if report.payrollStatus === 'second-apron' || report.apronTriggers.strikes > 0}
              <StatTile
                label="Defensive strikes"
                size="lg"
                surface="tile"
                value={report.apronTriggers.strikes.toLocaleString()}
              />
            {/if}
          </StatGrid>
        </div>
      {/if}
    </Panel>

    {#if report.variant === 'roulette'}
      <Panel as="section" class="p-5 sm:p-7" aria-label="Cap Roulette spin">
        <SectionHeading eyebrow="The wild card" title="Mutation spin" level={3} />
        {#if spins.length === 0}
          <EmptyState class="mt-4" title="No spin purchased" surface="none" />
        {:else}
          <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each spins as spin (spin.targetCardId)}
              {@const mutation = havocMutationDefinitionOf(spin.mutationId)}
              {@const spinTarget =
                players.find((line) => line.cardId === spin.targetCardId) ?? null}
              <details class="ui-panel group min-w-0 p-3" data-padding="none">
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
                      ><span
                        >{spin.purchase === 'standard' ? 'Mutation Spark' : 'Mutation Surge'}</span
                      >
                      &middot; {formatMillions(spin.priceDollars)}</span
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
                  {#if spinTarget !== null}
                    <p class="mb-2 font-bold text-primary">
                      {spinTarget.adjustments > 0 ? '+' : ''}{spinTarget.adjustments} direct mutation
                      points
                    </p>
                    <p class="mb-2">
                      Recorded scoring adjustments for this player across all their powers. Rating
                      effects are described below.
                    </p>
                  {/if}
                  <p>{mutation.description}</p>
                  {#each spin.additionalMutationIds ?? [] as mutationId (mutationId)}
                    {@const extra = havocMutationDefinitionOf(mutationId)}
                    <p class="mt-2 font-bold">{extra.name}</p>
                    <p>{extra.description}</p>
                    {#if extra.downside}<p class="mt-2 text-destructive">
                        Downside: {extra.downside}
                      </p>{/if}
                  {/each}
                  {#if mutation.downside}<p class="mt-2 text-destructive">
                      Downside: {mutation.downside}
                    </p>{/if}
                </div>
              </details>
            {/each}
          </div>
        {/if}
      </Panel>
    {/if}
  </div>

  <Panel as="section" padding="md" class="sm:p-7" aria-label="Season player statistics">
    <SectionHeading eyebrow="The box score" title="Season statistics" level={3}>
      <span class="text-sm text-muted-foreground">&middot; per game</span>
    </SectionHeading>
    <SegmentedControl
      class="mt-4"
      options={statsOptions}
      value={statsView}
      onchange={(view) => (statsView = view)}
      label="Statistics split"
    />
    {#if statsView !== 'regular' && playoffStats === null}
      <p class="mt-3 text-sm text-muted-foreground" role="status">{postseasonMessage}</p>
    {/if}
    {#if statRows.length > 0}
      <Panel padding="none" class="mt-4 overflow-x-auto">
        <PlayerStatsTable
          columns={statColumns}
          rows={statRows}
          rowKey={(line) => `${line.slot}:${line.phase}`}
          totals={statTotals}
          caption={`${comparing ? 'Regular season and postseason' : statsView === 'postseason' ? 'Postseason' : 'Regular season'} totals and averages for the five signed slots`}
          tableClass="min-w-[860px] text-xs"
          headClass="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
          rowClass={(line) => {
            if (!comparing) return 'border-b border-border/40';
            return line.phase === 'postseason' ? 'border-b border-border/60 bg-surface-2' : '';
          }}
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
            {#if comparing && line.phase === 'postseason'}
              <span class="sr-only">{line.displayName} {line.slot}</span>
              <span class="pl-11 font-mono text-[9px] text-muted-foreground">Postseason</span>
            {:else}
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
                    class="font-mono text-[9px] text-muted-foreground"
                    >{line.slot}{comparing ? ' · Regular season' : ''}</span
                  ></span
                >
              </div>
            {/if}
          {/snippet}
        </PlayerStatsTable>
      </Panel>
    {/if}
  </Panel>

  <Panel as="section" padding="md" class="sm:p-7" aria-label="League MVP">
    <SectionHeading eyebrow="Season honors" title="League MVP" level={3} />
    {#if mvp === null}
      <EmptyState
        class="mt-2"
        title="No league MVP"
        message="No league MVP was recorded for this run."
        surface="none"
      />
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
      <StatGrid class="mt-4" columns={3} mobile={2}>
        <StatTile
          label="MVP score"
          size="sm"
          surface="tile"
          valueClass="font-mono text-xs"
          value={mvp.mvpScore.toFixed(2)}
        />
        <StatTile
          label="Game score"
          size="sm"
          surface="tile"
          valueClass="font-mono text-xs"
          value={mvp.averageGameScore.toFixed(1)}
        />
        <StatTile
          label="League baseline TS"
          size="sm"
          surface="tile"
          valueClass="font-mono text-xs"
          value={report.leagueBaselineTs.toFixed(3)}
        />
      </StatGrid>
    {/if}
  </Panel>
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
