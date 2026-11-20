<script lang="ts">
  import { Clock, ShieldAlert, ShieldCheck } from '@lucide/svelte';
  import type {
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import type { HavocMultiplayerGameOutput } from '@hoop-rush/persistence';
  import { gamecastBattleFinalBoxes } from '#lib/gamecast/gamecast-battle-view.js';
  import {
    havocMultiplayerCurrentGameNumber,
    havocMultiplayerLocalSide,
    havocMultiplayerSecondsLeft,
    type HavocMultiplayerVerificationTone,
  } from './havoc-multiplayer-room-view';
  import GamecastBattleBox from '#lib/gamecast/GamecastBattleBox.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import ResultHero from '#lib/components/screens/ResultHero.svelte';
  import ResultScreen from '#lib/components/screens/ResultScreen.svelte';

  let {
    output,
    series,
    localParticipantId,
    verification,
    readyCountdownMs,
    localReady,
    opponentReady = false,
    awaitingContinue,
    onready,
    oncontinue,
  }: {
    output: HavocMultiplayerGameOutput;
    series: HavocMultiplayerSeriesSnapshot;
    localParticipantId: HavocMultiplayerParticipantId;
    verification: HavocMultiplayerVerificationTone;
    readyCountdownMs: number | null;
    localReady: boolean;
    opponentReady?: boolean;
    awaitingContinue: boolean;
    onready: () => void;
    oncontinue: () => void;
  } = $props();

  const localSide = $derived(
    havocMultiplayerLocalSide(series, output.gameNumber, localParticipantId),
  );
  const boxes = $derived(gamecastBattleFinalBoxes(output.result));
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const localWon = $derived(output.winner === localParticipantId);
  const countdown = $derived(havocMultiplayerSecondsLeft(readyCountdownMs));
  const seriesOver = $derived(series.champion !== null);
  const currentGameNumber = $derived(havocMultiplayerCurrentGameNumber(series));
  const nextGameNumber = $derived(
    currentGameNumber !== null && currentGameNumber > output.gameNumber ? currentGameNumber : null,
  );

  const seriesMessage = $derived.by(() => {
    if (seriesOver) {
      return series.champion === localParticipantId
        ? 'You won the series.'
        : 'Opponent won the series.';
    }
    if (verification === 'mismatch') return 'This result cannot be accepted.';
    if (nextGameNumber !== null) return `Game ${nextGameNumber} is next.`;
    if (awaitingContinue) return `Game ${output.gameNumber} is under review.`;
    if (currentGameNumber !== null) {
      return `Waiting for opponent to accept Game ${output.gameNumber}.`;
    }
    return 'Waiting for the series to update.';
  });

  const verificationView = $derived.by(() => {
    if (verification === 'verified') {
      return {
        tone: 'verified' as const,
        label: 'Verified by both simulations',
        detail: 'Both players produced matching result digests for this game.',
      };
    }
    if (verification === 'mismatch') {
      return {
        tone: 'mismatch' as const,
        label: 'Verification mismatch',
        detail: 'The two simulations disagree, so this result cannot be confirmed.',
      };
    }
    return {
      tone: 'pending' as const,
      label: 'Waiting for opponent verification',
      detail: 'This result is provisional until both players confirm matching digests.',
    };
  });
</script>

<ResultScreen
  eyebrow={`Game ${output.gameNumber} · ${verification === 'verified' ? 'verified result' : 'provisional'}`}
  title={verification === 'mismatch'
    ? 'Simulations disagree'
    : localWon
      ? `You win Game ${output.gameNumber}`
      : `Opponent wins Game ${output.gameNumber}`}
  data-verification={verification}
>
  {#snippet badges()}
    <span class="hm-badge" data-tone={verificationView.tone}>
      {#if verificationView.tone === 'verified'}
        <ShieldCheck size={14} aria-hidden="true" />
      {:else if verificationView.tone === 'mismatch'}
        <ShieldAlert size={14} aria-hidden="true" />
      {:else}
        <Clock size={14} aria-hidden="true" />
      {/if}
      <span>{verificationView.label}</span>
    </span>
  {/snippet}
  {#snippet hero()}
    <ResultHero
      score={`${localBox?.score ?? 0}–${opponentBox?.score ?? 0}`}
      caption={`Series: You ${
        localParticipantId === 'p1' ? series.wins.p1 : series.wins.p2
      }–${localParticipantId === 'p1' ? series.wins.p2 : series.wins.p1} Opp`}
      meta={seriesMessage}
      secondary={verificationView.detail}
      scoreLabel="Final score"
    />
  {/snippet}

  {#snippet footer()}
    <footer class="hm-results-footer">
      {#if awaitingContinue}
        <p class="hm-ready-line">Review the box score, then continue when ready.</p>
        <Button type="button" data-havoc-multiplayer-continue onclick={oncontinue}>Continue</Button>
      {:else if seriesOver}
        <p class="hm-ready-line">Series complete.</p>
      {:else if nextGameNumber !== null}
        <div class="hm-ready-copy">
          <p class="hm-ready-line">
            {#if localReady && opponentReady}
              Both players are ready. Starting Game {nextGameNumber}…
            {:else if localReady}
              You're ready. Waiting for your opponent.
            {:else if opponentReady}
              Your opponent is ready. Ready up to start Game {nextGameNumber}.
            {:else}
              Ready for Game {nextGameNumber}?
            {/if}
          </p>
          {#if countdown !== null}
            <p class="hm-countdown">
              <Clock size={13} aria-hidden="true" />
              Auto-start in <strong>{countdown}s</strong>
            </p>
          {/if}
        </div>
        <Button type="button" data-havoc-multiplayer-ready disabled={localReady} onclick={onready}>
          {localReady ? 'Ready' : `Ready for Game ${nextGameNumber}`}
        </Button>
      {:else}
        <p class="hm-ready-line">The next game opens once this result is accepted.</p>
      {/if}
    </footer>
  {/snippet}

  <div class="hm-results-boxes">
    <GamecastBattleBox {boxes} {localSide} />
  </div>
</ResultScreen>

<style>
  .hm-results-boxes {
    padding: 0 4px;
  }
  .hm-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    border: 1px solid #465273;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .hm-badge[data-tone='pending'] {
    border-color: rgb(255 215 130 / 55%);
    background: rgb(255 215 130 / 10%);
    color: #ffd782;
  }
  .hm-badge[data-tone='verified'] {
    border-color: rgb(139 206 175 / 55%);
    background: rgb(139 206 175 / 10%);
    color: #8bceaf;
  }
  .hm-badge[data-tone='mismatch'] {
    border-color: rgb(242 144 197 / 55%);
    background: rgb(242 144 197 / 10%);
    color: #f290c5;
  }
  .hm-results-footer {
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
  .hm-ready-copy {
    min-width: 0;
  }
  .hm-ready-line {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .hm-countdown {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: #c1cae4;
  }
  .hm-countdown strong {
    color: #f2f4ff;
  }
  .hm-results-footer :global(.ui-btn) {
    min-width: 12rem;
  }
</style>
