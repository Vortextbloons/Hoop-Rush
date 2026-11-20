<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Calendar, Clock, Gamepad2, ShieldCheck, Trophy } from '@lucide/svelte';
  import type {
    FixedFiveCompetitionResult,
    FixedFiveRoomMode,
    FixedFiveWorkerResultEntry,
    HoopRushManifest,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { formatPositions } from '#lib/player-positions.js';
  import type { DraftPresentation } from '#lib/draft-presentation.js';
  import type {
    FixedFivePlayerStatLine,
    FixedFivePlayerStats,
  } from '#lib/features/fixed-five/fixed-five-player-stats.js';
  import { perGameText, trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import ComparisonTable from '#lib/components/screens/ComparisonTable.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import SeriesRecap from '#lib/components/screens/SeriesRecap.svelte';
  import type { ComparisonRow } from '#lib/components/ui/types.js';
  let {
    mode,
    result,
    selfId = 'p1',
    manifest,
    p1Rows = [],
    p2Rows = [],
    presentation = 'ratings',
    digest = null,
    stats = null,
    statsState = 'empty',
    onRebuildStats = null,
    entries = [],
    roomCode = null,
    createdAt = null,
    verified = false,
    modeDetail = null,
    receiptDigest = null,
    onRematch = null,
    rematchLabel = 'Rematch',
    rematchWaiting = false,
    rematchBusy = false,
  }: {
    mode: FixedFiveRoomMode;
    result: FixedFiveCompetitionResult;
    selfId?: 'p1' | 'p2';
    manifest: HoopRushManifest;
    p1Rows?: (PlayersIndexEntry | null)[];
    p2Rows?: (PlayersIndexEntry | null)[];
    presentation?: DraftPresentation;
    digest?: string | null;
    stats?: FixedFivePlayerStats | null;
    statsState?: 'ready' | 'building' | 'empty';
    onRebuildStats?: (() => void) | null;
    entries?: FixedFiveWorkerResultEntry[];
    roomCode?: string | null;
    createdAt?: string | null;
    verified?: boolean;
    modeDetail?: string | null;
    receiptDigest?: string | null;
    onRematch?: (() => void) | null;
    rematchLabel?: string;
    rematchWaiting?: boolean;
    rematchBusy?: boolean;
  } = $props();
  interface StatsRow {
    slotIndex: number;
    entry: PlayersIndexEntry | null;
    line: FixedFivePlayerStatLine | undefined;
  }

  let tab = $state<'overview' | 'games' | 'players' | 'team'>('overview');
  let statsSide = $state<'you' | 'opp'>('you');
  const statsSideOptions = [
    { value: 'you', label: 'You' },
    { value: 'opp', label: 'Opponent' },
  ] as const;
  const statsPid = $derived<'p1' | 'p2'>(
    statsSide === 'you' ? selfId : selfId === 'p1' ? 'p2' : 'p1',
  );
  const statsEntries = $derived(statsPid === 'p1' ? p1Rows : p2Rows);
  const statsLines = $derived.by((): Map<string, FixedFivePlayerStatLine> => {
    const lines = stats ? (statsPid === 'p1' ? stats.p1 : stats.p2) : [];
    return new Map(lines.map((line) => [line.playerId, line]));
  });
  const statsRows = $derived.by((): StatsRow[] | null => {
    if (statsState !== 'ready' || !stats) return null;
    return statsEntries.map((entry, slotIndex) => ({
      slotIndex,
      entry,
      line: entry ? statsLines.get(entry.playerId) : undefined,
    }));
  });
  const statsTeamUsage = $derived(
    [...statsLines.values()].reduce(
      (total, line) =>
        total +
        usagePossessions(line.fieldGoalsAttempted, line.freeThrowsAttempted, line.turnovers),
      0,
    ),
  );
  function statValue(value: number, games: number): string {
    return perGameText(value, games);
  }
  function pctStr(made: number, attempted: number): string {
    if (attempted <= 0) return '—';
    return `${((made / attempted) * 100).toFixed(1)}%`;
  }
  const statsColumns: readonly PlayerStatColumn<StatsRow>[] = [
    {
      key: 'minutes',
      label: 'MIN',
      value: (row) => (row.line ? statValue(row.line.minutes, row.line.games) : '—'),
    },
    {
      key: 'points',
      label: 'PTS',
      value: (row) => (row.line ? statValue(row.line.points, row.line.games) : '—'),
      cellClass: 'ui-stats-value-strong',
    },
    {
      key: 'fieldGoalPct',
      label: 'FG%',
      value: (row) =>
        row.line ? pctStr(row.line.fieldGoalsMade, row.line.fieldGoalsAttempted) : '—',
    },
    {
      key: 'threePointPct',
      label: '3P%',
      value: (row) => (row.line ? pctStr(row.line.threesMade, row.line.threesAttempted) : '—'),
    },
    {
      key: 'freeThrowPct',
      label: 'FT%',
      value: (row) =>
        row.line ? pctStr(row.line.freeThrowsMade, row.line.freeThrowsAttempted) : '—',
    },
    {
      key: 'rebounds',
      label: 'REB',
      value: (row) => (row.line ? statValue(row.line.rebounds, row.line.games) : '—'),
    },
    {
      key: 'assists',
      label: 'AST',
      value: (row) => (row.line ? statValue(row.line.assists, row.line.games) : '—'),
    },
    {
      key: 'steals',
      label: 'STL',
      value: (row) => (row.line ? statValue(row.line.steals, row.line.games) : '—'),
    },
    {
      key: 'blocks',
      label: 'BLK',
      value: (row) => (row.line ? statValue(row.line.blocks, row.line.games) : '—'),
    },
    {
      key: 'turnovers',
      label: 'TOV',
      value: (row) => (row.line ? statValue(row.line.turnovers, row.line.games) : '—'),
    },
    {
      key: 'trueShootingPct',
      label: 'TS%',
      value: (row) =>
        row.line
          ? trueShootingPct(
              row.line.points,
              row.line.fieldGoalsAttempted,
              row.line.freeThrowsAttempted,
            )
          : '—',
    },
    {
      key: 'usagePct',
      label: 'USG%',
      value: (row) =>
        row.line
          ? usagePct(
              usagePossessions(
                row.line.fieldGoalsAttempted,
                row.line.freeThrowsAttempted,
                row.line.turnovers,
              ),
              statsTeamUsage,
            )
          : '—',
    },
  ];
  const modeLabel = $derived(mode === 'duel' ? 'Duel · Best of 7' : 'Season · 82 games');
  const modeDetailLabel = $derived(modeDetail ?? modeLabel);
  const youWon = $derived(
    result.competition === 'duel' ? result.winner === selfId : result.ranking[0] === selfId,
  );
  const shared = $derived(result.competition === 'shared-82' ? result : null);
  const duel = $derived(result.competition === 'duel' ? result : null);
  const youShared = $derived(shared?.participants.find((p) => p.participantId === selfId) ?? null);
  const oppShared = $derived(shared?.participants.find((p) => p.participantId !== selfId) ?? null);
  const showRatings = $derived(presentation !== 'ball-knowledge');
  function laneName(id: 'p1' | 'p2'): string {
    return id === selfId ? 'You' : 'Opponent';
  }
  const duelScores = $derived.by(
    (): Array<{
      gameNumber: number;
      youScore: number | null;
      oppScore: number | null;
      won: boolean;
    }> => {
      if (!duel) return [];
      const duelEntries = entries
        .filter((e) => e.tag === 'duel')
        .slice()
        .sort((a, b) => a.game.gameNumber - b.game.gameNumber);
      return duel.games.map((g) => {
        const entry = duelEntries.find((e) => e.game.gameNumber === g.gameNumber);
        let youScore: number | null = null;
        let oppScore: number | null = null;
        if (entry) {
          const homeIsSelf = entry.game.home.teamId === selfId;
          youScore = homeIsSelf ? entry.game.home.box.points : entry.game.away.box.points;
          oppScore = homeIsSelf ? entry.game.away.box.points : entry.game.home.box.points;
        }
        return { gameNumber: g.gameNumber, youScore, oppScore, won: g.winner === selfId };
      });
    },
  );
  const h2hScores = $derived.by(
    (): Array<{
      gameNumber: number;
      youScore: number | null;
      oppScore: number | null;
      won: boolean;
    }> => {
      if (!shared) return [];
      const h2hEntries = entries
        .filter((e) => e.tag === 'h2h')
        .slice()
        .sort((a, b) => a.game.gameNumber - b.game.gameNumber);
      return h2hEntries.map((entry) => {
        const homeIsSelf = selfId === 'p1';
        const youScore = homeIsSelf ? entry.game.home.box.points : entry.game.away.box.points;
        const oppScore = homeIsSelf ? entry.game.away.box.points : entry.game.home.box.points;
        const won = homeIsSelf ? entry.game.winner === 'home' : entry.game.winner === 'away';
        return { gameNumber: entry.game.gameNumber, youScore, oppScore, won };
      });
    },
  );

  const youWins = $derived(
    duel ? (selfId === 'p1' ? duel.p1Wins : duel.p2Wins) : (youShared?.wins ?? 0),
  );

  const oppWins = $derived(
    duel ? (selfId === 'p1' ? duel.p2Wins : duel.p1Wins) : (oppShared?.wins ?? 0),
  );

  const gamesPlayedLabel = $derived(
    duel
      ? `after ${duel.stoppedAtGame} game${duel.stoppedAtGame === 1 ? '' : 's'}`
      : 'after 82 games',
  );
  const seriesNote = $derived(
    duel
      ? Math.max(duel.p1Wins, duel.p2Wins) === 4 && Math.min(duel.p1Wins, duel.p2Wins) === 0
        ? 'Series sweep'
        : 'Series decided'
      : 'H2H mirrored',
  );
  const ppgByPlayerId = $derived.by(() => {
    const map = new Map<string, number>();
    if (!stats) return map;
    for (const line of [...stats.p1, ...stats.p2]) {
      if (line.games > 0) map.set(line.playerId, line.points / line.games);
    }
    return map;
  });
  const mvp = $derived.by(() => {
    if (!stats) return null;
    const all = [
      ...stats.p1.map((l) => ({ line: l, pid: 'p1' as const })),
      ...stats.p2.map((l) => ({ line: l, pid: 'p2' as const })),
    ].filter((c) => c.line.games > 0);
    if (all.length === 0) return null;
    all.sort((a, b) => b.line.points / b.line.games - a.line.points / a.line.games);
    const top = all[0]!;
    const rows = top.pid === 'p1' ? p1Rows : p2Rows;
    const entry = rows.find((r) => r?.playerId === top.line.playerId) ?? null;
    return { ...top, entry };
  });
  const comparison = $derived.by(() => {
    if (!stats) return null;
    const games = duel ? duel.stoppedAtGame : 82;
    function totals(pid: 'p1' | 'p2') {
      const lines = pid === 'p1' ? stats!.p1 : stats!.p2;
      let points = 0;
      let fgm = 0;
      let fga = 0;
      let tpm = 0;
      let tpa = 0;
      let ftm = 0;
      let fta = 0;
      let reb = 0;
      let tov = 0;
      for (const l of lines) {
        points += l.points;
        fgm += l.fieldGoalsMade;
        fga += l.fieldGoalsAttempted;
        tpm += l.threesMade;
        tpa += l.threesAttempted;
        ftm += l.freeThrowsMade;
        fta += l.freeThrowsAttempted;
        reb += l.rebounds;
        tov += l.turnovers;
      }
      return { points, fgm, fga, tpm, tpa, ftm, fta, reb, tov };
    }
    const youPid = selfId;
    const oppPid = selfId === 'p1' ? 'p2' : 'p1';
    const you = totals(youPid);
    const opp = totals(oppPid);
    return { games, you, opp };
  });
  const comparisonRows = $derived.by((): ComparisonRow[] | null => {
    const data = comparison;
    if (!data) return null;
    return [
      {
        label: 'Points per game',
        left: perGameText(data.you.points, data.games),
        right: perGameText(data.opp.points, data.games),
      },
      {
        label: 'FG%',
        left: pctStr(data.you.fgm, data.you.fga),
        right: pctStr(data.opp.fgm, data.opp.fga),
      },
      {
        label: '3P%',
        left: pctStr(data.you.tpm, data.you.tpa),
        right: pctStr(data.opp.tpm, data.opp.tpa),
      },
      {
        label: 'TS%',
        left: trueShootingPct(data.you.points, data.you.fga, data.you.fta),
        right: trueShootingPct(data.opp.points, data.opp.fga, data.opp.fta),
      },
      {
        label: 'Rebounds per game',
        left: perGameText(data.you.reb, data.games),
        right: perGameText(data.opp.reb, data.games),
      },
      {
        label: 'Turnovers per game',
        left: perGameText(data.you.tov, data.games),
        right: perGameText(data.opp.tov, data.games),
      },
    ];
  });
  const seriesRecapGames = $derived(
    duelScores.map((game) => ({
      gameNumber: game.gameNumber,
      won: game.won,
      score:
        game.youScore !== null && game.oppScore !== null
          ? `${game.youScore}–${game.oppScore}`
          : game.won
            ? 'W'
            : 'L',
    })),
  );
  const summaryDate = $derived.by(() => {
    if (!createdAt) return '—';
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });
  const heroEyebrow = $derived(
    !verified ? 'Result awaiting verification' : duel ? 'Series complete' : 'Season complete',
  );
  function viewMatchStats() {
    tab = 'team';
    document.getElementById('fixed-five-match-tabs')?.scrollIntoView({ behavior: 'smooth' });
  }
  function handleTabKey(event: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const button = event.currentTarget as HTMLButtonElement;
    const buttons = Array.from(
      button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = buttons.indexOf(button);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    const ids = ['overview', 'games', 'players', 'team'] as const;
    if (!ids[next] || !buttons[next]) return;
    tab = ids[next];
    buttons[next].focus();
  }
</script>

{#snippet resultBadges()}
  <Badge tone="positive">Verified locally</Badge>
{/snippet}

{#snippet resultHero()}
  <ResultHero
    score={`${youWins}-${oppWins}`}
    scoreLabel={duel
      ? `Series score ${youWins} to ${oppWins}`
      : `Record ${youWins} wins to ${oppWins}`}
    caption={seriesNote}
    secondary={gamesPlayedLabel}
    meta={roomCode ? `Room ${roomCode} · ${modeDetailLabel}` : modeDetailLabel}
    tone={youWon ? 'champion' : 'defeat'}
  />
{/snippet}

{#snippet resultActions()}
  <ActionRow>
    {#snippet primary()}
      <Button
        tone="primary"
        onclick={() => onRematch?.()}
        disabled={rematchBusy || rematchWaiting}
        loading={rematchBusy}
      >
        {rematchBusy ? 'Preparing rematch…' : rematchLabel}
        <ArrowRight size={16} aria-hidden="true" />
      </Button>
    {/snippet}
    {#snippet secondary()}
      <ActionLink href={resolve('multiplayer/')}>Choose another match</ActionLink>
    {/snippet}
    {#snippet tertiary()}
      <Button tone="ghost" onclick={viewMatchStats}>
        View match stats
        <ArrowRight size={14} aria-hidden="true" />
      </Button>
    {/snippet}
  </ActionRow>
{/snippet}

<ResultScreen
  eyebrow={heroEyebrow}
  title={youWon ? 'You win' : 'Opponent wins'}
  badges={verified ? resultBadges : null}
  hero={resultHero}
  actions={onRematch ? resultActions : null}
>
  {#if duel}
    <div class="px-4 py-4 sm:px-6">
      <SeriesRecap games={seriesRecapGames} label="Series games" />
    </div>
  {:else if shared && youShared && oppShared}
    <div
      class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 sm:px-6"
      aria-label="Season summary"
    >
      <Panel padding="none" class="border-primary/25 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">You</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {youShared.wins} <span class="text-muted-foreground">-</span>
          {youShared.losses}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Diff {youShared.differential >= 0 ? '+' : ''}{youShared.differential} · Final
        </p>
      </Panel>
      <Panel padding="none" class="border-primary/25 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">Opp</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {oppShared.wins} <span class="text-muted-foreground">-</span>
          {oppShared.losses}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Diff {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential} · Final
        </p>
      </Panel>
      <Panel padding="none" class="border-primary/25 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">H2H</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {youShared.h2hWins} <span class="text-muted-foreground">-</span>
          {oppShared.h2hWins}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Head to head · Final</p>
      </Panel>
      <Panel padding="none" class="border-primary/25 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">Tie-break</p>
        <p class="mt-1 text-xs font-bold">Wins → diff → seed</p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">H2H mirrored</p>
      </Panel>
    </div>
  {/if}

  <div
    id="fixed-five-match-tabs"
    class="flex gap-6 overflow-x-auto border-y border-border/60 px-4 sm:px-6"
    role="tablist"
    aria-label="Match sections"
  >
    {#each [['overview', 'Overview'], ['games', 'Games'], ['players', 'Players'], ['team', 'Team stats']] as [id, label] (id)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === id}
        id={`match-tab-${id}`}
        aria-controls="fixed-five-result-panel"
        tabindex={tab === id ? 0 : -1}
        onkeydown={handleTabKey}
        onclick={() => (tab = id as typeof tab)}
        class="border-b-2 py-3 font-mono text-xs font-bold tracking-widest uppercase {tab === id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        {label}
      </button>
    {/each}
  </div>

  <div
    role="tabpanel"
    id="fixed-five-result-panel"
    aria-labelledby={`match-tab-${tab}`}
    tabindex="0"
  >
    {#if tab === 'overview'}
      <div
        class="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch"
      >
        {#each ['p1', 'p2'] as const as pid, pi (pid)}
          {@const rows = pid === 'p1' ? p1Rows : p2Rows}
          {@const isYou = pid === selfId}
          {#if pi === 1}
            <div class="hidden items-center lg:flex" aria-hidden="true">
              <span
                class="grid h-10 w-10 place-items-center rounded-full border border-line-soft bg-surface-1 font-mono text-xs font-bold text-muted-foreground"
                >VS</span
              >
            </div>
          {/if}
          <Panel
            as="section"
            padding="none"
            aria-label={isYou ? 'Your five' : 'Opponent five'}
            class="p-4"
          >
            <h3 class="ui-label">
              {isYou ? 'Your five' : 'Opponent five'}
            </h3>
            <ul class="mt-2 flex flex-col divide-y divide-border/60">
              {#each rows as r, i (i)}
                <li class="flex min-w-0 items-center gap-3 py-2.5">
                  {#if r}
                    <PlayerFace
                      player={r}
                      {manifest}
                      size="sm"
                      fallbackInitials={r.firstName[0]! + r.lastName[0]!}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-bold">{r.displayName}</span>
                      <span class="block truncate font-mono text-[10px] text-muted-foreground">
                        {r.seasonKey} · {formatPositions(r.positionsPlayable)}
                      </span>
                    </span>
                    <span class="flex shrink-0 items-center gap-2">
                      <span class="font-mono text-sm font-bold tabular-nums">
                        {ppgByPlayerId.has(r.playerId)
                          ? `${ppgByPlayerId.get(r.playerId)!.toFixed(1)} `
                          : '— '}
                        <span class="text-[10px] font-normal text-muted-foreground">PPG</span>
                      </span>
                      <span class="flex items-end gap-[2px]" aria-hidden="true">
                        <span
                          class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                          style="height: 5px"
                        ></span>
                        <span
                          class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                          style="height: 8px"
                        ></span>
                        <span
                          class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                          style="height: 11px"
                        ></span>
                        <span
                          class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                          style="height: 14px"
                        ></span>
                      </span>
                    </span>
                  {:else}
                    <span class="text-sm text-muted-foreground">Slot {i + 1} — unknown</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </Panel>
        {/each}
      </div>

      <div class="grid gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-3">
        {#if mvp && mvp.entry}
          <MvpCard
            label="Series MVP"
            aria-label="Series MVP"
            name={mvp.entry.displayName}
            team={formatPositions(mvp.entry.positionsPlayable)}
            slot={mvp.pid === selfId ? 'You' : 'Opponent'}
            stats={[
              { label: 'PPG', value: perGameText(mvp.line.points, mvp.line.games) },
              { label: 'REB', value: perGameText(mvp.line.rebounds, mvp.line.games) },
              { label: 'AST', value: perGameText(mvp.line.assists, mvp.line.games) },
            ]}
          >
            {#snippet portrait()}
              {@const entry = mvp?.entry}
              {#if entry}
                <PlayerFace
                  player={entry}
                  {manifest}
                  size="md"
                  fallbackInitials={entry.firstName[0]! + entry.lastName[0]!}
                />
              {/if}
            {/snippet}
          </MvpCard>
        {:else}
          <Panel as="section" padding="none" aria-label="Series MVP" class="p-4">
            <h3 class="ui-label">Series MVP</h3>
            {#if statsState === 'building'}
              <EmptyState
                class="mt-3"
                kind="loading"
                surface="none"
                title="Finding the series MVP…"
              />
            {:else}
              <EmptyState class="mt-3" surface="none" title="MVP needs simulated games.">
                {#snippet actions()}
                  {#if onRebuildStats}
                    <Button size="sm" onclick={onRebuildStats}>Build player stats</Button>
                  {/if}
                {/snippet}
              </EmptyState>
            {/if}
          </Panel>
        {/if}

        <Panel as="section" padding="none" aria-label="Series comparison" class="p-4">
          <h3 class="ui-label">Series comparison</h3>
          {#if comparisonRows}
            <ComparisonTable class="mt-2" rows={comparisonRows} rightLabel="Opponent" />
          {:else}
            <EmptyState class="mt-3" surface="none" title="Comparison needs simulated games." />
          {/if}
        </Panel>

        <Panel as="section" padding="none" aria-label="Series summary" class="p-4">
          <h3 class="ui-label">Series summary</h3>
          <ul class="mt-3 flex flex-col gap-3 text-sm">
            <li class="flex items-center gap-3">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
                ><Calendar class="h-4 w-4 text-muted-foreground" /></span
              >

              <span>
                <span class="block font-mono text-[10px] text-muted-foreground uppercase">Date</span
                >

                <span class="font-semibold">{summaryDate}</span>
              </span>
            </li>
            <li class="flex items-center gap-3">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
                ><Gamepad2 class="h-4 w-4 text-muted-foreground" /></span
              >

              <span>
                <span class="block font-mono text-[10px] text-muted-foreground uppercase">Mode</span
                >

                <span class="font-semibold">{modeDetailLabel}</span>
              </span>
            </li>
            <li class="flex items-center gap-3">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
                ><Clock class="h-4 w-4 text-muted-foreground" /></span
              >

              <span>
                <span class="block font-mono text-[10px] text-muted-foreground uppercase"
                  >Games</span
                >

                <span class="font-semibold">
                  {duel
                    ? `${duel.stoppedAtGame} played · first to 4`
                    : '82 per side · H2H mirrored'}</span
                ></span
              >
            </li>
            <li class="flex items-center gap-3">
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
                ><Trophy class="h-4 w-4 text-muted-foreground" /></span
              >

              <span>
                <span class="block font-mono text-[10px] text-muted-foreground uppercase"
                  >Winner</span
                >

                <span class="font-semibold">
                  {youWon
                    ? `You (${youWins}–${oppWins})`
                    : `Opponent (${oppWins}–${youWins})`}</span
                ></span
              >
            </li>
          </ul>
        </Panel>
      </div>

      <div class="px-4 pb-4 sm:px-6 sm:pb-6">
        <Disclosure summary="Match details" meta="Click to view technical details">
          {#if digest}
            <p class="truncate font-mono text-[11px] text-muted-foreground" title={digest}>
              Digest: {digest.slice(0, 16)}…{digest.slice(-8)}
            </p>
            <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">{digest}</p>
          {:else}
            <p class="font-mono text-[11px] text-muted-foreground">No digest recorded yet.</p>
          {/if}
          <p class="mt-2 font-mono text-[11px] text-muted-foreground">
            Wins → differential → seeded tie-break · both clients simulate locally and confirm the
            digest.
          </p>
        </Disclosure>
      </div>
    {:else if tab === 'games'}
      <div class="p-4 sm:p-6">
        {#if duel}
          <ol class="grid gap-3 sm:grid-cols-2" aria-label="All series games">
            {#each duelScores as g (g.gameNumber)}
              <Panel as="li" padding="none" class="border-primary/25 p-4">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs text-muted-foreground">Game {g.gameNumber}</span>
                  <span
                    class="font-mono text-xs font-bold tracking-widest uppercase {g.won
                      ? 'text-positive'
                      : 'text-primary'}">{g.won ? 'Win' : 'Loss'}</span
                  >
                </div>
                <p class="font-display mt-2 text-3xl font-extrabold tabular-nums">
                  {#if g.youScore !== null && g.oppScore !== null}
                    {g.youScore} <span class="text-muted-foreground">-</span> {g.oppScore}
                  {:else}
                    <span class={g.won ? 'text-positive' : 'text-primary'}>{g.won ? 'W' : 'L'}</span
                    >
                  {/if}
                </p>
                <p class="mt-1 font-mono text-[11px] text-muted-foreground uppercase">
                  You · Opp · Final
                </p>
                {#if g.youScore === null}
                  <p class="mt-1 text-xs text-muted-foreground">
                    Score streams in once the simulated games rebuild on this device.
                  </p>
                {/if}
              </Panel>
            {/each}
          </ol>
          {#if duelScores.every((g) => g.youScore === null)}
            <p class="mt-3 text-xs text-muted-foreground">
              Scores need the simulated games, which are not on this device yet. Win/loss comes from
              the verified result.
            </p>
          {/if}
        {:else}
          {#if h2hScores.length > 0}
            <ol class="grid gap-3 sm:grid-cols-2" aria-label="Head-to-head games">
              {#each h2hScores as g (g.gameNumber)}
                <Panel as="li" padding="none" class="border-primary/25 p-4">
                  <div class="flex items-center justify-between">
                    <span class="font-mono text-xs text-muted-foreground"
                      >H2H · Game {g.gameNumber}</span
                    >
                    <span
                      class="font-mono text-xs font-bold tracking-widest uppercase {g.won
                        ? 'text-positive'
                        : 'text-primary'}">{g.won ? 'Win' : 'Loss'}</span
                    >
                  </div>
                  <p class="font-display mt-2 text-3xl font-extrabold tabular-nums">
                    {g.youScore} <span class="text-muted-foreground">-</span>
                    {g.oppScore}
                  </p>
                  <p class="mt-1 font-mono text-[11px] text-muted-foreground uppercase">
                    You · Opp · Final
                  </p>
                </Panel>
              {/each}
            </ol>
            <p class="mt-3 text-xs text-muted-foreground">
              Head-to-head games simulate once and mirror into both records. The remaining gauntlet
              games run against the shared bracket.
            </p>
          {:else if shared && youShared && oppShared}
            <div class="grid gap-3 sm:grid-cols-2">
              <Panel padding="none" class="p-4 text-center">
                <p class="font-mono text-[11px] text-muted-foreground uppercase">You</p>
                <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
                  {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
                </p>
                <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                  Diff {youShared.differential >= 0 ? '+' : ''}{youShared.differential} · H2H {youShared.h2hWins}
                </p>
              </Panel>
              <Panel padding="none" class="p-4 text-center">
                <p class="font-mono text-[11px] text-muted-foreground uppercase">Opponent</p>
                <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
                  {oppShared.wins}<span class="text-muted-foreground">–</span>{oppShared.losses}
                </p>
                <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                  Diff {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential} · H2H {oppShared.h2hWins}
                </p>
              </Panel>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">
              Per-game scores rebuild on this device after the simulated games stream back.
            </p>
          {/if}
        {/if}
      </div>
    {:else if tab === 'players'}
      <div class="p-4 sm:p-6">
        <PlayerStatsSection
          surface="none"
          ariaLabel="Player stats, both fives"
          title="Player stats · both fives"
          sideLabel="Stats side"
          sideOptions={statsSideOptions}
          side={statsSide}
          onsidechange={(next) => (statsSide = next)}
          rows={statsRows}
          columns={statsColumns}
          rowKey={(row) => row.entry?.playerId ?? `slot-${row.slotIndex}`}
          tableClass="min-w-[54rem] font-mono"
          caption={`${statsSide === 'you' ? 'Your five' : 'Opponent five'} series player stats`}
        >
          {#snippet identity(row)}
            <span class="ui-stats-player">
              {#if row.entry}
                <PlayerFace
                  player={row.entry}
                  {manifest}
                  size="sm"
                  fallbackInitials={row.entry.firstName[0]! + row.entry.lastName[0]!}
                />
                <span class="ui-stats-player-text">
                  <span class="ui-stats-player-name">{row.entry.displayName}</span>
                  <span class="ui-stats-player-meta">
                    {row.line ? `${row.line.games} games` : 'no games'}
                  </span>
                </span>
              {:else}
                <span class="ui-stats-player-meta">Slot {row.slotIndex + 1}</span>
              {/if}
            </span>
          {/snippet}
          {#snippet cards()}
            {#each statsRows ?? [] as row (row.slotIndex)}
              {@const line = row.line}
              <article class="min-w-0 rounded-lg border border-border bg-surface-1 px-4 py-3">
                <div class="flex items-start gap-3">
                  {#if row.entry}
                    <PlayerFace
                      player={row.entry}
                      {manifest}
                      size="sm"
                      fallbackInitials={row.entry.firstName[0]! + row.entry.lastName[0]!}
                    />
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-bold">
                          {row.entry?.displayName ?? `Slot ${row.slotIndex + 1}`}
                        </p>
                        <p class="font-mono text-[10px] text-muted-foreground">
                          {line ? `${line.games} games` : 'no games'}
                        </p>
                      </div>
                      {#if line}
                        <p class="shrink-0 font-mono text-sm font-bold tabular-nums">
                          {statValue(line.points, line.games)} PTS
                        </p>
                      {/if}
                    </div>
                  </div>
                </div>
                {#if line}
                  <div class="mt-3 grid min-w-0 grid-cols-2 gap-x-4 text-xs font-mono tabular-nums">
                    <div class="min-w-0 divide-y divide-border/40">
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">MIN</span>
                        <span class="font-semibold text-foreground"
                          >{statValue(line.minutes, line.games)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">FG%</span>
                        <span class="font-semibold text-foreground"
                          >{pctStr(line.fieldGoalsMade, line.fieldGoalsAttempted)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">3P%</span>
                        <span class="font-semibold text-foreground"
                          >{pctStr(line.threesMade, line.threesAttempted)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">FT%</span>
                        <span class="font-semibold text-foreground"
                          >{pctStr(line.freeThrowsMade, line.freeThrowsAttempted)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">TS%</span>
                        <span class="font-semibold text-foreground"
                          >{trueShootingPct(
                            line.points,
                            line.fieldGoalsAttempted,
                            line.freeThrowsAttempted,
                          )}</span
                        >
                      </div>
                    </div>
                    <div class="min-w-0 divide-y divide-border/40">
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">REB</span>
                        <span class="font-semibold text-foreground"
                          >{statValue(line.rebounds, line.games)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">AST</span>
                        <span class="font-semibold text-foreground"
                          >{statValue(line.assists, line.games)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">STL</span>
                        <span class="font-semibold text-foreground"
                          >{statValue(line.steals, line.games)}</span
                        >
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">BLK / TOV</span>
                        <span class="font-semibold text-foreground">
                          {statValue(line.blocks, line.games)} / {statValue(
                            line.turnovers,
                            line.games,
                          )}
                        </span>
                      </div>
                      <div class="flex items-center justify-between gap-2 py-1.5">
                        <span class="text-muted-foreground">USG%</span>
                        <span class="font-semibold text-foreground"
                          >{usagePct(
                            usagePossessions(
                              line.fieldGoalsAttempted,
                              line.freeThrowsAttempted,
                              line.turnovers,
                            ),
                            statsTeamUsage,
                          )}</span
                        >
                      </div>
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          {/snippet}
          {#snippet empty()}
            {#if statsState === 'building'}
              <EmptyState
                kind="loading"
                surface="none"
                title="Building player stats from the simulated games…"
              />
            {:else}
              <EmptyState
                surface="none"
                title="Stats need the simulated games, which are not on this device."
              >
                {#snippet actions()}
                  {#if onRebuildStats}
                    <Button size="sm" onclick={onRebuildStats}>Build player stats</Button>
                  {/if}
                {/snippet}
              </EmptyState>
            {/if}
          {/snippet}
        </PlayerStatsSection>
      </div>
    {:else}
      <div class="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <Panel as="section" padding="none" aria-label="Team comparison detail" class="p-4">
          <h3 class="ui-label">Team comparison</h3>
          {#if comparisonRows}
            <ComparisonTable class="mt-2" rows={comparisonRows} rightLabel="Opponent" />
          {:else}
            <EmptyState class="mt-3" surface="none" title="Comparison needs simulated games.">
              {#snippet actions()}
                {#if onRebuildStats}
                  <Button size="sm" onclick={onRebuildStats}>Build player stats</Button>
                {/if}
              {/snippet}
            </EmptyState>
          {/if}
        </Panel>
        <Panel as="section" padding="none" aria-label="Verification" class="p-4">
          <h3 class="ui-label">Verification</h3>
          <ul class="mt-3 flex flex-col gap-2 font-mono text-[11px] text-muted-foreground">
            <li class="flex items-center gap-2">
              <ShieldCheck class="h-4 w-4" />
              {verified
                ? 'Verified locally against the accepted command log'
                : 'Verification receipt pending'}
            </li>
            <li>Mode · {modeDetailLabel}</li>
            {#if digest}
              <li class="break-all" title={digest}>Digest · {digest}</li>
            {:else}
              <li>No digest recorded yet.</li>
            {/if}
            {#if receiptDigest}
              <li class="break-all" title={receiptDigest}>Receipt · {receiptDigest}</li>
            {/if}
            {#if shared}
              <li>Tie-break · {shared.tiebreakPath}</li>
              <li>Ranking · {shared.ranking.join(' → ')}</li>
            {/if}
            {#if duel}
              <li>First to 4 · stopped at game {duel.stoppedAtGame}</li>
            {/if}
          </ul>
        </Panel>
      </div>
    {/if}
  </div>
</ResultScreen>
