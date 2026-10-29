<script lang="ts">
  import { Handshake, RefreshCcw, Trophy } from '@lucide/svelte';
  import type {
    HavocMultiplayerDraftPick,
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import type {
    HavocMultiplayerGameOutput,
    HavocMultiplayerSeriesMvp,
  } from '@hoop-rush/persistence';
  import HavocMutationList from '#lib/features/havoc/HavocMutationList.svelte';
  import HavocPlayerArt from '#lib/features/havoc/HavocPlayerArt.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { perGameText, ratioPct, trueShootingPct } from '#lib/format.js';
  import HavocMultiplayerBoxScore from './HavocMultiplayerBoxScore.svelte';
  import { havocMultiplayerFinalBoxes } from './havoc-multiplayer-playback-view';
  import { havocMultiplayerSeriesStats } from './havoc-multiplayer-series-stats';
  import { mutationNameOf, formatSignedPoints } from '#lib/features/havoc/havoc-presentation.js';
  import {
    havocMultiplayerMvpPick,
    havocMultiplayerSeriesRows,
  } from './havoc-multiplayer-room-view';

  let {
    series,
    mvp,
    picks,
    outputs,
    localParticipantId,
    myRematchRequested,
    rivalRematchRequested,
    rematchBusy,
    rematchReady,
    onrematch,
    onconfirmrematch,
    showRematch = true,
  }: {
    series: HavocMultiplayerSeriesSnapshot;
    mvp: HavocMultiplayerSeriesMvp | null;
    picks: readonly HavocMultiplayerDraftPick[];
    outputs: Readonly<Record<number, HavocMultiplayerGameOutput>>;
    localParticipantId: HavocMultiplayerParticipantId;
    myRematchRequested: boolean;
    rivalRematchRequested: boolean;
    rematchBusy: boolean;
    rematchReady: boolean;
    onrematch: () => void;
    onconfirmrematch: () => void;
    showRematch?: boolean;
  } = $props();

  const championIsLocal = $derived(series.champion === localParticipantId);
  const localWins = $derived(localParticipantId === 'p1' ? series.wins.p1 : series.wins.p2);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.wins.p2 : series.wins.p1);
  const mvpPick = $derived(havocMultiplayerMvpPick(picks, mvp));
  const mvpIsLocal = $derived(mvp?.participantId === localParticipantId);
  const rows = $derived(havocMultiplayerSeriesRows(series, outputs, localParticipantId));
  const stats = $derived(havocMultiplayerSeriesStats(series, outputs, localParticipantId));
  let statsSide = $state<'home' | 'away'>('home');
  let statsTotals = $state(false);
  const selectedBoxes = $derived(stats.boxes.filter((box) => box.side === statsSide));
  const mvpStats = $derived(
    stats.boxes
      .find((box) => box.side === (mvpIsLocal ? 'home' : 'away'))
      ?.lines.find(
        (line) => line.sourcePlayerId === mvpPick?.card.source.playerId && line.kind === 'starter',
      ),
  );
  const comparison = $derived.by(() => {
    const teams = stats.boxes.map((box) => {
      const sum = (
        stat:
          | 'points'
          | 'rebounds'
          | 'assists'
          | 'turnovers'
          | 'fieldGoalsMade'
          | 'fieldGoalsAttempted'
          | 'freeThrowsMade'
          | 'freeThrowsAttempted',
      ) => box.lines.reduce((total, line) => total + line[stat], 0);
      return [
        perGameText(box.score, stats.games),
        ratioPct(sum('fieldGoalsMade'), sum('fieldGoalsAttempted')),
        ratioPct(sum('freeThrowsMade'), sum('freeThrowsAttempted')),
        trueShootingPct(sum('points'), sum('fieldGoalsAttempted'), sum('freeThrowsAttempted')),
        perGameText(sum('rebounds'), stats.games),
        perGameText(sum('assists'), stats.games),
        perGameText(sum('turnovers'), stats.games),
      ];
    });
    return [
      'Points per game',
      'FG%',
      'FT%',
      'TS%',
      'Player rebounds per game',
      'Assists per game',
      'Turnovers per game',
    ].map((label, index) => ({
      label,
      local: teams[0]?.[index] ?? '—',
      opponent: teams[1]?.[index] ?? '—',
    }));
  });

  function statusLabel(row: (typeof rows)[number]): string {
    if (row.status === 'mismatch') return 'Mismatch';
    if (row.winner === null) return 'Pending';
    return row.localWon ? 'Win' : 'Loss';
  }
</script>

