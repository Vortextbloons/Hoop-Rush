<script lang="ts">
  import {
    ArrowRight,
    Calendar,
    ChevronDown,
    Clock,
    Gamepad2,
    ShieldCheck,
    Trophy,
  } from '@lucide/svelte';
  import type {
    FixedFiveCompetitionResult,
    FixedFiveRoomMode,
    FixedFiveWorkerResultEntry,
    HoopRushManifest,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { formatPositions } from '$lib/player-positions';
  import type { DraftPresentation } from '$lib/draft-presentation';
  import type { FixedFivePlayerStats } from '$lib/fixed-five-player-stats';
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
    onRematch = null,
    onNewRoom = null,
    rematchBusy = false,
    canNewRoom = true,
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
    onRematch?: (() => void) | null;
    onNewRoom?: (() => void) | null;
    rematchBusy?: boolean;
    canNewRoom?: boolean;
  } = $props();
  let tab = $state<'overview' | 'games' | 'players' | 'team'>('overview');
  let statsSide = $state<'you' | 'opp'>('you');
  let statsTotals = $state(false);
  const statsPid = $derived<'p1' | 'p2'>(
    statsSide === 'you' ? selfId : selfId === 'p1' ? 'p2' : 'p1',
  );
  const statsRows = $derived(statsPid === 'p1' ? p1Rows : p2Rows);
  const statsLines = $derived.by(() => {
    const lines = stats ? (statsPid === 'p1' ? stats.p1 : stats.p2) : [];
    return new Map(lines.map((line) => [line.playerId, line]));
  });
  function perGame(value: number, games: number): string {
    return (value / Math.max(1, games)).toFixed(1);
  }
  function statValue(value: number, games: number): string {
    return statsTotals ? String(value) : perGame(value, games);
  }
  function pctStr(made: number, attempted: number): string {
    if (attempted <= 0) return '—';
    return `${((made / attempted) * 100).toFixed(1)}%`;
  }
  const modeLabel = $derived(
    mode === 'duel'
      ? 'Duel · Best of 7'
      : mode === 'sandbox-shared-82'
        ? 'Sandbox · Shared 82'
        : 'Classic · Shared 82',
  );
  const modeDetailLabel = $derived(modeDetail ?? `Fixed-Five · ${modeLabel}`);
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
      let reb = 0;
      let tov = 0;
      for (const l of lines) {
        points += l.points;
        fgm += l.fieldGoalsMade;
        fga += l.fieldGoalsAttempted;
        tpm += l.threesMade;
        tpa += l.threesAttempted;
        reb += l.rebounds;
        tov += l.turnovers;
      }
      return { points, fgm, fga, tpm, tpa, reb, tov };
    }
    const youPid = selfId;
    const oppPid = selfId === 'p1' ? 'p2' : 'p1';
    const you = totals(youPid);
    const opp = totals(oppPid);
    return { games, you, opp };
  });
  const summaryDate = $derived.by(() => {
    if (!createdAt) return '—';
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  });
  const heroEyebrow = $derived(duel ? 'Series complete' : 'Shared 82 complete');
  function viewMatchStats() {
    tab = 'team';
    document.getElementById('fixed-five-match-tabs')?.scrollIntoView({ behavior: 'smooth' });
  }
</script>

