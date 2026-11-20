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
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import PlayerStatsControls from '#lib/components/basketball/PlayerStatsControls.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { perGameText, ratioPct, trueShootingPct } from '#lib/format.js';
  import GamecastBattleBox from '#lib/gamecast/GamecastBattleBox.svelte';
  import { gamecastBattleFinalBoxes } from '#lib/gamecast/gamecast-battle-view.js';
  import { havocMultiplayerSeriesStats } from './havoc-multiplayer-series-stats';
  import { mutationNameOf, formatSignedPoints } from '#lib/features/havoc/havoc-presentation.js';
  import {
    havocMultiplayerMvpPick,
    havocMultiplayerSeriesRows,
  } from './havoc-multiplayer-room-view';
  import type { ComparisonRow, SeriesRecapGame } from '#lib/components/ui/types.js';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import ComparisonTable from '#lib/components/screens/ComparisonTable.svelte';
  import MvpCard from '#lib/components/screens/MvpCard.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';
  import SeriesRecap from '#lib/components/screens/SeriesRecap.svelte';

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
  const mvpCardStats = $derived(
    mvpStats !== undefined && stats.games > 0
      ? [
          { label: 'PPG', value: perGameText(mvpStats.points, stats.games) },
          { label: 'RPG', value: perGameText(mvpStats.rebounds, stats.games) },
          { label: 'APG', value: perGameText(mvpStats.assists, stats.games) },
        ]
      : [],
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
  const comparisonRows = $derived<ComparisonRow[]>(
    comparison.map((entry) => ({
      label: entry.label,
      left: entry.local,
      right: entry.opponent,
    })),
  );
  const recapGames = $derived<SeriesRecapGame[]>(
    rows.map((row) => ({
      gameNumber: row.gameNumber,
      won: row.localWon === true,
      score:
        row.homeScore !== null && row.awayScore !== null
          ? `${row.localIsHome ? row.homeScore : row.awayScore}–${row.localIsHome ? row.awayScore : row.homeScore}`
          : '—',
      standout: `${row.localIsHome ? 'You host' : 'Opponent hosts'} · ${statusLabel(row)}`,
    })),
  );

  function statusLabel(row: (typeof rows)[number]): string {
    if (row.status === 'mismatch') return 'Mismatch';
    if (row.winner === null) return 'Pending';
    return row.localWon ? 'Win' : 'Loss';
  }
</script>

<ResultScreen
  eyebrow="Series complete"
  title={championIsLocal ? 'You are the champion' : 'Opponent takes the series'}
  aria-label="Series championship"
  data-champion={championIsLocal ? 'local' : 'opponent'}
>
  {#snippet badges()}
    <Trophy size={30} aria-hidden="true" class="text-primary" />
  {/snippet}
  {#snippet hero()}
    <ResultHero
      score={`${localWins}–${opponentWins}`}
      caption="Best of seven · first to four wins"
      scoreLabel="Series score"
    />
  {/snippet}

  <div class="hm-top-grid">
    <div class="hm-mvp">
      {#if mvp}
        <MvpCard
          label={mvpIsLocal ? 'Your series MVP' : 'Opponent series MVP'}
          name={mvpPick?.card.source.displayName ?? `${mvp.slot} · index ${mvp.index}`}
          team={mvpPick?.card.nickname ?? null}
          slot={mvpPick ? `${mvpPick.slot} · index ${mvp.index}` : null}
          stats={mvpCardStats}
        >
          {#snippet portrait()}
            {#if mvpPick}
              <PlayerArt
                playerId={mvpPick.card.source.playerId}
                playerVersionId={mvpPick.card.source.playerVersionId}
                displayName={mvpPick.card.source.displayName}
                franchiseId={mvpPick.card.source.franchiseId}
                seasonKey={mvpPick.card.source.seasonKey}
              />
            {/if}
          {/snippet}
        </MvpCard>
        {#if mvpPick}
          <div class="hm-mvp-powers">
            <HavocMutationList mutations={mvpPick.card.mutations} compact />
            <HavocTierBadge tier={mvpPick.card.tier} />
          </div>
        {:else}
          <p class="hm-no-mvp">The drafted lineup is no longer available in this room.</p>
        {/if}
        {#if mvpStats && stats.games > 0}
          <p class="ui-label" data-tone="muted">
            Totals: {mvpStats.points} pts · {mvpStats.rebounds} reb · {mvpStats.assists} ast
          </p>
        {/if}
      {:else}
        <EmptyState title="No series MVP was recorded for this room" surface="none" />
      {/if}
    </div>

    <Panel as="section" padding="md" class="grid gap-2.5" aria-label="Series comparison">
      <SectionHeading title="Series comparison" level={3} size="md" />
      {#if stats.games > 0}
        <div class="hm-games-scroll">
          <ComparisonTable rows={comparisonRows} leftLabel="You" rightLabel="Opp" />
        </div>
        <p class="ui-label" data-tone="muted">{stats.games} games · per-game averages</p>
      {:else}<p class="hm-no-mvp">Box scores are not available on this device.</p>{/if}
    </Panel>
  </div>

  <Panel as="section" padding="md" class="grid gap-2.5" aria-label="Series games">
    <SectionHeading title="Every game" level={3} size="md" />
    <SeriesRecap games={recapGames} label="Series game results" />
  </Panel>

  <Panel
    as="section"
    padding="md"
    class="hm-player-stats grid gap-2.5"
    aria-label="Series player stats"
  >
    <div class="hm-stats-head">
      <SectionHeading title="Series player stats" level={3} size="md" />
      {#if stats.games > 0}
        <PlayerStatsControls
          sideLabel="Roster"
          sideOptions={[
            { value: 'home', label: 'You' },
            { value: 'away', label: 'Opponent' },
          ]}
          side={statsSide}
          onsidechange={(next) => (statsSide = next)}
          values={statsTotals ? 'totals' : 'game'}
          onvalueschange={(next) => (statsTotals = next === 'totals')}
        />
      {/if}
    </div>
    <p class="ui-label" data-tone="muted">
      {statsTotals ? 'Totals' : 'Averages per series game'} from {stats.games} of {series.games.filter(
        (game) => game.status === 'verified',
      ).length} verified games available on this device
    </p>
    {#if stats.games > 0}
      <GamecastBattleBox
        boxes={selectedBoxes}
        localSide="home"
        perGame={!statsTotals}
        games={stats.games}
      />
    {:else}
      <p class="hm-no-mvp">Box scores are not available on this device.</p>
    {/if}
  </Panel>

  <Disclosure summary="Abilities triggered" aria-label="Series ability triggers">
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
  </Disclosure>

  <section class="grid gap-2.5" aria-label="Game box scores">
    <SectionHeading title="Game box scores" level={3} size="md" />
    {#each rows as row (row.gameNumber)}
      {@const output = outputs[row.gameNumber]}
      {#if output && row.status === 'verified'}
        <Disclosure
          summary={`Game ${row.gameNumber} · ${statusLabel(row)} · ${
            row.localIsHome ? row.homeScore : row.awayScore
          }–${row.localIsHome ? row.awayScore : row.homeScore}`}
        >
          <GamecastBattleBox
            boxes={gamecastBattleFinalBoxes(output.result)}
            localSide={row.localIsHome ? 'home' : 'away'}
          />
        </Disclosure>
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
        <Button
          type="button"
          data-havoc-multiplayer-confirm-rematch
          disabled={rematchBusy}
          onclick={onconfirmrematch}
        >
          <Handshake size={16} aria-hidden="true" /> Accept rematch
        </Button>
      {:else if myRematchRequested}
        <p class="hm-rematch-note" role="status">Waiting for your opponent to accept…</p>
      {:else}
        <p class="hm-rematch-note">Run it back with the same squads?</p>
        <Button
          type="button"
          data-havoc-multiplayer-request-rematch
          disabled={rematchBusy}
          onclick={onrematch}
        >
          <RefreshCcw size={16} aria-hidden="true" /> Request rematch
        </Button>
      {/if}
    </footer>{/if}
</ResultScreen>

<style>
  .hm-top-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
  }
  .hm-top-grid > :global(section),
  .hm-top-grid > .hm-mvp {
    min-width: 0;
  }
  .hm-mvp {
    display: grid;
    align-content: start;
    gap: 10px;
  }
  .hm-mvp-powers {
    display: grid;
    justify-items: start;
    gap: 10px;
  }
  .hm-stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  @media (min-width: 900px) {
    .hm-top-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .hm-no-mvp {
    font-size: 13px;
    color: #c1cae4;
  }
  .hm-games-scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  :global(.hm-player-stats .hm-boxes) {
    grid-template-columns: minmax(0, 1fr);
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
