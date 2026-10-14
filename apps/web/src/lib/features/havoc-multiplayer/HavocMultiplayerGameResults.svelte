<script lang="ts">
  import { Clock, ShieldAlert, ShieldCheck } from '@lucide/svelte';
  import type {
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import type { HavocMultiplayerGameOutput } from '@hoop-rush/persistence';
  import { havocMultiplayerFinalBoxes } from './havoc-multiplayer-playback-view';
  import {
    havocMultiplayerCurrentGameNumber,
    havocMultiplayerLocalSide,
    havocMultiplayerSecondsLeft,
    type HavocMultiplayerVerificationTone,
  } from './havoc-multiplayer-room-view';
  import HavocMultiplayerBoxScore from './HavocMultiplayerBoxScore.svelte';

  let {
    output,
    series,
    localParticipantId,
    verification,
    readyCountdownMs,
    localReady,
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
    awaitingContinue: boolean;
    onready: () => void;
    oncontinue: () => void;
  } = $props();

  const localSide = $derived(
    havocMultiplayerLocalSide(series, output.gameNumber, localParticipantId),
  );
  const boxes = $derived(havocMultiplayerFinalBoxes(output.result));
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const localWon = $derived(output.winner === localParticipantId);
  const countdown = $derived(havocMultiplayerSecondsLeft(readyCountdownMs));
  const seriesOver = $derived(series.champion !== null);
  const nextGameNumber = $derived(
    havocMultiplayerCurrentGameNumber(series) ?? Math.min(7, output.gameNumber + 1),
  );

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

<section class="hm-results" data-verification={verification}>
  <header class="hm-results-head">
    <p class="h-eyebrow">
      Game {output.gameNumber} · {verification === 'verified' ? 'verified result' : 'provisional'}
    </p>
    <h2 class="hm-headline">
      {#if verification === 'mismatch'}
        Simulations disagree
      {:else if localWon}
        You win Game {output.gameNumber}
      {:else}
        Opponent wins Game {output.gameNumber}
      {/if}
    </h2>
    <p class="hm-final-score">
      <span data-side="local" data-negative={(localBox?.score ?? 0) < 0}
        >{localBox?.score ?? 0}</span
      >
      <span class="hm-dash" aria-hidden="true">–</span>
      <span data-side="opponent" data-negative={(opponentBox?.score ?? 0) < 0}
        >{opponentBox?.score ?? 0}</span
      >
    </p>
    <p class="hm-series-line">
      Series: You {localParticipantId === 'p1' ? series.wins.p1 : series.wins.p2}
      <span aria-hidden="true">–</span>
      {localParticipantId === 'p1' ? series.wins.p2 : series.wins.p1} Opp
    </p>
    <div class="hm-badge" data-tone={verificationView.tone}>
      {#if verificationView.tone === 'verified'}
        <ShieldCheck size={14} aria-hidden="true" />
      {:else if verificationView.tone === 'mismatch'}
        <ShieldAlert size={14} aria-hidden="true" />
      {:else}
        <Clock size={14} aria-hidden="true" />
      {/if}
      <span>{verificationView.label}</span>
    </div>
    <p class="hm-badge-detail">{verificationView.detail}</p>
  </header>

  <HavocMultiplayerBoxScore {boxes} {localSide} />

  <footer class="hm-results-footer">
    {#if awaitingContinue}
      <p class="hm-ready-line">Review the box score, then continue when ready.</p>
      <button type="button" class="h-button" data-havoc-multiplayer-continue onclick={oncontinue}>
        Continue
      </button>
    {:else}
      <div class="hm-ready-copy">
        <p class="hm-ready-line">
          {localReady ? "You're ready for the next game." : 'Ready to continue?'}
        </p>
        {#if countdown !== null}
          <p class="hm-countdown">
            <Clock size={13} aria-hidden="true" />
            Auto-ready in <strong>{countdown}s</strong>
          </p>
        {/if}
      </div>
      {#if !seriesOver}
        <button
          type="button"
          class="h-button"
          data-havoc-multiplayer-ready
          disabled={localReady}
          onclick={onready}
        >
          {localReady ? 'Ready' : `Ready for Game ${nextGameNumber}`}
        </button>
      {/if}
    {/if}
  </footer>
</section>

<style>
  .hm-results {
    display: grid;
    overflow: clip;
    border: 1px solid #465273;
    border-radius: 18px;
    background: #20294c;
  }
  .hm-results-head {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 18px 16px 14px;
    text-align: center;
    background: linear-gradient(180deg, rgb(103 157 255 / 10%), transparent);
  }
  .hm-headline {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 6vw, 2.4rem);
    font-weight: 900;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }
  .hm-final-score {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 10vw, 3.4rem);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .hm-final-score [data-side='local'] {
    color: #ffd782;
  }
  .hm-final-score [data-side='opponent'] {
    color: #f2f4ff;
  }
  .hm-final-score [data-negative='true'] {
    color: #f290c5;
  }
  .hm-dash {
    color: #aab9db;
    font-size: 0.55em;
  }
  .hm-series-line {
    margin: 2px 0 0;
    font-size: 0.85rem;
    color: #c1cae4;
  }
  .hm-badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
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
  .hm-badge-detail {
    max-width: 30rem;
    margin: 0;
    font-size: 11px;
    color: #c1cae4;
  }
  .hm-results :global(.hm-boxes) {
    padding: 14px;
  }
  .hm-results-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 14px;
    border-top: 1px solid #3c486b;
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
  .hm-results-footer .h-button {
    min-width: 12rem;
  }
</style>
