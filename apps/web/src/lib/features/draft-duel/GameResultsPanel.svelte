<script lang="ts">
  import { Clock, ShieldAlert, ShieldCheck } from '@lucide/svelte';
  import type {
    DraftDuelCard,
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    DraftDuelSeriesSnapshot,
    HoopRushManifest,
    PlayerBoxScore,
    TeamResult,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { SLOT_LABELS } from '$lib/player-positions';
  import { draftDuelTeamOf } from './draft-duel-broadcast-view';

  let {
    output,
    series,
    localParticipantId,
    verification,
    readyCountdownMs,
    localReady,
    onready,
    cards = {},
    manifest = null,
  }: {
    output: DraftDuelGameOutput;
    series: DraftDuelSeriesSnapshot;
    localParticipantId: DraftDuelParticipantId;
    verification: 'pending' | 'verified' | 'mismatch';
    readyCountdownMs: number | null;
    localReady: boolean;
    onready: () => void;
    cards?: Record<string, DraftDuelCard>;
    manifest?: HoopRushManifest | null;
  } = $props();

  function cardOf(playerId: string): DraftDuelCard | null {
    return cards[playerId] ?? null;
  }

  function nameOf(playerId: string): string {
    return cardOf(playerId)?.displayName ?? playerId.replace(/^p-/, '#').slice(0, 7);
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
  }

  const localSide = $derived(draftDuelTeamOf(output, localParticipantId));
  const localTeam = $derived(localSide === 'home' ? output.result.home : output.result.away);
  const opponentTeam = $derived(localSide === 'home' ? output.result.away : output.result.home);
  const localWon = $derived(output.result.winner === localSide);
  const localSeriesWins = $derived(localParticipantId === 'p1' ? series.p1Wins : series.p2Wins);
  const opponentSeriesWins = $derived(localParticipantId === 'p1' ? series.p2Wins : series.p1Wins);
  const championIsLocal = $derived(series.champion === localParticipantId);
  const seriesOver = $derived(series.champion !== null);

  const panels = $derived.by((): TeamPanel[] => [
    { key: 'local', label: 'You', side: localSide, team: localTeam, won: localWon },
    {
      key: 'opponent',
      label: 'Opponent',
      side: localSide === 'home' ? 'away' : 'home',
      team: opponentTeam,
      won: !localWon,
    },
  ]);

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
    if (series.champion !== null) {
      return championIsLocal ? 'You won the series.' : 'Opponent won the series.';
    }
    if (series.currentGameNumber !== null) return `Game ${series.currentGameNumber} is next.`;
    return 'Waiting for the series to update.';
  });

  const countdownLabel = $derived(
    readyCountdownMs === null ? null : formatCountdown(readyCountdownMs),
  );
  const nextGameNumber = $derived(series.currentGameNumber ?? Math.min(7, output.gameNumber + 1));
  const canReady = $derived(
    verification === 'verified' && !seriesOver && nextGameNumber > output.gameNumber,
  );
  const readyLabel = $derived(
    localReady ? 'Ready' : seriesOver ? 'Ready' : `Ready for Game ${nextGameNumber}`,
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
      Game {output.gameNumber} · {verification === 'verified'
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
    <p class="series">
      Series: You {localSeriesWins} <span aria-hidden="true">–</span>
      {opponentSeriesWins} Opp · {seriesMessage}
    </p>

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
          <table>
            <caption class="sr-only">{panel.label} box score</caption>
            <thead>
              <tr>
                <th scope="col" class="is-player">Player</th>
                <th scope="col">MIN</th>
                <th scope="col">PTS</th>
                <th scope="col">REB</th>
                <th scope="col">AST</th>
                <th scope="col">TO</th>
                <th scope="col">FG</th>
                <th scope="col">3P</th>
                <th scope="col">FT</th>
              </tr>
            </thead>
            <tbody>
              {#each panel.team.players as player, slotIndex (player.playerId)}
                <tr data-role="player-row">
                  <th scope="row" class="is-player">
                    <span class="player-cell">
                      {#if manifest && cardOf(player.playerId)?.playerExternalId}
                        <PlayerFace
                          player={{
                            playerId: player.playerId,
                            playerExternalId: cardOf(player.playerId)?.playerExternalId ?? '',
                            altIds: null,
                          }}
                          {manifest}
                          size="sm"
                          fallbackInitials={initialsOf(nameOf(player.playerId))}
                        />
                      {:else}
                        <span class="player-fallback">{initialsOf(nameOf(player.playerId))}</span>
                      {/if}
                      <span class="player-text">
                        <span class="player-name">{nameOf(player.playerId)}</span>
                        <span class="player-pos">{SLOT_LABELS[slotIndex] ?? ''}</span>
                      </span>
                    </span>
                  </th>
                  <td>{player.minutes}</td>
                  <td data-stat="pts">{player.points}</td>
                  <td>{player.rebounds.total}</td>
                  <td>{player.assists}</td>
                  <td>{player.turnovers}</td>
                  <td>{statLine(player)}</td>
                  <td>{threeLine(player)}</td>
                  <td>{freeThrowLine(player)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" class="is-player">Team</th>
                <td>
                  {panel.team.players.reduce((total, player) => total + player.minutes, 0)}
                </td>
                <td>{panel.team.box.points}</td>
                <td>{panel.team.box.rebounds.total}</td>
                <td>{panel.team.box.assists}</td>
                <td>{panel.team.box.turnovers}</td>
                <td>
                  {panel.team.box.fieldGoals.made}-{panel.team.box.fieldGoals.attempted}
                </td>
                <td>{panel.team.box.threes.made}-{panel.team.box.threes.attempted}</td>
                <td>
                  {panel.team.box.freeThrows.made}-{panel.team.box.freeThrows.attempted}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    {/each}
  </div>

  <footer class="ready">
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
    <button type="button" disabled={localReady || !canReady} onclick={onready}>{readyLabel}</button>
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

  table {
    width: 100%;
    min-width: 26rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 0.32rem 0.42rem;
    white-space: nowrap;
    text-align: right;
  }

  thead th {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    border-bottom: 1px solid var(--color-line-soft);
  }

  .is-player {
    width: 100%;
    max-width: 10rem;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
  }

  tbody tr {
    border-top: 1px solid color-mix(in srgb, var(--color-line-soft) 55%, transparent);
  }

  tbody tr:first-child {
    border-top: 0;
  }

  tbody th.is-player {
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

  .player-pos {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }

  tbody td[data-stat='pts'] {
    color: var(--color-foreground);
    font-weight: 800;
  }

  tfoot tr {
    border-top: 1px solid var(--color-line-strong);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
  }

  tfoot th,
  tfoot td {
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
