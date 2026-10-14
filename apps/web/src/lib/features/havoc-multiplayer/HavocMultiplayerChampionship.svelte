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
  import HavocMutationList from '$lib/features/havoc/HavocMutationList.svelte';
  import HavocPlayerArt from '$lib/features/havoc/HavocPlayerArt.svelte';
  import HavocTierBadge from '$lib/features/havoc/HavocTierBadge.svelte';
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
  } = $props();

  const championIsLocal = $derived(series.champion === localParticipantId);
  const localWins = $derived(localParticipantId === 'p1' ? series.wins.p1 : series.wins.p2);
  const opponentWins = $derived(localParticipantId === 'p1' ? series.wins.p2 : series.wins.p1);
  const mvpPick = $derived(havocMultiplayerMvpPick(picks, mvp));
  const mvpIsLocal = $derived(mvp?.participantId === localParticipantId);
  const rows = $derived(havocMultiplayerSeriesRows(series, outputs, localParticipantId));

  function statusLabel(row: (typeof rows)[number]): string {
    if (row.status === 'mismatch') return 'Mismatch';
    if (row.winner === null) return 'Pending';
    return row.localWon ? 'Win' : 'Loss';
  }
</script>

<section class="hm-championship" aria-label="Series championship">
  <header class="hm-champ-head">
    <Trophy size={30} aria-hidden="true" />
    <p class="h-eyebrow">Series complete</p>
    <h2 class="hm-champ-title">
      {championIsLocal ? 'You win the series' : 'Opponent wins the series'}
    </h2>
    <p class="hm-champ-score">
      <span data-leading={localWins > opponentWins}>{localWins}</span>
      <span class="hm-dash" aria-hidden="true">–</span>
      <span data-leading={opponentWins > localWins}>{opponentWins}</span>
    </p>
    <p class="hm-champ-sub">Best of seven · first to four wins</p>
  </header>

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
    </section>
  {:else}
    <p class="hm-no-mvp">No series MVP was recorded for this room.</p>
  {/if}

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

  <footer class="hm-rematch">
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
  </footer>
</section>

<style>
  .hm-championship {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .hm-champ-head {
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 22px 16px;
    border: 1px solid #465273;
    border-radius: 18px;
    text-align: center;
    background:
      radial-gradient(90% 130% at 50% 0%, rgb(255 215 130 / 18%), transparent 60%), #20294c;
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
