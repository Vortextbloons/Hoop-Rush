<script lang="ts">
  import type {
    FixedFiveCompetitionResult,
    FixedFiveRoomMode,
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
  } = $props();

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
</script>

<div
  class="overflow-hidden rounded-2xl border border-line-strong bg-card shadow-[0_0_32px_hsl(13_100%_62%/0.14)]"
>
  <div class="border-b border-border/60 px-4 py-4 sm:px-6">
    <p class="font-mono text-[11px] tracking-[0.16em] text-primary uppercase">{modeLabel}</p>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <h2 class="font-display text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        {#if youWon}<span class="text-primary">You win</span>{:else}<span class="text-destructive"
            >Opponent wins</span
          >{/if}
      </h2>
      {#if shared && youShared && oppShared}
        <p class="font-display text-xl font-extrabold tabular-nums">
          {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground"
            >opp {oppShared.wins}–{oppShared.losses}</span
          >
        </p>
      {/if}
      {#if duel}
        <p class="font-display text-xl font-extrabold tabular-nums">
          {duel.p1Wins === duel.p2Wins ? '' : ''}{selfId === 'p1' ? duel.p1Wins : duel.p2Wins}<span
            class="text-muted-foreground">–</span
          >{selfId === 'p1' ? duel.p2Wins : duel.p1Wins}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground"
            >after {duel.stoppedAtGame}</span
          >
        </p>
      {/if}
    </div>
    {#if shared}
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">
        Wins → differential → seeded tie-break · H2H mirrored
      </p>
    {/if}
    {#if digest}
      <p
        class="mt-2 truncate font-mono text-[11px] text-muted-foreground"
        title={digest}
        aria-label="Result digest"
      >
        Digest {digest.slice(0, 16)}…{digest.slice(-8)}
      </p>
    {/if}
  </div>

  {#if shared && youShared && oppShared}
    <div class="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6">
      <div class="rounded-xl border border-primary/50 bg-primary/5 p-4">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">You</p>
        <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
          {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Diff</dt>
            <dd class="font-bold tabular-nums">
              {youShared.differential >= 0 ? '+' : ''}{youShared.differential}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">H2H</dt>
            <dd class="font-bold tabular-nums">{youShared.h2hWins}</dd>
          </div>
        </dl>
      </div>
      <div class="rounded-xl border border-line-soft bg-surface-1 p-4">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Opponent
        </p>
        <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
          {oppShared.wins}<span class="text-muted-foreground">–</span>{oppShared.losses}
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Diff</dt>
            <dd class="font-bold tabular-nums">
              {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">H2H</dt>
            <dd class="font-bold tabular-nums">{oppShared.h2hWins}</dd>
          </div>
        </dl>
      </div>
    </div>
  {/if}

  {#if duel}
    <div class="px-4 py-4 sm:px-6">
      <ol class="flex flex-wrap items-center gap-2" aria-label="Duel series games">
        {#each duel.games as g (g.gameNumber)}
          {@const won = g.winner === selfId}
          <li
            class="flex min-w-20 flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm sm:max-w-36 {won
              ? 'border-primary/50 bg-primary/10'
              : 'border-line-soft bg-surface-1'}"
          >
            <span class="font-mono text-[11px] text-muted-foreground">G{g.gameNumber}</span>
            <span
              class="font-display text-sm font-extrabold {won
                ? 'text-primary'
                : 'text-destructive'}">{won ? 'W' : 'L'}</span
            >
          </li>
        {/each}
      </ol>
      <p class="mt-2 font-mono text-[11px] text-muted-foreground">
        {duel.winner === selfId ? 'You' : 'Opponent'} took the series {Math.max(
          duel.p1Wins,
          duel.p2Wins,
        )}–{Math.min(duel.p1Wins, duel.p2Wins)} · first to 4
      </p>
    </div>
  {/if}

  <div class="grid gap-3 border-t border-border/60 px-4 py-4 sm:grid-cols-2 sm:px-6">
    {#each ['p1', 'p2'] as const as pid (pid)}
      {@const rows = pid === 'p1' ? p1Rows : p2Rows}
      <div class="rounded-xl bg-surface-1">
        <p
          class="px-3 pt-3 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase"
        >
          {laneName(pid)} · five
        </p>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each rows as r, i (i)}
            <li class="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
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
                    {r.seasonKey} · {formatPositions(r.positionsPlayable)}{showRatings
                      ? ` · O ${r.overall}`
                      : ''}
                  </span>
                </span>
              {:else}
                <span class="text-sm text-muted-foreground">Slot {i + 1} — unknown</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>

  <section
    aria-labelledby="fixed-five-stats-heading"
    class="border-t border-border/60 px-4 py-4 sm:px-6"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3
        id="fixed-five-stats-heading"
        class="font-display text-lg font-extrabold tracking-tight uppercase"
      >
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
                  <td class="px-2 py-2 text-right font-mono font-bold">
                    {statValue(line.points, line.games)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pctStr(line.fieldGoalsMade, line.fieldGoalsAttempted)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pctStr(line.threesMade, line.threesAttempted)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pctStr(line.freeThrowsMade, line.freeThrowsAttempted)}
                  </td>
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
                  <td class="px-2 py-2 text-right font-mono">
                    {statValue(line.turnovers, line.games)}
                  </td>
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
      <div class="mt-4 grid gap-2 sm:hidden">
        {#each statsRows as row, i (i)}
          {@const line = row ? statsLines.get(row.playerId) : undefined}
          <article class="rounded-lg border border-border bg-surface-1 p-3">
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
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-bold">{row?.displayName ?? `Slot ${i + 1}`}</p>
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
              <table class="mt-3 w-full text-xs">
                <tbody class="font-mono tabular-nums">
                  <tr class="border-b border-border/40">
                    <td class="py-1.5 pr-2 text-muted-foreground">MIN</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {statValue(line.minutes, line.games)}
                    </td>
                    <td class="py-1.5 pr-2 pl-3 text-muted-foreground">REB</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {statValue(line.rebounds, line.games)}
                    </td>
                  </tr>
                  <tr class="border-b border-border/40">
                    <td class="py-1.5 pr-2 text-muted-foreground">FG%</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {pctStr(line.fieldGoalsMade, line.fieldGoalsAttempted)}
                    </td>
                    <td class="py-1.5 pr-2 pl-3 text-muted-foreground">AST</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {statValue(line.assists, line.games)}
                    </td>
                  </tr>
                  <tr class="border-b border-border/40">
                    <td class="py-1.5 pr-2 text-muted-foreground">3P%</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {pctStr(line.threesMade, line.threesAttempted)}
                    </td>
                    <td class="py-1.5 pr-2 pl-3 text-muted-foreground">STL</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {statValue(line.steals, line.games)}
                    </td>
                  </tr>
                  <tr>
                    <td class="py-1.5 pr-2 text-muted-foreground">FT%</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {pctStr(line.freeThrowsMade, line.freeThrowsAttempted)}
                    </td>
                    <td class="py-1.5 pr-2 pl-3 text-muted-foreground">BLK / TOV</td>
                    <td class="py-1.5 text-right font-semibold text-foreground">
                      {statValue(line.blocks, line.games)} / {statValue(line.turnovers, line.games)}
                    </td>
                  </tr>
                </tbody>
              </table>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
