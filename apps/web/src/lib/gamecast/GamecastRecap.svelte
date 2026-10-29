<script lang="ts">
  import { Clock, ShieldAlert, ShieldCheck } from '@lucide/svelte';
  import type { HoopRushManifest, PlayerBoxScore, TeamResult } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import { SLOT_LABELS } from '#lib/player-positions.js';
  import { trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import { gamecastTeamOf } from './gamecast-broadcast-view';
  import type {
    GamecastParticipantId,
    GamecastPlayer,
    GamecastRecordedGame,
    GamecastSeries,
    GamecastVerification,
  } from './gamecast-types';

  let {
    output,
    series = null,
    seasonBroadcast = false,
    localParticipantId,
    verification,
    readyCountdownMs,
    localReady,
    onready,
    awaitingContinue,
    oncontinue,
    players = {},
    manifest = null,
  }: {
    output: GamecastRecordedGame;
    series?: GamecastSeries | null;
    seasonBroadcast?: boolean;
    localParticipantId: GamecastParticipantId;
    verification: GamecastVerification;
    readyCountdownMs: number | null;
    localReady: boolean;
    onready: () => void;
    awaitingContinue: boolean;
    oncontinue: () => void;
    players?: Record<string, GamecastPlayer>;
    manifest?: HoopRushManifest | null;
  } = $props();

  function playerOf(playerId: string): GamecastPlayer | null {
    return players[playerId] ?? null;
  }

  function nameOf(playerId: string): string {
    return playerOf(playerId)?.displayName ?? playerId.replace(/^p-/, '#').slice(0, 7);
  }

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  interface TeamPanel {
    key: 'local' | 'opponent';
    label: string;
    side: 'home' | 'away';
    team: TeamResult;
    won: boolean;
    topPoints: number;
  }

  const localSide = $derived(gamecastTeamOf(output, localParticipantId));
  const localTeam = $derived(localSide === 'home' ? output.result.home : output.result.away);
  const opponentTeam = $derived(localSide === 'home' ? output.result.away : output.result.home);
  const localWon = $derived(output.result.winner === localSide);
  const localSeriesWins = $derived(
    series === null ? 0 : localParticipantId === 'p1' ? series.p1Wins : series.p2Wins,
  );
  const opponentSeriesWins = $derived(
    series === null ? 0 : localParticipantId === 'p1' ? series.p2Wins : series.p1Wins,
  );
  const championIsLocal = $derived(series?.champion === localParticipantId);
  const seriesOver = $derived(!seasonBroadcast && series?.champion != null);

  const panels = $derived.by((): TeamPanel[] => [
    {
      key: 'local',
      label: 'You',
      side: localSide,
      team: localTeam,
      won: localWon,
      topPoints: Math.max(0, ...localTeam.players.map((player) => player.points)),
    },
    {
      key: 'opponent',
      label: 'Opponent',
      side: localSide === 'home' ? 'away' : 'home',
      team: opponentTeam,
      won: !localWon,
      topPoints: Math.max(0, ...opponentTeam.players.map((player) => player.points)),
    },
  ]);

  type GamecastBoxRow = PlayerBoxScore & { slotIndex: number; teamUsage: number };

  const boxColumns: readonly PlayerStatColumn<GamecastBoxRow>[] = [
    { key: 'minutes', label: 'MIN', value: (row) => row.minutes },
    { key: 'points', label: 'PTS', value: (row) => row.points, cellClass: 'is-strong' },
    { key: 'rebounds', label: 'REB', value: (row) => row.rebounds.total },
    { key: 'assists', label: 'AST', value: (row) => row.assists },
    { key: 'turnovers', label: 'TO', value: (row) => row.turnovers },
    { key: 'fieldGoals', label: 'FG', value: (row) => statLine(row) },
    { key: 'threes', label: '3P', value: (row) => threeLine(row) },
    { key: 'freeThrows', label: 'FT', value: (row) => freeThrowLine(row) },
    {
      key: 'trueShooting',
      label: 'TS%',
      value: (row) =>
        trueShootingPct(row.points, row.fieldGoals.attempted, row.freeThrows.attempted),
    },
    {
      key: 'usage',
      label: 'USG%',
      value: (row) =>
        usagePct(
          usagePossessions(row.fieldGoals.attempted, row.freeThrows.attempted, row.turnovers),
          row.teamUsage,
        ),
    },
  ];

  function rowsOf(panel: TeamPanel): GamecastBoxRow[] {
    const teamUsage = panel.team.players.reduce(
      (total, player) =>
        total +
        usagePossessions(
          player.fieldGoals.attempted,
          player.freeThrows.attempted,
          player.turnovers,
        ),
      0,
    );
    return panel.team.players.map((player, slotIndex) => ({ ...player, slotIndex, teamUsage }));
  }

  function totalsOf(panel: TeamPanel): PlayerStatsTotals<GamecastBoxRow> {
    return {
      value: (column) => {
        switch (column.key) {
          case 'minutes':
            return panel.team.players.reduce((total, player) => total + player.minutes, 0);
          case 'points':
            return panel.team.box.points;
          case 'rebounds':
            return panel.team.box.rebounds.total;
          case 'assists':
            return panel.team.box.assists;
          case 'turnovers':
            return panel.team.box.turnovers;
          case 'fieldGoals':
            return `${String(panel.team.box.fieldGoals.made)}-${String(panel.team.box.fieldGoals.attempted)}`;
          case 'threes':
            return `${String(panel.team.box.threes.made)}-${String(panel.team.box.threes.attempted)}`;
          case 'freeThrows':
            return `${String(panel.team.box.freeThrows.made)}-${String(panel.team.box.freeThrows.attempted)}`;
          case 'trueShooting':
            return trueShootingPct(
              panel.team.box.points,
              panel.team.box.fieldGoals.attempted,
              panel.team.box.freeThrows.attempted,
            );
          case 'usage':
            return '100.0%';
          default:
            return '';
        }
      },
    };
  }

  const verificationView = $derived.by(() => {
    if (verification === 'verified') {
      return {
        tone: 'verified',
        label: 'Verified by both simulations',
        detail: 'Both players produced matching result digests for this game.',
      };
    }
    if (verification === 'mismatch') {
      return {
        tone: 'mismatch',
        label: 'Verification mismatch',
        detail: 'The two simulations disagree, so this result cannot be confirmed.',
      };
    }
    return {
      tone: 'pending',
      label: 'Waiting for opponent verification',
      detail: 'This result is provisional until both players confirm matching digests.',
    };
  });

  const seriesMessage = $derived.by((): string => {
    if (seasonBroadcast) return 'The season resumes automatically.';
    if (!series) return 'Waiting for the series to update.';
    if (series.champion !== null) {
      return championIsLocal ? 'You won the series.' : 'Opponent won the series.';
    }
    if (verification === 'mismatch') return 'This result cannot be accepted.';
    if (series.currentGameNumber !== null && series.currentGameNumber > output.gameNumber) {
      return `Game ${series.currentGameNumber} is next.`;
    }
    if (awaitingContinue) return `Game ${output.gameNumber} is under review.`;
    if (series.currentGameNumber !== null) {
      return `Waiting for opponent to accept Game ${output.gameNumber}.`;
    }
    return 'Waiting for the series to update.';
  });

  const countdownLabel = $derived(
    readyCountdownMs === null ? null : formatCountdown(readyCountdownMs),
  );
  const nextGameNumber = $derived(
    series?.currentGameNumber !== null &&
      series?.currentGameNumber !== undefined &&
      series.currentGameNumber > output.gameNumber
      ? series.currentGameNumber
      : null,
  );
  const canReady = $derived(verification === 'verified' && nextGameNumber !== null);
  const readyLabel = $derived(
    localReady ? 'Ready' : nextGameNumber !== null ? `Ready for Game ${nextGameNumber}` : 'Ready',
  );

  function statLine(player: PlayerBoxScore): string {
    return `${String(player.fieldGoals.made)}-${String(player.fieldGoals.attempted)}`;
  }

  function threeLine(player: PlayerBoxScore): string {
    return `${String(player.threes.made)}-${String(player.threes.attempted)}`;
  }

  function freeThrowLine(player: PlayerBoxScore): string {
    return `${String(player.freeThrows.made)}-${String(player.freeThrows.attempted)}`;
  }
</script>

<section class="results" data-verification={verification}>
  <header class="head">
    <p class="eyebrow">
      {seasonBroadcast
        ? `Head-to-head · Game ${String(output.gameNumber)}`
        : `Game ${String(output.gameNumber)}`} · {verification === 'verified'
        ? 'verified result'
        : 'provisional result'}
    </p>
    <h3>
      {#if verification === 'mismatch'}
        Simulations disagree
      {:else if localWon}
        You win Game {output.gameNumber}
      {:else}
        Opponent wins Game {output.gameNumber}
      {/if}
    </h3>
    <p class="score">
      <span data-score="local">{localTeam.box.points}</span>
      <span class="score-dash" aria-hidden="true">–</span>
      <span data-score="opponent">{opponentTeam.box.points}</span>
    </p>
    {#if !seasonBroadcast}
      <p class="series">
        Series: You {localSeriesWins} <span aria-hidden="true">–</span>
        {opponentSeriesWins} Opp · {seriesMessage}
      </p>
    {/if}

    <div class="badge" data-tone={verificationView.tone} data-verification={verificationView.tone}>
      {#if verificationView.tone === 'verified'}
        <ShieldCheck size={14} aria-hidden="true" />
      {:else if verificationView.tone === 'mismatch'}
        <ShieldAlert size={14} aria-hidden="true" />
      {:else}
        <Clock size={14} aria-hidden="true" />
      {/if}
      <span>{verificationView.label}</span>
    </div>
    <p class="badge-detail">{verificationView.detail}</p>
  </header>

  <div class="box-grid">
    {#each panels as panel (panel.key)}
      <section class="box" data-side={panel.side} aria-label={`${panel.label} box score`}>
        <header class="box-head">
          <span class="box-team" data-side={panel.side}>{panel.label}</span>
          <span class="box-result" data-won={panel.won}>{panel.won ? 'W' : 'L'}</span>
          <strong class="box-score">{panel.team.box.points}</strong>
        </header>
        <div class="box-scroll">
          <PlayerStatsTable
            columns={boxColumns}
            rows={rowsOf(panel)}
            rowKey={(row) => row.playerId}
            totals={totalsOf(panel)}
            caption={`${panel.label} box score`}
            playerCellClass="is-player"
            playerHeadCellClass="is-player"
            playerTotalCellClass="is-player"
            rowAttributes={() => ({ 'data-role': 'player-row' })}
          >
            {#snippet identity(row)}
              <span class="player-cell">
                {#if manifest && playerOf(row.playerId)?.playerExternalId}
                  <PlayerFace
                    player={{
                      playerId: row.playerId,
                      playerExternalId: playerOf(row.playerId)?.playerExternalId ?? '',
                      altIds: playerOf(row.playerId)?.altIds,
                    }}
                    {manifest}
                    size="sm"
                    fallbackInitials={initialsOf(nameOf(row.playerId))}
                  />
                {:else}
                  <span class="player-fallback">{initialsOf(nameOf(row.playerId))}</span>
                {/if}
                <span class="player-text">
                  <span class="player-name">{nameOf(row.playerId)}</span>
                  <span class="player-meta">
                    <span class="player-pos">{SLOT_LABELS[row.slotIndex] ?? ''}</span>
                    {#if panel.topPoints > 0 && row.points === panel.topPoints}<span
                        class="player-hot">Top scorer</span
                      >{/if}
                  </span>
                </span>
              </span>
            {/snippet}
          </PlayerStatsTable>
        </div>
      </section>
    {/each}
  </div>

  <footer class="ready">
    {#if seasonBroadcast}
      <p class="ready-line">Season resumes automatically.</p>
    {:else if awaitingContinue}
      <div class="ready-copy">
        <p class="ready-line">Review the box score, then continue when ready.</p>
      </div>
      <button type="button" onclick={oncontinue}>Continue</button>
    {:else if seriesOver}
      <p class="ready-line">Series complete.</p>
    {:else if nextGameNumber !== null}
      <div class="ready-copy">
        <p class="ready-line">
          {localReady ? "You're ready for the next game." : 'Ready to continue?'}
        </p>
        {#if countdownLabel !== null}
          <p class="countdown">
            <Clock size={13} aria-hidden="true" />
            Auto-ready in <strong>{countdownLabel}</strong>
          </p>
        {/if}
      </div>
      <button type="button" disabled={localReady || !canReady} onclick={onready}>
        {readyLabel}
      </button>
    {:else}
      <p class="ready-line">The next game opens once this result is accepted.</p>
    {/if}
  </footer>
</section>

<style>
  .results {
    display: grid;
    overflow: clip;
    border: 1px solid var(--color-line-soft);
    border-radius: var(--radius);
    background: var(--color-surface-1);
  }

  .head {
    display: grid;
    justify-items: center;
    gap: 0.3rem;
    padding: 1.1rem 1rem 0.9rem;
    text-align: center;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--color-primary) 7%, transparent),
        transparent
      ),
      var(--color-surface-2);
  }

  .eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
  }

  .head h3 {
    margin: 0.1rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 7vw, 2.2rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }

  .score {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    margin: 0.2rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 11vw, 3.2rem);
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .score-dash {
    color: var(--color-muted-foreground);
    font-size: 0.55em;
  }

  .series {
    margin: 0.15rem 0 0;
    font-size: 0.82rem;
    color: var(--color-muted-foreground);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--color-line-strong);
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .badge[data-tone='pending'] {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }

  .badge[data-tone='verified'] {
    border-color: color-mix(in srgb, var(--color-positive) 55%, transparent);
    background: color-mix(in srgb, var(--color-positive) 10%, transparent);
    color: var(--color-positive);
  }

  .badge[data-tone='mismatch'] {
    border-color: color-mix(in srgb, var(--color-destructive) 55%, transparent);
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    color: var(--color-destructive);
  }

  .badge-detail {
    max-width: 30rem;
    margin: 0.1rem 0 0;
    font-size: 0.72rem;
    color: var(--color-muted-foreground);
  }

  .box-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 0.85rem;
  }

  .box {
    min-width: 0;
    overflow: clip;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.6rem;
    background: var(--color-surface-2);
  }

  .box-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    border-bottom: 1px solid var(--color-line-soft);
  }

  .box-team {
    font-family: var(--font-display);
    font-size: 0.86rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .box-team[data-side='home'] {
    color: var(--color-primary);
  }

  .box-team[data-side='away'] {
    color: #8bc9e0;
  }

  .box-result {
    padding: 0.08rem 0.4rem;
    border: 1px solid var(--color-line-strong);
    border-radius: 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
  }

  .box-result[data-won='true'] {
    border-color: color-mix(in srgb, var(--color-positive) 60%, transparent);
    color: var(--color-positive);
  }

  .box-result[data-won='false'] {
    color: var(--color-muted-foreground);
  }

  .box-score {
    margin-left: auto;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .box-scroll {
    overflow-x: auto;
  }

  :global(.results table) {
    width: 100%;
    min-width: 26rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  :global(.results th, .results td) {
    padding: 0.32rem 0.42rem;
    white-space: nowrap;
    text-align: right;
  }

  :global(.results thead th) {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--color-line-soft);
  }

  :global(.results .is-player) {
    width: 100%;
    max-width: 10rem;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  :global(.results tbody tr) {
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  :global(.results tbody tr:first-child) {
    border-top: 0;
  }

  :global(.results tbody th.is-player) {
    font-weight: 600;
  }

  .player-cell {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .player-fallback {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    border-radius: 9px;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 800;
  }

  .player-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
  }

  .player-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .player-pos {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  .player-hot {
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 16%, transparent);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  :global(.results tbody td.is-strong) {
    color: var(--color-foreground);
    font-weight: 800;
  }

  :global(.results tfoot tr) {
    border-top: 1px solid var(--color-line-strong);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }

  :global(.results tfoot th, .results tfoot td) {
    font-weight: 700;
  }

  .ready {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1rem;
    padding: 0.75rem 0.85rem;
    border-top: 1px solid var(--color-line-soft);
    background: var(--color-surface-2);
  }

  .ready-copy {
    min-width: 0;
  }

  .ready-line {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .countdown {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0.15rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--color-muted-foreground);
  }

  .countdown strong {
    color: var(--color-foreground);
  }

  .ready button {
    min-height: 2.6rem;
    padding: 0.55rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 65%, transparent);
    border-radius: 0.55rem;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-family: var(--font-display);
    font-size: 0.92rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    outline: none;
  }

  .ready button:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .ready button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .ready button:disabled {
    border-color: var(--color-line-strong);
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    cursor: default;
  }

  @media (max-width: 860px) {
    .box-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
