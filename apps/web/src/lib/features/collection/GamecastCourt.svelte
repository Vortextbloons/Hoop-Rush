<script lang="ts">
  import type { CollectionGameEvent } from '@hoop-rush/data-contracts';
  import { courtPlay } from './collection-court';

  let {
    event,
    nameOf,
    playing,
    duration = 900,
  }: {
    event: CollectionGameEvent | null;
    nameOf: (cardId: string) => string;
    playing: boolean;
    duration?: number;
  } = $props();
  const play = $derived(courtPlay(event));
  const away = $derived(
    event?.kind === 'possession' ? event.offenseSide === 'away' : play.side === 'away',
  );
</script>

<div class="simcast" class:away style:--play-duration={`${duration}ms`}>
  <div class="court-heading">
    <span
      ><i class:running={playing}></i>{event?.kind === 'final'
        ? 'Game complete'
        : playing
          ? 'On court'
          : 'Paused'}</span
    >
    <span>Ultimate Run · Gamecast</span>
  </div>
  <svg viewBox="0 0 940 500" role="img" aria-label="Illustrated basketball court">
    <defs>
      <pattern id="gamecast-wood" width="94" height="50" patternUnits="userSpaceOnUse">
        <rect width="94" height="50" fill="#b88249" />
        <path d="M0 0H94M0 25H94M47 0V25M15 25V50" stroke="#80552e" stroke-opacity=".25" />
      </pattern>
    </defs>
    <rect x="5" y="5" width="930" height="490" rx="12" fill="url(#gamecast-wood)" />
    <g fill="none" stroke="#f6e6cb" stroke-width="3" opacity=".8">
      <rect x="25" y="25" width="890" height="450" />
      <path d="M470 25V475" /><circle cx="470" cy="250" r="62" />
      <path d="M25 170H190V330H25M915 170H750V330H915" fill="#725237" fill-opacity=".35" />
      <circle cx="190" cy="250" r="60" /><circle cx="750" cy="250" r="60" />
      <path d="M25 60H95C365 60 365 440 95 440H25M915 60H845C575 60 575 440 845 440H915" />
      <path d="M65 215V285M875 215V285" stroke-width="6" />
    </g>
    <g fill="none" stroke="#ffcf71" stroke-width="4">
      <circle cx="80" cy="250" r="12" /><circle cx="860" cy="250" r="12" />
    </g>
    <text x="470" y="240" text-anchor="middle" class="court-brand">HOOP</text>
    <text x="470" y="277" text-anchor="middle" class="court-brand">RUSH</text>
    {#if event?.kind === 'possession'}
      {#key event.eventOrder}
        <g class="play-motion" class:held={!playing}>
          <circle class="actor-ring" cx="660" cy="250" r="26" />
          <circle class="actor" cx="660" cy="250" r="17" />
          {#if play.shot}
            <path class="shot-trail" d="M670 240Q765 105 860 250" />
          {/if}
          <g class="ball" class:shot={play.shot} class:miss={play.shot && !play.made}>
            <circle cx="0" cy="0" r="9" fill="#ffb65b" stroke="#583617" stroke-width="2" />
            <path
              d="M-9 0H9M0 -9V9M-6 -6Q5 0 -6 6"
              fill="none"
              stroke="#583617"
              stroke-width="1.4"
            />
          </g>
          {#if play.made}<circle class="basket-pulse" cx="860" cy="250" r="17" />{/if}
        </g>
      {/key}
    {/if}
  </svg>
  {#key event?.eventOrder}
    <div class="play-call" class:scored={play.made}>
      <span class="team-tag"
        >{play.side === 'home' ? 'YOUR TEAM' : play.side === 'away' ? 'CPU' : 'COURTSIDE'}</span
      >
      <strong
        >{play.label}{event?.kind === 'possession' && event.pointsScored > 0
          ? ` +${event.pointsScored}`
          : ''}</strong
      >
      <span class="player-name"
        >{play.cardId
          ? nameOf(play.cardId)
          : event?.kind === 'final'
            ? 'See the recap and box score for the full game.'
            : 'Follow the action.'}</span
      >
    </div>
  {/key}
  <p class="court-caption">Illustrated plays · Court positions are schematic</p>
</div>

<style>
  .simcast {
    margin: 1rem;
    overflow: hidden;
    border: 1px solid var(--ur-line);
    border-radius: 0.75rem;
    background: #10191f;
  }
  .court-heading {
    display: flex;
    justify-content: space-between;
    gap: 0.7rem;
    padding: 0.8rem 1rem;
    color: var(--ur-muted);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .court-heading i {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    margin-right: 0.5rem;
    border-radius: 50%;
    background: #657078;
  }
  .court-heading i.running {
    background: #81d2a5;
  }
  svg {
    display: block;
    width: 100%;
    max-height: 360px;
    padding: 0 0.6rem;
  }
  .court-brand {
    fill: #f6e6cb;
    opacity: 0.45;
    font: 900 35px var(--font-display);
    letter-spacing: 5px;
  }
  .play-motion {
    transform-origin: 470px 250px;
  }
  .away .play-motion {
    transform: rotate(180deg);
  }
  .actor {
    fill: #8bc9e0;
    stroke: #173b50;
    stroke-width: 3;
  }
  .away .actor {
    fill: #ffaf7d;
    stroke: #793d27;
  }
  .actor-ring {
    fill: none;
    stroke: #fff;
    opacity: 0.4;
    stroke-width: 2;
  }
  .shot-trail {
    fill: none;
    stroke: #fff1bd;
    stroke-width: 3;
    stroke-dasharray: 7 8;
    opacity: 0.65;
  }
  .ball {
    transform: translate(680px, 250px);
    animation: dribble var(--play-duration) ease-in-out both;
  }
  .ball.shot {
    animation-name: shoot;
  }
  .ball.miss {
    animation-name: miss;
  }
  .basket-pulse {
    fill: none;
    stroke: #fff1bd;
    stroke-width: 5;
    animation: basket var(--play-duration) ease-out both;
  }
  .held * {
    animation-play-state: paused;
  }
  .play-call {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.3rem 1rem;
    align-items: center;
    padding: 1rem 1.2rem;
    margin-top: 0.5rem;
    border-top: 1px solid var(--ur-line);
    background: #15232c;
    animation: call-in 0.2s ease-out;
  }
  .team-tag {
    grid-row: span 2;
    padding: 0.5rem 0.65rem;
    border: 1px solid #8bc9e060;
    border-radius: 0.3rem;
    color: #8bc9e0;
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }
  .away .team-tag {
    border-color: #ffaf7d60;
    color: #ffaf7d;
  }
  .play-call strong {
    color: var(--ur-paper);
    font: 800 clamp(1.15rem, 3vw, 1.65rem) var(--font-display);
  }
  .scored strong {
    color: var(--ur-apex);
  }
  .player-name {
    color: var(--ur-muted);
    font-size: 0.8rem;
  }
  .court-caption {
    margin: 0;
    padding: 0.5rem 1.2rem;
    color: var(--ur-muted);
    font-size: 0.62rem;
  }
  @keyframes dribble {
    0%,
    100% {
      transform: translate(680px, 250px);
    }
    35% {
      transform: translate(700px, 263px);
    }
    70% {
      transform: translate(725px, 250px);
    }
  }
  @keyframes shoot {
    0%,
    15% {
      transform: translate(680px, 250px);
    }
    50% {
      transform: translate(770px, 160px) scale(1.25);
    }
    80%,
    100% {
      transform: translate(860px, 250px) scale(0.7);
    }
  }
  @keyframes miss {
    0%,
    15% {
      transform: translate(680px, 250px);
    }
    50% {
      transform: translate(770px, 160px) scale(1.25);
    }
    75% {
      transform: translate(850px, 240px);
    }
    100% {
      transform: translate(805px, 290px);
    }
  }
  @keyframes basket {
    0%,
    65% {
      opacity: 0;
      transform: scale(1);
      transform-origin: 860px 250px;
    }
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: scale(2.5);
      transform-origin: 860px 250px;
    }
  }
  @keyframes call-in {
    from {
      opacity: 0.5;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ball,
    .basket-pulse,
    .play-call {
      animation: none;
    }
  }
  @media (max-width: 520px) {
    .simcast {
      margin: 0.6rem;
    }
    .court-heading {
      letter-spacing: 0.02em;
      padding: 0.7rem;
    }
    .play-call {
      padding: 0.8rem;
      gap: 0.3rem 0.7rem;
    }
  }
</style>