<div class="rounded-2xl border border-primary/25 bg-card shadow-[0_0_40px_hsl(13_100%_62%/0.12)]">
  <div class="border-b border-border/60 px-4 py-6 text-center sm:px-8 sm:py-8">
    <div
      class="flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase"
    >
      <span class="text-primary">{heroEyebrow}</span>
      {#if verified}
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-2.5 py-0.5 text-[10px] font-bold text-positive"
        >
          <span aria-hidden="true" class="inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
          Result verified
        </span>
      {/if}
    </div>
    <h2 class="font-display mt-3 text-4xl font-extrabold tracking-tight uppercase sm:text-5xl">
      {#if youWon}<span class="text-primary">You</span> <span>win</span>{:else}<span
          class="text-primary">Opponent</span
        >
        <span>wins</span>{/if}
    </h2>
    <p
      class="font-display mt-2 text-5xl font-extrabold tabular-nums sm:text-6xl"
      aria-label={duel
        ? `Series score ${youWins} to ${oppWins}`
        : `Record ${youWins} wins to ${oppWins}`}
    >
      <span class={youWon ? 'text-primary' : ''}>{youWins}</span><span
        class="mx-2 text-muted-foreground">-</span
      ><span class={youWon ? '' : 'text-primary'}>{oppWins}</span>
    </p>
    <p class="mt-2 font-mono text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
      {seriesNote}
    </p>
    <p class="mt-1 text-sm text-muted-foreground">{gamesPlayedLabel}</p>
    {#if roomCode}
      <p class="mt-2 font-mono text-[11px] text-muted-foreground">
        Room {roomCode} · {modeDetailLabel}
      </p>
    {:else}
      <p class="mt-2 font-mono text-[11px] text-muted-foreground">{modeDetailLabel}</p>
    {/if}
  </div>

  {#if duel}
    <div class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 sm:px-6" aria-label="Series games">
      {#each duelScores as g (g.gameNumber)}
        <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
          <div class="flex items-center justify-between">
            <span class="font-mono text-[11px] text-muted-foreground">G{g.gameNumber}</span>
            <span
              class="font-mono text-[11px] font-bold tracking-widest uppercase {g.won
                ? 'text-positive'
                : 'text-primary'}">{g.won ? 'Win' : 'Loss'}</span
            >
          </div>
          <p class="font-display mt-2 text-2xl font-extrabold tabular-nums">
            {#if g.youScore !== null && g.oppScore !== null}
              {g.youScore} <span class="text-muted-foreground">-</span> {g.oppScore}
            {:else}
              <span class={g.won ? 'text-positive' : 'text-primary'}>{g.won ? 'W' : 'L'}</span>
            {/if}
          </p>
          <p class="mt-1 font-mono text-[10px] text-muted-foreground uppercase">You · Opp</p>
          <p class="font-mono text-[10px] text-muted-foreground">Final</p>
        </div>
      {/each}
    </div>
  {:else if shared && youShared && oppShared}
    <div
      class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 sm:px-6"
      aria-label="Gauntlet summary"
    >
      <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">You</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {youShared.wins} <span class="text-muted-foreground">-</span>
          {youShared.losses}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Diff {youShared.differential >= 0 ? '+' : ''}{youShared.differential} · Final
        </p>
      </div>
      <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">Opp</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {oppShared.wins} <span class="text-muted-foreground">-</span>
          {oppShared.losses}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Diff {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential} · Final
        </p>
      </div>
      <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">H2H</p>
        <p class="font-display mt-1 text-2xl font-extrabold tabular-nums">
          {youShared.h2hWins} <span class="text-muted-foreground">-</span>
          {oppShared.h2hWins}
        </p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">Head to head · Final</p>
      </div>
      <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
        <p class="font-mono text-[11px] text-muted-foreground uppercase">Tie-break</p>
        <p class="mt-1 text-xs font-bold">Wins → diff → seed</p>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">H2H mirrored</p>
      </div>
    </div>
  {/if}

  {#if onRematch || onNewRoom}
    <div class="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-center sm:px-6">
      {#if onRematch}
        <button
          type="button"
          onclick={onRematch}
          disabled={rematchBusy}
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold tracking-widest uppercase text-primary-foreground disabled:opacity-40"
        >
          {rematchBusy ? 'Working…' : '⟳ Rematch'}
        </button>
      {/if}
      {#if onNewRoom}
        <button
          type="button"
          onclick={onNewRoom}
          disabled={!canNewRoom || rematchBusy}
          title={canNewRoom ? 'Create the successor room' : 'Needs both confirmations first'}
          class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line-soft bg-surface-1 px-6 py-3 text-sm font-bold tracking-widest uppercase disabled:opacity-40"
        >
          ⊕ New room
        </button>
      {/if}
      <button
        type="button"
        onclick={viewMatchStats}
        class="inline-flex items-center justify-center gap-1.5 px-4 py-3 font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-foreground sm:ml-auto"
      >
        View match stats <ArrowRight class="h-4 w-4" />
      </button>
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
        onclick={() => (tab = id as typeof tab)}
        class="border-b-2 py-3 font-mono text-xs font-bold tracking-widest uppercase {tab === id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        {label}
      </button>
    {/each}
  </div>

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
        <section
          aria-label={isYou ? 'Your five' : 'Opponent five'}
          class="rounded-xl border border-line-soft bg-surface-1 p-4"
        >
          <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
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
        </section>
      {/each}
    </div>

    <div class="grid gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-3">
      <section
        aria-label="Series MVP"
        class="rounded-xl border border-line-soft bg-surface-1 p-4 text-center"
      >
        <h3
          class="text-left font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase"
        >
          Series MVP
        </h3>
        {#if mvp && mvp.entry}
          <div class="mx-auto mt-2 h-16 w-16 overflow-hidden rounded-full">
            <PlayerFace
              player={mvp.entry}
              {manifest}
              size="md"
              fallbackInitials={mvp.entry.firstName[0]! + mvp.entry.lastName[0]!}
            />
          </div>
          <p class="font-display mt-2 text-xl font-extrabold">{mvp.entry.displayName}</p>
          <p class="font-mono text-[11px] text-muted-foreground">
            {formatPositions(mvp.entry.positionsPlayable)} · {mvp.pid === selfId
              ? 'You'
              : 'Opponent'}
          </p>
          <div class="mt-3 grid grid-cols-3 divide-x divide-border/60">
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {perGame(mvp.line.points, mvp.line.games)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">PPG</p>
            </div>
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {perGame(mvp.line.rebounds, mvp.line.games)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">REB</p>
            </div>
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {perGame(mvp.line.assists, mvp.line.games)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">AST</p>
            </div>
          </div>
        {:else if statsState === 'building'}
          <p class="mt-3 animate-pulse text-sm text-muted-foreground" role="status">
            Finding the series MVP…
          </p>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">MVP needs simulated games.</p>
          {#if onRebuildStats}
            <button
              type="button"
              onclick={onRebuildStats}
              class="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold"
            >
              Build player stats
            </button>
          {/if}
        {/if}
      </section>

      <section
        aria-label="Series comparison"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Series comparison
        </h3>
        {#if comparison}
          <table class="mt-2 w-full text-sm">
            <thead>
              <tr class="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                <th scope="col" class="py-1 text-left">You</th>
                <th scope="col" class="py-1 text-center">Stat</th>
                <th scope="col" class="py-1 text-right">Opponent</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/50 tabular-nums">
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.points, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Points per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.points, comparison.games)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pctStr(comparison.you.fgm, comparison.you.fga)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">FG%</td>
                <td class="py-2 text-right font-bold"
                  >{pctStr(comparison.opp.fgm, comparison.opp.fga)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pctStr(comparison.you.tpm, comparison.you.tpa)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">3P%</td>
                <td class="py-2 text-right font-bold"
                  >{pctStr(comparison.opp.tpm, comparison.opp.tpa)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.reb, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Rebounds per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.reb, comparison.games)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.tov, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Turnovers per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.tov, comparison.games)}</td
                >
              </tr>
            </tbody>
          </table>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">Comparison needs simulated games.</p>
        {/if}
      </section>

      <section
        aria-label="Series summary"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Series summary
        </h3>
        <ul class="mt-3 flex flex-col gap-3 text-sm">
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Calendar class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase">Date</span
              ><span class="font-semibold">{summaryDate}</span></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Gamepad2 class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase">Mode</span
              ><span class="font-semibold">{modeDetailLabel}</span></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Clock class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase">Games</span
              ><span class="font-semibold"
                >{duel
                  ? `${duel.stoppedAtGame} played · first to 4`
                  : '82 per side · H2H mirrored'}</span
              ></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Trophy class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase"
                >Winner</span
              ><span class="font-semibold"
                >{youWon ? `You (${youWins}–${oppWins})` : `Opponent (${oppWins}–${youWins})`}</span
              ></span
            >
          </li>
        </ul>
      </section>
    </div>

    <div class="px-4 pb-4 sm:px-6 sm:pb-6">
      <details class="rounded-xl border border-line-soft bg-surface-1">
        <summary
          class="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden"
        >
          <ShieldCheck class="h-5 w-5 text-muted-foreground" />
          <span class="font-mono text-xs font-bold tracking-widest uppercase">Match details</span>
          <span class="text-xs text-muted-foreground">Click to view technical details</span>
          <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground" />
        </summary>
        <div class="border-t border-border/60 p-4">
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
        </div>
      </details>
    </div>
  {:else if tab === 'games'}
    <div class="p-4 sm:p-6">
      {#if duel}
        <ol class="grid gap-3 sm:grid-cols-2" aria-label="All series games">
          {#each duelScores as g (g.gameNumber)}
            <li class="rounded-xl border border-primary/25 bg-surface-1 p-4">
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
                  <span class={g.won ? 'text-positive' : 'text-primary'}>{g.won ? 'W' : 'L'}</span>
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
            </li>
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
              <li class="rounded-xl border border-primary/25 bg-surface-1 p-4">
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
              </li>
            {/each}
          </ol>
          <p class="mt-3 text-xs text-muted-foreground">
            Head-to-head games simulate once and mirror into both records. The remaining gauntlet
            games run against the shared bracket.
          </p>
        {:else if shared && youShared && oppShared}
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-line-soft bg-surface-1 p-4 text-center">
              <p class="font-mono text-[11px] text-muted-foreground uppercase">You</p>
              <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
                {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
              </p>
              <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                Diff {youShared.differential >= 0 ? '+' : ''}{youShared.differential} · H2H {youShared.h2hWins}
              </p>
            </div>
            <div class="rounded-xl border border-line-soft bg-surface-1 p-4 text-center">
              <p class="font-mono text-[11px] text-muted-foreground uppercase">Opponent</p>
              <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
                {oppShared.wins}<span class="text-muted-foreground">–</span>{oppShared.losses}
              </p>
              <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                Diff {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential} · H2H {oppShared.h2hWins}
              </p>
            </div>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">
            Per-game scores rebuild on this device after the simulated games stream back.
          </p>
        {/if}
      {/if}
    </div>
  {:else if tab === 'players'}
    <section aria-label="Player stats, both fives" class="p-4 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">
          Player stats · both fives
        </h3>
        <div class="flex flex-wrap items-center gap-2">
          <div
            class="flex rounded-lg border border-border p-0.5"
            role="group"
            aria-label="Stats side"
          >
            <button
              type="button"
              aria-pressed={statsSide === 'you'}
              onclick={() => (statsSide = 'you')}
              class="rounded-md px-3 py-1 font-mono text-xs font-semibold {statsSide === 'you'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'}"
            >
              You
            </button>
            <button
              type="button"
              aria-pressed={statsSide === 'opp'}
              onclick={() => (statsSide = 'opp')}
              class="rounded-md px-3 py-1 font-mono text-xs font-semibold {statsSide === 'opp'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'}"
            >
              Opponent
            </button>
          </div>
          <div
            class="flex rounded-lg border border-border p-0.5"
            role="group"
            aria-label="Stats values"
          >
            <button
              type="button"
              aria-pressed={!statsTotals}
              onclick={() => (statsTotals = false)}
              class="rounded-md px-3 py-1 font-mono text-xs font-semibold {!statsTotals
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'}"
            >
              Per game
            </button>
            <button
              type="button"
              aria-pressed={statsTotals}
              onclick={() => (statsTotals = true)}
              class="rounded-md px-3 py-1 font-mono text-xs font-semibold {statsTotals
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'}"
            >
              Totals
            </button>
          </div>
        </div>
      </div>

      {#if statsState === 'building'}
        <p class="mt-3 animate-pulse text-sm text-muted-foreground" role="status">
          Building player stats from the simulated games…
        </p>
      {:else if statsState !== 'ready' || !stats}
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <p class="text-sm text-muted-foreground">
            Stats need the simulated games, which are not on this device.
          </p>
          {#if onRebuildStats}
            <button
              type="button"
              onclick={onRebuildStats}
              class="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong"
            >
              Build player stats
            </button>
          {/if}
        </div>
      {:else}
        <div class="mt-4 hidden overflow-x-auto sm:block">
          <table class="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr
                class="border-b border-border font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                <th scope="col" class="py-2 pr-3 text-left">Player</th>
                <th scope="col" class="px-2 py-2 text-right">Min</th>
                <th scope="col" class="px-2 py-2 text-right">PTS</th>
                <th scope="col" class="px-2 py-2 text-right">FG%</th>
                <th scope="col" class="px-2 py-2 text-right">3P%</th>
                <th scope="col" class="px-2 py-2 text-right">FT%</th>
                <th scope="col" class="px-2 py-2 text-right">REB</th>
                <th scope="col" class="px-2 py-2 text-right">AST</th>
                <th scope="col" class="px-2 py-2 text-right">STL</th>
                <th scope="col" class="px-2 py-2 text-right">BLK</th>
                <th scope="col" class="px-2 py-2 text-right">TOV</th>
              </tr>
            </thead>
            <tbody>
              {#each statsRows as row, i (i)}
                {@const line = row ? statsLines.get(row.playerId) : undefined}
                <tr class="border-b border-border/50 last:border-0">
                  <th scope="row" class="py-2 pr-3 text-left">
                    <span class="flex items-center gap-2">
                      {#if row}
                        <PlayerFace
                          player={row}
                          {manifest}
                          size="sm"
                          fallbackInitials={row.firstName[0]! + row.lastName[0]!}
                        />
                        <span class="min-w-0">
                          <span class="block truncate font-semibold">{row.displayName}</span>
                          <span class="block font-mono text-[10px] text-muted-foreground">
                            {line ? `${line.games} games` : 'no games'}
                          </span>
                        </span>
                      {:else}
                        <span class="font-mono text-xs">Slot {i + 1}</span>
                      {/if}
                    </span>
                  </th>
                  {#if line}
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.minutes, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono font-bold"
                      >{statValue(line.points, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{pctStr(line.fieldGoalsMade, line.fieldGoalsAttempted)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{pctStr(line.threesMade, line.threesAttempted)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{pctStr(line.freeThrowsMade, line.freeThrowsAttempted)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.rebounds, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.assists, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.steals, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.blocks, line.games)}</td
                    >
                    <td class="px-2 py-2 text-right font-mono"
                      >{statValue(line.turnovers, line.games)}</td
                    >
                  {:else}
                    <td colspan="10" class="px-2 py-2 text-right font-mono text-muted-foreground"
                      >—</td
                    >
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="mt-4 grid min-w-0 gap-2 sm:hidden">
          {#each statsRows as row, i (i)}
            {@const line = row ? statsLines.get(row.playerId) : undefined}
            <article class="min-w-0 rounded-lg border border-border bg-surface-1 px-4 py-3">
              <div class="flex items-start gap-3">
                {#if row}
                  <PlayerFace
                    player={row}
                    {manifest}
                    size="sm"
                    fallbackInitials={row.firstName[0]! + row.lastName[0]!}
                  />
                {/if}
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-bold">
                        {row?.displayName ?? `Slot ${i + 1}`}
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
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <div class="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
      <section
        aria-label="Team comparison detail"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Team comparison
        </h3>
        {#if comparison}
          <table class="mt-2 w-full text-sm">
            <thead>
              <tr class="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                <th scope="col" class="py-1 text-left">You</th>
                <th scope="col" class="py-1 text-center">Stat</th>
                <th scope="col" class="py-1 text-right">Opponent</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/50 tabular-nums">
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.points, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Points per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.points, comparison.games)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pctStr(comparison.you.fgm, comparison.you.fga)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">FG%</td>
                <td class="py-2 text-right font-bold"
                  >{pctStr(comparison.opp.fgm, comparison.opp.fga)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pctStr(comparison.you.tpm, comparison.you.tpa)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">3P%</td>
                <td class="py-2 text-right font-bold"
                  >{pctStr(comparison.opp.tpm, comparison.opp.tpa)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.reb, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Rebounds per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.reb, comparison.games)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGame(comparison.you.tov, comparison.games)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Turnovers per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGame(comparison.opp.tov, comparison.games)}</td
                >
              </tr>
            </tbody>
          </table>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">Comparison needs simulated games.</p>
          {#if onRebuildStats}
            <button
              type="button"
              onclick={onRebuildStats}
              class="mt-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold"
            >
              Build player stats
            </button>
          {/if}
        {/if}
      </section>
      <section
        aria-label="Verification"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Verification
        </h3>
        <ul class="mt-3 flex flex-col gap-2 font-mono text-[11px] text-muted-foreground">
          <li class="flex items-center gap-2">
            <ShieldCheck class="h-4 w-4" />
            {verified ? 'Result verified by both clients' : 'Awaiting peer confirmation'}
          </li>
          <li>Mode · {modeDetailLabel}</li>
          {#if digest}
            <li class="break-all" title={digest}>Digest · {digest}</li>
          {:else}
            <li>No digest recorded yet.</li>
          {/if}
          {#if shared}
            <li>Tie-break · {shared.tiebreakPath}</li>
            <li>Ranking · {shared.ranking.join(' → ')}</li>
          {/if}
          {#if duel}
            <li>First to 4 · stopped at game {duel.stoppedAtGame}</li>
          {/if}
        </ul>
      </section>
    </div>
  {/if}
</div>