<section class="hm-championship" aria-label="Series championship">
  <header class="hm-champ-head" data-champion={championIsLocal ? 'local' : 'opponent'}>
    <Trophy size={30} aria-hidden="true" />
    <p class="h-eyebrow">Series complete</p>
    <h2 class="hm-champ-title">
      {championIsLocal ? 'You are the champion' : 'Opponent takes the series'}
    </h2>
    <p class="hm-champ-score">
      <span data-leading={localWins > opponentWins}>{localWins}</span>
      <span class="hm-dash" aria-hidden="true">–</span>
      <span data-leading={opponentWins > localWins}>{opponentWins}</span>
    </p>
    <p class="hm-champ-sub">Best of seven · first to four wins</p>
  </header>

  <div class="hm-top-grid">
    {#if mvp}
      <section class="hm-mvp h-panel" aria-label="Series MVP">
        <p class="h-eyebrow">{mvpIsLocal ? 'Your series MVP' : 'Opponent series MVP'}</p>
        <div class="hm-mvp-body">
          {#if mvpPick}
            <HavocPlayerArt
              playerId={mvpPick.card.source.playerId}
              playerVersionId={mvpPick.card.source.playerVersionId}
              displayName={mvpPick.card.source.displayName}
              franchiseId={mvpPick.card.source.franchiseId}
              seasonKey={mvpPick.card.source.seasonKey}
            />
            <div class="hm-mvp-copy">
              <h3>{mvpPick.card.source.displayName}</h3>
              <p class="hm-mvp-nickname">{mvpPick.card.nickname}</p>
              <p class="hm-mvp-meta">
                {mvpPick.slot} · {mvpPick.card.source.seasonKey ?? 'Season'} · index {mvp.index}
              </p>
              <HavocMutationList mutations={mvpPick.card.mutations} compact />
            </div>
            <HavocTierBadge tier={mvpPick.card.tier} />
          {:else}
            <div class="hm-mvp-copy">
              <h3>{mvp.slot} · index {mvp.index}</h3>
              <p class="hm-mvp-meta">The drafted lineup is no longer available in this room.</p>
            </div>
          {/if}
        </div>
        {#if mvpStats && stats.games > 0}
          <dl class="hm-mvp-stats">
            <div>
              <dt>PPG</dt>
              <dd>{perGameText(mvpStats.points, stats.games)}</dd>
            </div>
            <div>
              <dt>RPG</dt>
              <dd>{perGameText(mvpStats.rebounds, stats.games)}</dd>
            </div>
            <div>
              <dt>APG</dt>
              <dd>{perGameText(mvpStats.assists, stats.games)}</dd>
            </div>
          </dl>
          <p class="hm-champ-sub">
            Totals: {mvpStats.points} pts · {mvpStats.rebounds} reb · {mvpStats.assists} ast
          </p>
        {/if}
      </section>
    {:else}
      <p class="hm-no-mvp">No series MVP was recorded for this room.</p>
    {/if}
    <section class="h-panel hm-games" aria-label="Series comparison">
      <h3 class="h-subtitle">Series comparison</h3>
      {#if stats.games > 0}
        <div class="hm-games-scroll">
          <table class="hm-comparison-table">
            <caption class="sr-only"
              >Per-game team comparison across available verified games</caption
            >
            <thead
              ><tr><th scope="col">You</th><th scope="col">Stat</th><th scope="col">Opp</th></tr
              ></thead
            >
            <tbody
              >{#each comparison as entry (entry.label)}<tr
                  ><td>{entry.local}</td><th scope="row">{entry.label}</th><td>{entry.opponent}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
        <p class="hm-champ-sub">{stats.games} games · per-game averages</p>
      {:else}<p class="hm-no-mvp">Box scores are not available on this device.</p>{/if}
    </section>
  </div>

  <section class="h-panel hm-games" aria-label="Series games">
    <h3 class="h-subtitle">Every game</h3>
    <div class="hm-games-scroll">
      <table>
        <caption class="sr-only">Series game results</caption>
        <thead>
          <tr>
            <th scope="col">Game</th>
            <th scope="col">Matchup</th>
            <th scope="col">Score</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.gameNumber)}
            <tr data-status={row.status} data-local-won={row.localWon}>
              <th scope="row">G{row.gameNumber}</th>
              <td>{row.localIsHome ? 'You host' : 'Opponent hosts'}</td>
              <td class="hm-games-score">
                {#if row.homeScore !== null && row.awayScore !== null}
                  {row.localIsHome ? row.homeScore : row.awayScore}
                  <span aria-hidden="true">–</span>
                  {row.localIsHome ? row.awayScore : row.homeScore}
                {:else}
                  —
                {/if}
              </td>
              <td class="hm-games-result" data-result={statusLabel(row)}>{statusLabel(row)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="h-panel hm-games hm-player-stats" aria-label="Series player stats">
    <div class="hm-stats-head">
      <h3 class="h-subtitle">Series player stats</h3>
      {#if stats.games > 0}
        <div class="hm-stats-controls">
          <div class="hm-segmented" role="group" aria-label="Roster">
            <button
              type="button"
              aria-pressed={statsSide === 'home'}
              onclick={() => (statsSide = 'home')}>You</button
            >
            <button
              type="button"
              aria-pressed={statsSide === 'away'}
              onclick={() => (statsSide = 'away')}>Opponent</button
            >
          </div>
          <div class="hm-segmented" role="group" aria-label="Stat values">
            <button type="button" aria-pressed={!statsTotals} onclick={() => (statsTotals = false)}
              >Per game</button
            >
            <button type="button" aria-pressed={statsTotals} onclick={() => (statsTotals = true)}
              >Totals</button
            >
          </div>
        </div>
      {/if}
    </div>
    <p class="hm-champ-sub">
      {statsTotals ? 'Totals' : 'Averages per series game'} from {stats.games} of {series.games.filter(
        (game) => game.status === 'verified',
      ).length} verified games available on this device
    </p>
    {#if stats.games > 0}
      <HavocMultiplayerBoxScore
        boxes={selectedBoxes}
        localSide="home"
        perGame={!statsTotals}
        games={stats.games}
      />
    {:else}
      <p class="hm-no-mvp">Box scores are not available on this device.</p>
    {/if}
  </section>

  <section class="h-panel hm-games" aria-label="Series ability triggers">
    <h3 class="h-subtitle">Abilities triggered</h3>
    {#if stats.abilities.length > 0}
      <div class="hm-games-scroll">
        <table>
          <caption class="sr-only">Recorded ability effects across available verified games</caption
          >
          <thead
            ><tr
              ><th scope="col">Team</th><th scope="col">Player</th><th scope="col">Ability</th><th
                scope="col">Triggers</th
              ><th scope="col">Points Δ</th><th scope="col">FT granted</th><th scope="col"
                >TO canceled</th
              ><th scope="col">Extra poss. earned</th><th scope="col">Extra poss. used</th><th
                scope="col">Points in swap</th
              ><th scope="col">Active seconds</th><th scope="col">Rating changes</th></tr
            ></thead
          >
          <tbody>
            {#each stats.abilities as ability (ability.key)}
              <tr
                ><td>{ability.side === 'home' ? 'You' : 'Opponent'}</td><th scope="row"
                  >{ability.displayName}</th
                ><td>{mutationNameOf(ability.mutationId)}</td><td>{ability.triggers}</td><td
                  >{formatSignedPoints(ability.pointsDelta)}</td
                ><td>{ability.freeThrowsGranted}</td><td>{ability.turnoversCancelled}</td><td
                  >{ability.extraPossessionsEarned}</td
                ><td>{ability.extraPossessionsUsed}</td><td
                  >{formatSignedPoints(ability.swapPoints)}</td
                ><td>{ability.activeSeconds}</td><td>{ability.ratingChanges}</td></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="hm-no-mvp">
        {stats.games > 0
          ? 'No ability triggers recorded in the available games.'
          : 'Ability stats are not available on this device.'}
      </p>
    {/if}
  </section>

  <section class="hm-games" aria-label="Game box scores">
    <h3 class="h-subtitle">Game box scores</h3>
    {#each rows as row (row.gameNumber)}
      {@const output = outputs[row.gameNumber]}
      {#if output && row.status === 'verified'}
        <details class="h-panel hm-game-detail">
          <summary
            >Game {row.gameNumber} · {statusLabel(row)} · {row.localIsHome
              ? row.homeScore
              : row.awayScore}–{row.localIsHome ? row.awayScore : row.homeScore}</summary
          >
          <HavocMultiplayerBoxScore
            boxes={havocMultiplayerFinalBoxes(output.result)}
            localSide={row.localIsHome ? 'home' : 'away'}
          />
        </details>
      {/if}
    {/each}
  </section>

  {#if showRematch}<footer class="hm-rematch">
      {#if rematchReady}
        <p class="hm-rematch-note" role="status">
          <RefreshCcw size={14} aria-hidden="true" /> Rematch room ready — moving you over…
        </p>
      {:else if rivalRematchRequested && !myRematchRequested}
        <p class="hm-rematch-note" role="status">Your opponent wants a rematch.</p>
        <button
          type="button"
          class="h-button"
          data-havoc-multiplayer-confirm-rematch
          disabled={rematchBusy}
          onclick={onconfirmrematch}
        >
          <Handshake size={16} aria-hidden="true" /> Accept rematch
        </button>
      {:else if myRematchRequested}
        <p class="hm-rematch-note" role="status">Waiting for your opponent to accept…</p>
      {:else}
        <p class="hm-rematch-note">Run it back with the same squads?</p>
        <button
          type="button"
          class="h-button"
          data-havoc-multiplayer-request-rematch
          disabled={rematchBusy}
          onclick={onrematch}
        >
          <RefreshCcw size={16} aria-hidden="true" /> Request rematch
        </button>
      {/if}
    </footer>{/if}
</section>

<style>
  .hm-championship {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .hm-top-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
  }
  .hm-top-grid > section {
    min-width: 0;
  }
  .hm-stats-head,
  .hm-stats-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .hm-segmented {
    display: inline-flex;
    padding: 3px;
    border: 1px solid var(--color-line-strong);
    border-radius: 8px;
    background: var(--color-surface-2);
  }
  .hm-segmented button {
    padding: 6px 10px;
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }
  .hm-segmented button[aria-pressed='true'] {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }
  .hm-segmented button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .hm-mvp-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin: 6px 0;
  }
  .hm-mvp-stats dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .hm-mvp-stats dd {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    color: var(--color-primary);
  }
  .hm-comparison-table {
    min-width: 0;
  }
  .hm-player-stats :global(.hm-boxes) {
    grid-template-columns: minmax(0, 1fr);
  }
  .hm-comparison-table th,
  .hm-comparison-table td {
    white-space: normal;
  }
  @media (min-width: 900px) {
    .hm-top-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .hm-champ-head {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 22px 16px;
    border: 1px solid var(--color-line-strong);
    border-radius: var(--radius);
    text-align: center;
    background:
      radial-gradient(
        90% 130% at 50% 0%,
        color-mix(in srgb, var(--color-primary) 18%, transparent),
        transparent 60%
      ),
      var(--color-surface-1);
  }
  .hm-champ-head[data-champion='opponent'] {
    background:
      radial-gradient(90% 130% at 50% 0%, rgb(139 201 224 / 12%), transparent 60%),
      var(--color-surface-1);
  }
  .hm-champ-head :global(svg) {
    color: #ffd782;
  }
  .hm-champ-title {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 6vw, 2.6rem);
    font-weight: 900;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }
  .hm-champ-score {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: clamp(2rem, 9vw, 3rem);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hm-champ-score [data-leading='true'] {
    color: #ffd782;
  }
  .hm-dash {
    color: #aab9db;
    font-size: 0.55em;
  }
  .hm-champ-sub {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #c1cae4;
  }
  .hm-mvp {
    display: grid;
    gap: 10px;
  }
  .hm-mvp-body {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .hm-mvp-copy {
    display: grid;
    min-width: 0;
    gap: 4px;
  }
  .hm-mvp-copy h3 {
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 900;
    line-height: 1.05;
    text-transform: uppercase;
  }
  .hm-mvp-nickname {
    font-size: 12px;
    font-weight: 700;
    color: #f290c5;
  }
  .hm-mvp-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #aab9db;
  }
  .hm-no-mvp {
    font-size: 13px;
    color: #c1cae4;
  }
  .hm-games {
    display: grid;
    gap: 10px;
  }
  .hm-games-scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .hm-game-detail summary {
    cursor: pointer;
    font-weight: 700;
  }
  .hm-game-detail[open] summary {
    margin-bottom: 14px;
  }
  .hm-game-detail summary:focus-visible {
    outline: 2px solid #ffd782;
    outline-offset: 4px;
  }
  table {
    width: 100%;
    min-width: 26rem;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 8px 10px;
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #aab9db;
    border-bottom: 1px solid #3c486b;
  }
  tbody tr {
    border-top: 1px solid rgb(60 72 107 / 55%);
  }
  tbody tr:first-child {
    border-top: 0;
  }
  tbody tr[data-status='scheduled'],
  tbody tr[data-status='ready'] {
    color: #aab9db;
  }
  .hm-games-score {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
  }
  .hm-games-result {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hm-games-result[data-result='Win'] {
    color: #8bceaf;
  }
  .hm-games-result[data-result='Loss'] {
    color: #f290c5;
  }
  .hm-games-result[data-result='Mismatch'] {
    color: #f290c5;
  }
  .hm-rematch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 14px;
    border: 1px solid #465273;
    border-radius: 16px;
    background: #141b39;
  }
  .hm-rematch-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 13px;
    color: #c1cae4;
  }
</style>
