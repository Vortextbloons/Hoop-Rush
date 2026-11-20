<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import BoxScorePanel from '#lib/components/screens/BoxScorePanel.svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { BadgeTone } from '#lib/components/ui/types.js';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { getManifest, getPlayersIndex } from '#lib/data.js';
  import type { HoopRushManifest, PlayersIndex } from '@hoop-rush/data-contracts';
  import {
    POSITIONS,
    capRushConferenceRoundName,
    type CapRushPayrollStatus,
    type CapRushPlayerSeasonLine,
    type CapRushReport,
  } from '@hoop-rush/data-contracts';
  import { capRushPostseasonPlayerStats, havocMutationDefinitionOf } from '@hoop-rush/engine';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import AchievementReveal from '#lib/features/profile/AchievementReveal.svelte';
  import CapRushBracket from './CapRushBracket.svelte';
  import { loadCapRushArt, type CapRushArt } from './cap-rush-art.js';
  import { Crown, Trophy } from '@lucide/svelte';
  import { trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import {
    apronPenaltyRows,
    apronPenaltyTitle,
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
  let art = $state.raw<CapRushArt | null>(null);
  onMount(() => {
    let mounted = true;
    void Promise.allSettled([getManifest(), getPlayersIndex(), loadCapRushArt()]).then(
      ([branding, index, loadedArt]) => {
        if (!mounted) return;
        if (branding.status === 'fulfilled') manifest = branding.value;
        if (index.status === 'fulfilled') playerIndex = index.value;
        if (loadedArt.status === 'fulfilled') art = loadedArt.value;
      },
    );
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
  const seasonTeams = $derived([{ name: 'Your five', isUser: true }, { name: 'Opponents' }]);
  const championIdentity = $derived(
    art === null || postseason?.championTeamId == null
      ? null
      : art.teamFor(postseason.championTeamId),
  );
  const userIdentity = $derived(
    art === null || report.franchise === undefined || report.franchise === null
      ? null
      : art.teamFor(report.franchise.franchiseId),
  );
  const mvpIdentity = $derived(art === null || mvp === null ? null : art.teamFor(mvp.teamId));
  const finalsMvpFace = $derived(
    postseason === null
      ? null
      : (playerIndex?.players.find((entry) => entry.playerId === postseason.finalsMvp.playerId) ??
          null),
  );
  const leagueMvpFace = $derived(
    mvp === null
      ? null
      : (playerIndex?.players.find((entry) => entry.playerId === mvp.playerId) ?? null),
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

  function capTone(status: CapRushPayrollStatus): BadgeTone {
    if (status === 'under-cap') return 'positive';
    if (status === 'first-apron') return 'accent';
    if (status === 'second-apron') return 'primary';
    return 'negative';
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

{#snippet leagueMvpCard()}
  <MvpCard
    class="h-full"
    label="League MVP"
    tone="primary"
    name={mvp?.displayName ?? null}
    team={mvp?.teamName ?? null}
    position={mvp === null ? null : `${mvp.slot ?? '—'} · ${mvp.appearances} GP`}
    stats={mvp === null
      ? []
      : [
          { label: 'PTS', value: mvp.averagePoints.toFixed(1) },
          { label: 'REB', value: mvp.averageRebounds.toFixed(1) },
          { label: 'AST', value: mvp.averageAssists.toFixed(1) },
          { label: 'MVP score', value: mvp.mvpScore.toFixed(2) },
        ]}
    emptyCopy="No league MVP was recorded for this run."
  >
    {#snippet icon()}<Trophy size={18} aria-hidden="true" />{/snippet}
    {#snippet logo()}
      {#if manifest && mvpIdentity}
        <TeamLogo
          {manifest}
          franchiseId={mvpIdentity.franchiseId}
          teamExternalId={mvpIdentity.teamExternalId}
          className="h-full w-full"
        />
      {/if}
    {/snippet}
    {#snippet portrait()}
      {#if manifest && leagueMvpFace}
        <PlayerFace
          player={leagueMvpFace}
          {manifest}
          size="xl"
          fallbackInitials={initialsOf(mvp?.displayName ?? '')}
        />
      {:else if mvp !== null}
        <span class="report-initials" aria-hidden="true">{initialsOf(mvp.displayName)}</span>
      {/if}
    {/snippet}
  </MvpCard>
{/snippet}

<ResultScreen
  eyebrow={`${variantLabel(report.variant)} · Season report`}
  title={report.postseason === undefined ? 'Regular-season report' : 'Championship report'}
  data-cap-rush-report
>
  {#snippet badges()}
    <Badge tone={capTone(report.payrollStatus)}>{capStatusLabel(report.payrollStatus)}</Badge>
  {/snippet}

  {#snippet hero()}
    <ResultHero
      score={recordLabel(aggregate.wins, aggregate.losses)}
      meta={`${aggregate.games} games · ${aggregate.pointsFor} for · ${aggregate.pointsAgainst} against`}
      tone={postseason?.isUserChampion === true ? 'champion' : 'default'}
    >
      {#snippet logo()}
        {#if manifest && userIdentity}
          <TeamLogo
            {manifest}
            franchiseId={userIdentity.franchiseId}
            teamExternalId={userIdentity.teamExternalId}
            className="h-full w-full"
            eager
          />
        {/if}
      {/snippet}
    </ResultHero>
    <StatGrid class="mt-4" columns={3} mobile={3} gap="md">
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
  {/snippet}

  {#if aggregate.perfectSeason}
    <Alert tone="warning" title="Perfect season · 82–0">
      {#snippet icon()}<Trophy size={22} aria-hidden="true" />{/snippet}
    </Alert>
  {/if}

  {#if postseason !== null}
    <Panel
      as="section"
      padding="md"
      class={postseason.isUserChampion ? 'border-accent/50 bg-accent/10' : ''}
      aria-label="Postseason result"
    >
      <div class="flex flex-wrap items-center gap-4">
        {#if manifest && championIdentity}
          <TeamLogo
            {manifest}
            franchiseId={championIdentity.franchiseId}
            teamExternalId={championIdentity.teamExternalId}
            className="h-10 w-10"
            eager
          />
        {:else}
          <Trophy
            size={34}
            class="shrink-0 {postseason.isUserChampion ? 'text-accent' : 'text-muted-foreground'}"
            aria-hidden="true"
          />
        {/if}
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
          <Badge tone="primary">Your seed · {postseason.seed}</Badge>
        {/if}
      </div>
      {#if postseason.isUserChampion}
        <AchievementReveal bindingId={`cap-rush:${report.runId}`} />
      {/if}
    </Panel>

    <div class="grid items-stretch gap-4 md:grid-cols-2">
      {@render leagueMvpCard()}
      <MvpCard
        class="h-full border-accent/40"
        label="Finals MVP"
        tone="accent"
        name={postseason.finalsMvp.displayName}
        team={postseason.championName}
        position={`${postseason.finalsMvp.slot} · ${postseason.finalsMvp.games} Finals games`}
        stats={[
          {
            label: 'PTS',
            value: formatAverage(postseason.finalsMvp.totalPoints, postseason.finalsMvp.games),
          },
          {
            label: 'REB',
            value: formatAverage(postseason.finalsMvp.totalRebounds, postseason.finalsMvp.games),
          },
          {
            label: 'AST',
            value: formatAverage(postseason.finalsMvp.totalAssists, postseason.finalsMvp.games),
          },
          {
            label: 'Game score',
            value: formatAverage(postseason.finalsMvp.totalGameScore, postseason.finalsMvp.games),
          },
        ]}
      >
        {#snippet icon()}<Crown size={18} aria-hidden="true" />{/snippet}
        {#snippet logo()}
          {#if manifest && championIdentity}
            <TeamLogo
              {manifest}
              franchiseId={championIdentity.franchiseId}
              teamExternalId={championIdentity.teamExternalId}
              className="h-full w-full"
            />
          {/if}
        {/snippet}
        {#snippet portrait()}
          {#if manifest && finalsMvpFace}
            <PlayerFace
              player={finalsMvpFace}
              {manifest}
              size="xl"
              fallbackInitials={initialsOf(postseason.finalsMvp.displayName)}
            />
          {:else}
            <span class="report-initials" aria-hidden="true"
              >{initialsOf(postseason.finalsMvp.displayName)}</span
            >
          {/if}
        {/snippet}
      </MvpCard>
    </div>

    <CapRushBracket
      series={postseason.series}
      standings={postseason.standings}
      {manifest}
      userTeamId={report.franchise?.franchiseId ?? null}
    />
  {:else}
    <Alert tone="info">
      This is a regular-season run. It was played before Cap Rush postseasons existed, so it has no
      bracket or Finals MVP.
    </Alert>
    <div class="grid gap-4 md:grid-cols-2">
      {@render leagueMvpCard()}
    </div>
  {/if}

  <Panel as="section" padding="md" aria-label="Season finances">
    <StatGrid columns={report.variant === 'roulette' ? 4 : 3} mobile={2} gap="md">
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
      <p class="ui-micro">Efficiency</p>
      <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
        {winsPerMillion === null ? '\u2014' : winsPerMillion.toFixed(2)}
      </p>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        wins per $1M of player payroll
        <span class="font-mono"
          >· {aggregate.wins} wins ÷ {formatMillions(report.payrollDollars)}</span
        >
      </p>
    </div>
  </Panel>

  <Panel as="section" padding="md" aria-label="Your five">
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
            <p>{formatMillions(line.salaryDollars)} · {line.gamesPlayed} GP</p>
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
    {#if report.variant === 'roulette'}
      <Disclosure summary="Mutation spin" meta="The wild card" aria-label="Cap Roulette spin">
        {#if spins.length === 0}
          <EmptyState class="mt-4" title="No spin purchased" surface="none" />
        {:else}
          <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {#each spins as spin (spin.targetCardId)}
              {@const mutation = havocMutationDefinitionOf(spin.mutationId)}
              {@const spinTarget =
                players.find((line) => line.cardId === spin.targetCardId) ?? null}
              <Disclosure
                summary={mutation.name}
                meta={`${
                  spinTarget === null
                    ? spin.targetCardId
                    : `${spinTarget.displayName} - ${spinTarget.slot}`
                } · ${
                  spin.purchase === 'standard' ? 'Mutation Spark' : 'Mutation Surge'
                } · ${formatMillions(spin.priceDollars)}`}
              >
                <HavocTierBadge tier={spin.tier} size="sm" />
                {#if spinTarget !== null}
                  <p class="mt-3 font-bold text-primary">
                    {spinTarget.adjustments > 0 ? '+' : ''}{spinTarget.adjustments} direct mutation points
                  </p>
                  <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Recorded scoring adjustments for this player across all their powers. Rating
                    effects are described below.
                  </p>
                {/if}
                <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {mutation.description}
                </p>
                {#each spin.additionalMutationIds ?? [] as mutationId (mutationId)}
                  {@const extra = havocMutationDefinitionOf(mutationId)}
                  <p class="mt-2 text-xs font-bold">{extra.name}</p>
                  <p class="text-xs leading-relaxed text-muted-foreground">{extra.description}</p>
                  {#if extra.downside}<p class="mt-2 text-xs text-destructive">
                      Downside: {extra.downside}
                    </p>{/if}
                {/each}
                {#if mutation.downside}<p class="mt-2 text-xs text-destructive">
                    Downside: {mutation.downside}
                  </p>{/if}
              </Disclosure>
            {/each}
          </div>
        {/if}
      </Disclosure>
    {/if}
  </div>

  <Panel as="section" padding="md" aria-label="Season statistics">
    <SectionHeading eyebrow="The box score" title="Season statistics" level={3} />
    <div class="mt-3">
      <SegmentedControl
        options={statsOptions}
        value={statsView}
        onchange={(view) => (statsView = view)}
        label="Statistics split"
      />
    </div>
    {#if statsView !== 'regular' && playoffStats === null}
      <p class="mt-3 text-sm text-muted-foreground" role="status">{postseasonMessage}</p>
    {/if}
    {#if statRows.length > 0}
      <BoxScorePanel class="mt-4" label="Season statistics" teams={seasonTeams}>
        <div class="overflow-x-auto">
          <PlayerStatsTable
            columns={statColumns}
            rows={statRows}
            rowKey={(line) => `${line.slot}:${line.phase}`}
            caption={`${comparing ? 'Regular season and postseason' : statsView === 'postseason' ? 'Postseason' : 'Regular season'} averages for the five signed slots`}
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
        </div>
      </BoxScorePanel>
    {/if}
  </Panel>

  <Panel as="section" padding="md" aria-label="Cap status and applied penalties">
    <SectionHeading eyebrow="Payroll impact" title="Cap status" level={3} align="start">
      {#snippet actions()}
        <Badge tone={capTone(report.payrollStatus)}>{capStatusLabel(report.payrollStatus)}</Badge>
      {/snippet}
    </SectionHeading>
    <div class="mt-4 border-t border-line-soft pt-3">
      <p class="ui-micro font-bold">Applied penalties</p>
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
    </div>
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
</ResultScreen>

<style>
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
</style>
