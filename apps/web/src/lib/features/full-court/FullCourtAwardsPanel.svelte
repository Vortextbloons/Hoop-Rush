<script lang="ts">
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type {
    FullCourtAwardResult,
    FullCourtAwardsBoard,
    FullCourtPlayerSeasonRow,
  } from '@hoop-rush/engine';
  import { Award, Crown, Flame, Shield, Sparkles, Trophy } from '@lucide/svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import { seasonStatColumns } from '#lib/components/season-stat-columns.js';
  import { perGameText, trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  let {
    awards,
    rosterStats,
    userTeamId,
    art = null,
  }: {
    awards: FullCourtAwardsBoard;
    rosterStats: readonly FullCourtPlayerSeasonRow[];
    userTeamId: string;
    art?: FullCourtArt | null;
  } = $props();

  let statScope = $state<'team' | 'leaders'>('team');
  let statValues = $state<'game' | 'totals'>('game');
  let leaderCategory = $state<
    'scoring' | 'rebounding' | 'assists' | 'steals' | 'blocks' | 'threes'
  >('scoring');

  const awardCards = $derived<FullCourtAwardResult[]>([
    awards.mvp,
    awards.dpoy,
    awards.sixthMan,
    awards.scoringChamp,
    awards.finalsMvp,
  ]);

  const userLeads = $derived(
    awardCards.filter((award) => award.winner?.player.teamId === userTeamId).length,
  );

  const activeLeaders = $derived(awards.leaders[leaderCategory]);

  const leaderCategoryOptions = [
    { value: 'scoring', label: 'PPG' },
    { value: 'rebounding', label: 'RPG' },
    { value: 'assists', label: 'APG' },
    { value: 'steals', label: 'SPG' },
    { value: 'blocks', label: 'BPG' },
    { value: 'threes', label: '3PM/G' },
  ] as const;

  const teamUsage = $derived(
    rosterStats.reduce((sum, row) => sum + usagePossessions(row.fga, row.fta, row.turnovers), 0),
  );

  const statColumns = $derived.by((): PlayerStatColumn<FullCourtPlayerSeasonRow>[] => {
    const totals = statValues === 'totals';
    const stat = (total: number, pg: number, games: number): string => {
      if (totals) return String(Math.round(total));
      return games === 0 ? '0.0' : pg.toFixed(1);
    };
    const rawStat = (total: number, games: number): string =>
      totals ? String(Math.round(total)) : games === 0 ? '0.0' : perGameText(total, games);

    const core = seasonStatColumns<FullCourtPlayerSeasonRow>(
      {
        games: (row) => row.games,
        points: (row) => stat(row.points, row.ppg, row.games),
        rebounds: (row) => stat(row.rebounds, row.rpg, row.games),
        assists: (row) => stat(row.assists, row.apg, row.games),
        steals: (row) => stat(row.steals, row.spg, row.games),
        blocks: (row) => stat(row.blocks, row.bpg, row.games),
        turnovers: (row) => stat(row.turnovers, row.topg, row.games),
        fgPct: (row) => pctText(row.fgPct),
        threePct: (row) => pctText(row.tpPct),
        ftPct: (row) => pctText(row.ftPct),
        tsPct: (row) => pctText(row.tsPct),
        ...(statScope === 'team'
          ? {
              usagePct: (row) =>
                usagePct(usagePossessions(row.fga, row.fta, row.turnovers), teamUsage),
            }
          : {}),
        fgAttempts: (row) => rawStat(row.fga, row.games),
        threeAttempts: (row) => rawStat(row.tpa, row.games),
        ftAttempts: (row) => rawStat(row.fta, row.games),
        threeMade: (row) => stat(row.tpm, row.tpmPg, row.games),
      },
      { includeGames: true, includeDetailed: true },
    ).map((column) =>
      column.key === 'points' ? { ...column, cellClass: 'ui-stats-value-strong' } : column,
    );

    const minutesColumn: PlayerStatColumn<FullCourtPlayerSeasonRow> = {
      key: 'mpg',
      label: totals ? 'MIN' : 'MPG',
      value: (row) => (totals ? String(Math.round(row.minutes)) : row.mpg.toFixed(1)),
    };
    const foulsColumn: PlayerStatColumn<FullCourtPlayerSeasonRow> = {
      key: 'fouls',
      label: 'PF',
      value: (row) => rawStat(row.fouls, row.games),
    };

    const gamesIndex = core.findIndex((column) => column.key === 'games');
    const tovIndex = core.findIndex((column) => column.key === 'turnovers');
    const withMinutes = [
      ...core.slice(0, gamesIndex + 1),
      minutesColumn,
      ...core.slice(gamesIndex + 1, tovIndex + 1),
      foulsColumn,
      ...core.slice(tovIndex + 1),
    ];

    if (statScope === 'leaders') {
      return [
        {
          key: 'team',
          label: 'Team',
          align: 'start',
          value: (row) => franchiseAbbreviation(row.teamId),
          cellClass: 'text-muted-foreground',
        },
        ...withMinutes,
      ];
    }
    return withMinutes;
  });

  const teamTotalsRow = $derived.by((): PlayerStatsTotals<FullCourtPlayerSeasonRow> | null => {
    if (statScope !== 'team' || rosterStats.length === 0) return null;
    const totals = statValues === 'totals';
    const teamGames = rosterStats.reduce((max, row) => Math.max(max, row.games), 0);
    const sum = (pick: (row: FullCourtPlayerSeasonRow) => number): number =>
      rosterStats.reduce((acc, row) => acc + pick(row), 0);
    const pts = sum((r) => r.points);
    const reb = sum((r) => r.rebounds);
    const ast = sum((r) => r.assists);
    const stl = sum((r) => r.steals);
    const blk = sum((r) => r.blocks);
    const tov = sum((r) => r.turnovers);
    const pf = sum((r) => r.fouls);
    const min = sum((r) => r.minutes);
    const fgm = sum((r) => r.fgm);
    const fga = sum((r) => r.fga);
    const tpm = sum((r) => r.tpm);
    const tpa = sum((r) => r.tpa);
    const ftm = sum((r) => r.ftm);
    const fta = sum((r) => r.fta);
    const fmt = (total: number): string =>
      totals ? String(Math.round(total)) : teamGames === 0 ? '0.0' : perGameText(total, teamGames);
    const ratio = (made: number, att: number): string =>
      att === 0 ? '—' : `${((100 * made) / att).toFixed(1)}%`;

    return {
      label: 'Team',
      value: (column) => {
        switch (column.key) {
          case 'games':
            return teamGames;
          case 'mpg':
            return fmt(min);
          case 'points':
            return fmt(pts);
          case 'rebounds':
            return fmt(reb);
          case 'assists':
            return fmt(ast);
          case 'steals':
            return fmt(stl);
          case 'blocks':
            return fmt(blk);
          case 'turnovers':
            return fmt(tov);
          case 'fouls':
            return fmt(pf);
          case 'fgPct':
            return ratio(fgm, fga);
          case 'threePct':
            return ratio(tpm, tpa);
          case 'ftPct':
            return ratio(ftm, fta);
          case 'tsPct':
            return trueShootingPct(pts, fga, fta);
          case 'usagePct':
            return teamUsage > 0 ? '100.0%' : '—';
          case 'fgAttempts':
            return fmt(fga);
          case 'threeAttempts':
            return fmt(tpa);
          case 'ftAttempts':
            return fmt(fta);
          case 'threeMade':
            return fmt(tpm);
          default:
            return '—';
        }
      },
    };
  });

  type AwardStat = { readonly label: string; readonly value: string };

  function avgText(value: number): string {
    return value.toFixed(1);
  }

  function pctText(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }

  /** Each race is read in its own currency, so the winner's three headline numbers match the award. */
  function statTilesFor(
    id: FullCourtAwardResult['id'],
    row: FullCourtPlayerSeasonRow,
  ): AwardStat[] {
    switch (id) {
      case 'dpoy':
        return [
          { label: 'SPG', value: avgText(row.spg) },
          { label: 'BPG', value: avgText(row.bpg) },
          { label: 'RPG', value: avgText(row.rpg) },
        ];
      case 'sixth-man':
        return [
          { label: 'PTS', value: avgText(row.ppg) },
          { label: 'AST', value: avgText(row.apg) },
          { label: 'REB', value: avgText(row.rpg) },
        ];
      case 'scoring-champ':
        return [
          { label: 'PPG', value: avgText(row.ppg) },
          { label: 'TS%', value: pctText(row.tsPct) },
          { label: '3PM', value: avgText(row.tpmPg) },
        ];
      default:
        return [
          { label: 'PTS', value: avgText(row.ppg) },
          { label: 'REB', value: avgText(row.rpg) },
          { label: 'AST', value: avgText(row.apg) },
        ];
    }
  }
</script>

{#snippet awardIcon(id: FullCourtAwardResult['id'], size: number)}
  {#if id === 'mvp'}
    <Crown {size} strokeWidth={1.75} aria-hidden="true" />
  {:else if id === 'dpoy'}
    <Shield {size} strokeWidth={1.75} aria-hidden="true" />
  {:else if id === 'sixth-man'}
    <Sparkles {size} strokeWidth={1.75} aria-hidden="true" />
  {:else if id === 'scoring-champ'}
    <Flame {size} strokeWidth={1.75} aria-hidden="true" />
  {:else if id === 'finals-mvp'}
    <Trophy {size} strokeWidth={1.75} aria-hidden="true" />
  {:else}
    <Award {size} strokeWidth={1.75} aria-hidden="true" />
  {/if}
{/snippet}

<Panel as="section" padding="md" aria-label="Full Court awards and races">
  <SectionHeading
    eyebrow="Hardware"
    title={awards.regularComplete ? 'Season Awards' : 'Awards Race'}
    level={2}
    size="md"
    description={awards.regularComplete
      ? 'Final regular-season and postseason honors across all 30 franchises.'
      : 'Live MVP, Defensive Player of the Year, and Sixth Man standings.'}
  >
    {#snippet actions()}
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge tone={awards.regularComplete ? 'positive' : 'accent'}>
          {awards.regularComplete ? 'Finalized' : 'Live race'}
        </Badge>
        {#if awards.hasPlayerStats}
          <Badge tone={userLeads > 0 ? 'primary' : 'neutral'}>
            {#if awards.regularComplete}
              Your club won {userLeads} of {awardCards.length}
            {:else if userLeads > 0}
              Leading {userLeads} of {awardCards.length}
            {:else}
              Chasing all {awardCards.length}
            {/if}
          </Badge>
        {/if}
      </div>
    {/snippet}
  </SectionHeading>

  {#if !awards.hasPlayerStats}
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
      Simulate at least one game to populate player averages, league leaders, and award races.
    </p>
  {:else}
    <div class="award-board mt-4">
      {#each awardCards as award (award.id)}
        {@const winner = award.winner}
        {@const isUser = winner !== null && winner.player.teamId === userTeamId}
        {@const featured = award.id === 'mvp'}
        {@const team = winner === null || art === null ? null : art.teamFor(winner.player.teamId)}
        <article
          class="award-card"
          data-featured={featured}
          data-user={isUser}
          data-sealed={award.id === 'finals-mvp' && winner === null}
        >
          <span class="award-watermark" aria-hidden="true">{@render awardIcon(award.id, 104)}</span>

          <header class="award-head">
            <span class="award-medallion" aria-hidden="true">
              {@render awardIcon(award.id, featured ? 20 : 17)}
            </span>
            <div class="min-w-0">
              <p class="award-eyebrow">
                {#if winner !== null && !awards.regularComplete && award.id !== 'finals-mvp'}
                  <span class="award-live-dot" aria-hidden="true"></span>
                {/if}
                <span class="truncate">{award.subtitle}</span>
              </p>
              <h3 class="award-title" data-featured={featured}>{award.title}</h3>
            </div>
          </header>

          {#if winner === null}
            <div class="award-sealed">
              <p class="award-sealed-mark">
                {award.id === 'finals-mvp' ? 'Sealed until June' : 'No winner yet'}
              </p>
              <p class="award-sealed-copy">
                {award.id === 'finals-mvp'
                  ? 'Crowned once the NBA Finals conclude.'
                  : 'No qualified candidates yet.'}
              </p>
            </div>
          {:else}
            <div class="award-hero">
              <span class="award-frame" data-featured={featured}>
                <FullCourtPortrait
                  player={winner.player}
                  {art}
                  size={featured ? 'xl' : 'md'}
                  eager={featured}
                />
              </span>
              <div class="award-hero-copy">
                <p class="award-name">{winner.player.displayName}</p>
                <p class="award-team">
                  {#if team !== null && art !== null}
                    <TeamLogo
                      manifest={art.manifest}
                      franchiseId={team.franchiseId}
                      teamExternalId={team.teamExternalId}
                      className="h-3.5 w-3.5"
                    />
                  {/if}
                  <span class="truncate">{winner.player.teamName}</span>
                </p>
                {#if isUser}
                  <span class="award-user-tag">Your team</span>
                {/if}
              </div>
            </div>

            <dl class="award-stats">
              {#each statTilesFor(award.id, winner.player) as stat (stat.label)}
                <div>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              {/each}
            </dl>

            {#if award.finalists.length > 1}
              <ol class="award-ladder" aria-label={`${award.title} runners-up`}>
                {#each award.finalists.slice(1) as runnerUp, idx (runnerUp.player.playerId + runnerUp.player.teamId)}
                  <li class="award-ladder-row" data-user={runnerUp.player.teamId === userTeamId}>
                    <span class="award-rank" aria-hidden="true">{idx + 2}</span>
                    <FullCourtPortrait player={runnerUp.player} {art} size="xs" />
                    <div class="min-w-0 flex-1">
                      <p class="award-ladder-name">
                        <strong>{runnerUp.player.displayName}</strong>
                        <span class="award-ladder-team">
                          {franchiseAbbreviation(runnerUp.player.teamId)}
                        </span>
                      </p>
                      <p class="award-ladder-summary">{runnerUp.summary}</p>
                    </div>
                  </li>
                {/each}
              </ol>
            {/if}
          {/if}
        </article>
      {/each}
    </div>

    {#if awards.allLeagueFirst.length > 0}
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        {#each [{ title: 'All-League First Team', tier: 'first', players: awards.allLeagueFirst }, { title: 'All-League Second Team', tier: 'second', players: awards.allLeagueSecond }] as squad (squad.title)}
          {#if squad.players.length > 0}
            <div class="squad-card" data-tier={squad.tier}>
              <div class="squad-head">
                <p class="ui-label">{squad.title}</p>
                <p class="squad-count">{squad.players.length} named</p>
              </div>
              <ol class="squad-list">
                {#each squad.players as player, idx (player.playerId + player.teamId)}
                  <li class="squad-row" data-user={player.teamId === userTeamId}>
                    <span class="award-rank" aria-hidden="true">{idx + 1}</span>
                    <FullCourtPortrait {player} {art} size="xs" />
                    <span class="min-w-0 flex-1 truncate">
                      <strong
                        class={player.teamId === userTeamId ? 'text-primary' : 'text-foreground'}
                      >
                        {player.displayName}
                      </strong>
                      <span class="squad-team">{player.teamName}</span>
                    </span>
                    <span class="squad-line">
                      {player.ppg.toFixed(1)}p / {player.rpg.toFixed(1)}r / {player.apg.toFixed(1)}a
                    </span>
                  </li>
                {/each}
              </ol>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</Panel>

{#if awards.hasPlayerStats}
  {@const tableRows = statScope === 'team' ? rosterStats : activeLeaders}
  <PlayerStatsSection
    ariaLabel="Full Court player season stats"
    title={statScope === 'team' ? 'Your roster averages' : 'League leaders'}
    description={statScope === 'team'
      ? statValues === 'totals'
        ? 'Season totals for every player on your roster.'
        : 'Season averages for every player on your roster.'
      : 'The top five qualified players in each category across all 30 franchises.'}
    surface="panel"
    sideLabel="Stats scope"
    sideOptions={[
      { value: 'team', label: 'Your Team' },
      { value: 'leaders', label: 'League Leaders' },
    ]}
    side={statScope}
    onsidechange={(value) => (statScope = value)}
    values={statValues}
    onvalueschange={(value) => (statValues = value)}
    rows={tableRows.length > 0 ? tableRows : null}
    columns={statColumns}
    totalsRow={teamTotalsRow}
    tableClass="min-w-[1060px] text-xs"
    statCellClass="px-2 py-1 text-right font-mono"
    rowKey={(row) => row.teamId + row.playerId}
    rowClass={(row) =>
      row.teamId === userTeamId
        ? 'border-b border-border/40 bg-primary/5'
        : 'border-b border-border/40'}
    caption={`${statValues === 'totals' ? 'Season totals' : 'Per-game season averages'} for ${
      statScope === 'team' ? 'your roster' : 'league leaders'
    }`}
    note={`${statValues === 'totals' ? 'Season totals' : 'Per-game averages'} · ${tableRows.length} players · PCT columns ignore volume`}
    stickyIdentity
  >
    {#snippet actions()}
      {#if statScope === 'leaders'}
        <SegmentedControl
          label="Stat category"
          size="sm"
          value={leaderCategory}
          onchange={(value) => (leaderCategory = value)}
          options={leaderCategoryOptions}
        />
      {/if}
    {/snippet}
    {#snippet identity(row)}
      <span class="ui-stats-player">
        <FullCourtPortrait player={row} {art} size="sm" />
        <span class="ui-stats-player-text">
          <span class="ui-stats-player-name {row.teamId === userTeamId ? 'text-primary' : ''}">
            {row.displayName}
          </span>
          <span class="ui-stats-player-meta">
            {franchiseAbbreviation(row.teamId)} · {row.positions.slice(0, 2).join('/')}
          </span>
        </span>
      </span>
    {/snippet}
    {#snippet empty()}
      <p class="ui-stats-empty">Simulate a regular-season game to record player averages.</p>
    {/snippet}
    {#snippet cards()}
      {#each tableRows as row (row.teamId + row.playerId)}
        <article class="stat-card">
          <div class="flex min-w-0 items-start gap-2.5">
            <FullCourtPortrait player={row} {art} size="sm" />
            <div class="min-w-0 flex-1">
              <p class="stat-card-name" class:is-user={row.teamId === userTeamId}>
                {row.displayName}
              </p>
              <p class="stat-card-meta">
                {franchiseAbbreviation(row.teamId)} · {row.games} GP
              </p>
            </div>
            <p class="stat-card-lead">
              {statValues === 'totals' ? Math.round(row.points) : row.ppg.toFixed(1)}<span>PPG</span
              >
            </p>
          </div>
          <dl class="stat-card-grid">
            {#each statColumns.filter((column) => column.key !== 'games' && column.key !== 'points' && column.key !== 'team') as column (column.key)}
              <div>
                <dt>{column.label}</dt>
                <dd>{column.value(row)}</dd>
              </div>
            {/each}
          </dl>
        </article>
      {/each}
    {/snippet}
  </PlayerStatsSection>
{/if}

<style>
  .award-board {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 640px) {
    .award-board {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .award-card[data-featured='true'] {
      grid-column: span 2;
    }
  }

  @media (min-width: 1024px) {
    .award-board {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .award-card {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.7rem;
    overflow: hidden;
    padding: 0.85rem 0.9rem 0.8rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.95rem;
    background:
      radial-gradient(
        120% 80% at 0% 0%,
        color-mix(in srgb, var(--color-accent) 7%, transparent),
        transparent 58%
      ),
      linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 72%);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent),
      0 1px 2px rgb(0 0 0 / 22%);
  }

  /* Engraved inlay along the top edge of every plate. */
  .award-card::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-accent) 80%, transparent) 22%,
      color-mix(in srgb, var(--color-accent) 80%, transparent) 78%,
      transparent
    );
    opacity: 0.5;
  }

  .award-card[data-featured='true'] {
    padding: 1rem 1.1rem 0.9rem;
    border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-line-soft));
    background:
      radial-gradient(
        90% 120% at 0% 0%,
        color-mix(in srgb, var(--color-accent) 14%, transparent),
        transparent 62%
      ),
      linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 78%);
  }

  .award-card[data-user='true'] {
    border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-line-soft));
    background:
      radial-gradient(
        90% 120% at 0% 0%,
        color-mix(in srgb, var(--color-primary) 16%, transparent),
        transparent 62%
      ),
      linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 78%);
  }

  .award-card[data-user='true']::before {
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-primary) 85%, transparent) 22%,
      color-mix(in srgb, var(--color-primary) 85%, transparent) 78%,
      transparent
    );
    opacity: 0.75;
  }

  .award-card[data-sealed='true'] {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-line-strong) 90%, transparent);
    background: linear-gradient(180deg, var(--color-surface-1), var(--color-background));
  }

  .award-card[data-sealed='true']::before {
    opacity: 0.16;
  }

  .award-watermark {
    position: absolute;
    top: -0.35rem;
    right: -0.65rem;
    color: var(--color-foreground);
    opacity: 0.05;
    pointer-events: none;
  }

  .award-card[data-user='true'] .award-watermark {
    color: var(--color-primary);
    opacity: 0.08;
  }

  .award-head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .award-medallion {
    display: grid;
    flex: none;
    width: 2.15rem;
    height: 2.15rem;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--color-accent) 42%, transparent);
    border-radius: 999px;
    background: radial-gradient(
      circle at 50% 30%,
      color-mix(in srgb, var(--color-accent) 24%, transparent),
      transparent 72%
    );
    color: var(--color-accent);
    box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--color-accent) 7%, transparent);
  }

  .award-card[data-user='true'] .award-medallion {
    border-color: color-mix(in srgb, var(--color-primary) 52%, transparent);
    background: radial-gradient(
      circle at 50% 30%,
      color-mix(in srgb, var(--color-primary) 26%, transparent),
      transparent 72%
    );
    color: var(--color-primary);
    box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .award-eyebrow {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .award-live-dot {
    flex: none;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--color-accent);
    animation: award-pulse 2.4s ease-out infinite;
  }

  @keyframes award-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 55%, transparent);
    }
    70%,
    100% {
      box-shadow: 0 0 0 0.35rem transparent;
    }
  }

  .award-title {
    margin: 0.15rem 0 0;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: -0.005em;
    line-height: 1.05;
    text-transform: uppercase;
  }

  .award-title[data-featured='true'] {
    font-size: clamp(1.25rem, 2.2vw, 1.6rem);
  }

  .award-hero {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }

  .award-frame {
    position: relative;
    display: grid;
    flex: none;
    padding: 2px;
    border-radius: 0.8rem;
    background: linear-gradient(
      155deg,
      color-mix(in srgb, var(--color-accent) 75%, transparent),
      color-mix(in srgb, var(--color-accent) 12%, transparent) 58%,
      transparent
    );
    box-shadow: 0 10px 22px -18px color-mix(in srgb, var(--color-accent) 80%, transparent);
  }

  .award-frame[data-featured='true'] {
    border-radius: 1.05rem;
  }

  .award-card[data-user='true'] .award-frame {
    background: linear-gradient(
      155deg,
      color-mix(in srgb, var(--color-primary) 80%, transparent),
      color-mix(in srgb, var(--color-primary) 12%, transparent) 58%,
      transparent
    );
  }

  .award-hero-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.22rem;
  }

  .award-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.02;
    overflow-wrap: anywhere;
    text-transform: uppercase;
  }

  .award-card[data-featured='true'] .award-name {
    font-size: clamp(1.5rem, 2.8vw, 2.05rem);
  }

  .award-team {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .award-user-tag {
    padding: 0.05rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 50%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .award-stats {
    display: grid;
    flex: 1 1 auto;
    margin: 0;
    padding-top: 0.55rem;
    border-top: 1px solid color-mix(in srgb, var(--color-accent) 18%, var(--color-line-soft));
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
  }

  .award-stats > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 0.3rem;
    padding-left: 0.7rem;
    border-left: 1px solid var(--color-line-soft);
  }

  .award-stats > div:first-child {
    padding-left: 0;
    border-left: 0;
  }

  .award-stats dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .award-stats dd {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 2.6vw, 1.85rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 0.95;
  }

  .award-card[data-featured='true'] .award-stats dd {
    font-size: clamp(1.9rem, 3.4vw, 2.5rem);
  }

  .award-ladder {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0.55rem 0 0;
    border-top: 1px solid var(--color-line-soft);
    list-style: none;
  }

  .award-ladder-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.45rem;
  }

  .award-rank {
    flex: none;
    width: 1.1rem;
    color: color-mix(in srgb, var(--color-muted-foreground) 80%, transparent);
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    text-align: right;
  }

  .award-ladder-name {
    margin: 0;
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
    line-height: 1.2;
  }

  .award-ladder-name strong {
    color: var(--color-foreground);
    font-weight: 700;
  }

  .award-ladder-row[data-user='true'] .award-ladder-name strong {
    color: var(--color-primary);
  }

  .award-ladder-team {
    margin-left: 0.3rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .award-ladder-summary {
    margin: 0.1rem 0 0;
    overflow: hidden;
    color: color-mix(in srgb, var(--color-muted-foreground) 85%, transparent);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .award-sealed {
    display: flex;
    min-height: 5.5rem;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.5rem 0;
    text-align: center;
  }

  .award-sealed-mark {
    margin: 0;
    color: color-mix(in srgb, var(--color-accent) 85%, var(--color-muted-foreground));
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .award-sealed-copy {
    margin: 0;
    max-width: 24ch;
    color: var(--color-muted-foreground);
    font-size: 0.6875rem;
    line-height: 1.5;
  }

  .squad-card {
    position: relative;
    overflow: hidden;
    padding: 0.85rem 0.9rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.95rem;
    background: var(--color-surface-1);
  }

  .squad-card::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-accent) 75%, transparent),
      transparent 70%
    );
  }

  .squad-card[data-tier='second']::before {
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--color-line-strong) 95%, transparent),
      transparent 70%
    );
  }

  .squad-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .squad-count {
    margin: 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .squad-list {
    display: grid;
    gap: 0.35rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .squad-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
  }

  .squad-team {
    margin-left: 0.3rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .squad-line {
    flex: none;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-variant-numeric: tabular-nums;
  }

  /* Narrow screens swap the wide table for one card per player, as the other modes do. */
  .stat-card {
    min-width: 0;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }

  .stat-card-name {
    margin: 0;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat-card-name.is-user {
    color: var(--color-primary);
  }

  .stat-card-meta {
    margin: 0.15rem 0 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .stat-card-lead {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.45rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .stat-card-lead span {
    margin-left: 0.2rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .stat-card-grid {
    display: grid;
    margin: 0.65rem 0 0;
    padding-top: 0.55rem;
    border-top: 1px solid var(--color-line-soft);
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem 0.4rem;
  }

  .stat-card-grid dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .stat-card-grid dd {
    margin: 0.1rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .award-live-dot {
      animation: none;
    }
  }
</style>
