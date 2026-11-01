<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_GAME_COUNT } from '@hoop-rush/data-contracts';
  import { capRushMultiplayerSeatRecord } from '@hoop-rush/engine';
  import { capRushMultiplayerPendingH2H } from '@hoop-rush/application/cap-rush-multiplayer';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusLabel } from '../cap-rush/cap-rush-presentation.js';
  import { seatLabelFor, teamNameOf } from './cap-rush-multiplayer-presentation.js';

  type StepAction = 'watch-h2h' | null;

  interface NextStep {
    readonly title: string;
    readonly detail: string;
    readonly action: StepAction;
    readonly actionLabel: string;
    readonly mine: boolean;
  }

  let {
    state,
    displayedSlot,
    localSeat,
    art = null,
    busy = false,
    broadcastLoading = false,
    onwatchh2h,
  }: {
    state: CapRushMultiplayerState;
    displayedSlot: number;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    broadcastLoading?: boolean;
    onwatchh2h: (gameId: string) => void;
  } = $props();

  const season = $derived(state.season);
  const locked = $derived(state.locked);
  const visibleGames = $derived(
    season?.games.filter((game) => game.slot <= Math.floor(displayedSlot)) ?? [],
  );
  const records = $derived(
    season === null || locked === null
      ? null
      : {
          p1: capRushMultiplayerSeatRecord(locked, visibleGames, 'p1'),
          p2: capRushMultiplayerSeatRecord(locked, visibleGames, 'p2'),
        },
  );
  const localRecord = $derived(records === null ? null : records[localSeat]);
  const otherSeat = $derived(localSeat === 'p1' ? ('p2' as const) : ('p1' as const));
  const otherRecord = $derived(records === null ? null : records[otherSeat]);
  const localName = $derived(
    locked === null ? null : locked.seats[localSeat].franchise.displayName,
  );
  const otherName = $derived(
    locked === null ? null : locked.seats[otherSeat].franchise.displayName,
  );
  const localIdentity = $derived(
    locked === null || art === null
      ? null
      : art.teamFor(locked.seats[localSeat].franchise.franchiseId),
  );
  const otherIdentity = $derived(
    locked === null || art === null
      ? null
      : art.teamFor(locked.seats[otherSeat].franchise.franchiseId),
  );
  const h2h = $derived(capRushMultiplayerPendingH2H({ state, locked }));
  const progress = $derived((displayedSlot / CAP_RUSH_GAME_COUNT) * 100);
  const played = $derived(localRecord?.played ?? 0);
  const remaining = $derived(Math.max(0, CAP_RUSH_GAME_COUNT - played));
  const h2hGame = $derived(
    h2h === null || season === null
      ? null
      : (season.games.find((game) => game.gameId === h2h.gameId) ?? null),
  );
  const localH2HConfirmed = $derived(h2h !== null && !h2h.missing.includes(localSeat));
  const latest = $derived.by(() => {
    if (season === null || locked === null) return null;
    const teamId = locked.seats[localSeat].franchise.franchiseId;
    const game =
      visibleGames
        .filter((entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId)
        .sort((left, right) => right.slot - left.slot)[0] ?? null;
    if (game === null) return null;
    const humanHome = game.homeTeamId === teamId;
    const pointsFor = humanHome ? game.homePoints : game.awayPoints;
    const pointsAgainst = humanHome ? game.awayPoints : game.homePoints;
    const opponentId = humanHome ? game.awayTeamId : game.homeTeamId;
    return {
      slot: game.slot,
      opponentId,
      humanHome,
      pointsFor,
      pointsAgainst,
      won: pointsFor > pointsAgainst,
      teams: [
        {
          key: 'you',
          label: locked.seats[localSeat].franchise.displayName,
          score: pointsFor,
          winner: pointsFor > pointsAgainst,
        },
        {
          key: 'opponent',
          label: teamName(opponentId),
          score: pointsAgainst,
          winner: pointsFor < pointsAgainst,
        },
      ] as const,
    };
  });
  const latestIdentity = $derived(
    latest === null || art === null ? null : art.teamFor(latest.opponentId),
  );

  const nextStep = $derived.by((): NextStep => {
    if (season === null) {
      return {
        title: 'The shared season is not ready.',
        detail: '',
        action: null,
        actionLabel: '',
        mine: false,
      };
    }

    if (h2h !== null) {
      const localMissing = h2h.missing.includes(localSeat);
      const confirmed = 2 - h2h.missing.length;
      return {
        title: localMissing
          ? `Head-to-head ready · Game ${h2h.slot}`
          : `You confirmed · Game ${h2h.slot}`,
        detail: localMissing
          ? 'Both players must confirm this result. Watch the broadcast, then continue when it ends.'
          : `Waiting for your opponent to watch and confirm. ${confirmed} of 2 confirmed; the season continues once both players confirm.`,
        action: localMissing ? 'watch-h2h' : null,
        actionLabel: localMissing ? 'Watch head-to-head' : '',
        mine: localMissing,
      };
    }

    if (season.frontierSlot >= CAP_RUSH_GAME_COUNT) {
      return {
        title: 'Regular season complete',
        detail: '',
        action: null,
        actionLabel: '',
        mine: false,
      };
    }

    return {
      title: 'Simulating the season',
      detail: '',
      action: null,
      actionLabel: '',
      mine: false,
    };
  });

  function teamName(teamId: string): string {
    return teamNameOf(locked, teamId);
  }
</script>

{#if season === null || locked === null || records === null || localRecord === null || otherRecord === null}
  <p class="text-sm text-muted-foreground">The shared season is not ready yet.</p>
{:else}
  <section
    class="season-hero flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 sm:p-6 lg:p-7"
    data-cap-rush-shared-progress
  >
    <div class="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
          Shared season · Through game {Math.floor(displayedSlot)} of {CAP_RUSH_GAME_COUNT}
        </p>
        <div class="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
          <h2
            class="font-display text-6xl leading-none font-extrabold tracking-tight tabular-nums sm:text-7xl"
          >
            {localRecord.wins}–{localRecord.losses}
          </h2>
          <div class="min-w-0 pb-1">
            <p class="truncate font-display text-2xl leading-tight font-extrabold uppercase">
              {localName}
            </p>
            <p class="mt-1 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              {played} played · {capStatusLabel(locked.seats[localSeat].payrollStatus)} · {remaining}
              left
            </p>
          </div>
        </div>
        <div
          class="mt-4 h-3 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Shared season progress"
          aria-valuemin={0}
          aria-valuemax={CAP_RUSH_GAME_COUNT}
          aria-valuenow={season.frontierSlot}
        >
          <div
            class="h-full origin-left rounded-full bg-primary will-change-transform"
            style:transform={`scaleX(${progress / 100})`}
          ></div>
        </div>
        <div
          class="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground tabular-nums"
        >
          <span>{Math.floor(progress)}% of the shared season</span>
          <span>{visibleGames.length} / 1230 results</span>
        </div>
      </div>

      <div class="min-w-0">
        <dl class="grid grid-cols-3 gap-2">
          <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Points for
            </dt>
            <dd class="mt-1 font-display text-2xl font-extrabold tabular-nums">
              {localRecord.pointsFor}
            </dd>
          </div>
          <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Points against
            </dt>
            <dd class="mt-1 font-display text-2xl font-extrabold tabular-nums">
              {localRecord.pointsAgainst}
            </dd>
          </div>
          <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
            <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
              Remaining
            </dt>
            <dd class="mt-1 font-display text-2xl font-extrabold tabular-nums">{remaining}</dd>
          </div>
        </dl>
        <div
          class="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-1 px-3 py-2"
        >
          {#if otherIdentity !== null && art !== null}
            <TeamLogo
              manifest={art.manifest}
              franchiseId={otherIdentity.franchiseId}
              teamExternalId={otherIdentity.teamExternalId}
              className="h-7 w-7 shrink-0"
            />
          {:else}
            <span
              class="grid h-7 w-7 shrink-0 place-items-center rounded bg-surface-3 font-display text-[9px] font-extrabold text-muted-foreground"
              aria-hidden="true">?</span
            >
          {/if}
          <div class="min-w-0 flex-1">
            <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
              {seatLabelFor(otherSeat, localSeat)}
            </p>
            <p class="truncate text-sm font-bold">{otherName}</p>
          </div>
          <p class="shrink-0 font-display text-2xl font-extrabold tabular-nums">
            {otherRecord.wins}–{otherRecord.losses}
          </p>
        </div>
      </div>
    </div>

    <div class="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div class="min-w-0 rounded-xl border border-line-strong bg-surface-1 p-4">
        {#if latest === null}
          <p
            class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
          >
            Latest result
          </p>
          <p class="mt-2 text-sm text-muted-foreground">
            The first results will appear as the season advances.
          </p>
        {:else}
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Latest result · Game {latest.slot} · {latest.humanHome ? 'Home' : 'Away'}
            </p>
            <span
              class="rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase {latest.won
                ? 'border-positive/40 bg-positive/10 text-positive'
                : 'border-negative/40 bg-negative/10 text-negative'}"
            >
              {latest.won ? 'Win' : 'Loss'}
            </span>
          </div>
          <GameScoreboard
            teams={latest.teams}
            label={`Game ${latest.slot} score`}
            layout="duo"
            class="mt-3 text-4xl sm:text-5xl"
          >
            {#snippet team(entry)}
              {@const identity = entry.key === 'you' ? localIdentity : latestIdentity}
              <div
                class="ui-scoreboard-team"
                data-align={entry.key === 'you' ? 'start' : 'end'}
                data-winner={entry.winner === true}
              >
                {#if identity !== null && art !== null}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={identity.franchiseId}
                    teamExternalId={identity.teamExternalId}
                    className="mb-1 h-9 w-9"
                  />
                {/if}
                <span class="ui-scoreboard-label max-w-[11rem] truncate">{entry.label}</span>
                {#key entry.score}
                  <strong class="ui-scoreboard-score">{entry.score}</strong>
                {/key}
              </div>
            {/snippet}
          </GameScoreboard>
        {/if}
      </div>

      <div
        class="flex min-w-0 flex-col gap-2 rounded-xl border p-4 {nextStep.mine
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-surface-1'}"
        role="status"
        data-step={nextStep.action ?? 'waiting'}
      >
        <p
          class="font-mono text-[10px] font-bold tracking-[0.14em] uppercase {nextStep.mine
            ? 'text-primary'
            : 'text-muted-foreground'}"
        >
          {nextStep.mine
            ? 'Your move'
            : h2h === null
              ? 'Season in progress'
              : 'Waiting for opponent'}
        </p>
        <p class="font-display text-2xl leading-tight font-extrabold tracking-tight uppercase">
          {nextStep.title}
        </p>
        {#if h2hGame !== null && localH2HConfirmed}
          <p class="font-mono text-xs font-semibold tabular-nums">
            {teamName(h2hGame.homeTeamId)}
            {h2hGame.homePoints}–{h2hGame.awayPoints}
            {teamName(h2hGame.awayTeamId)}
          </p>
        {/if}
        {#if nextStep.detail}
          <p class="text-xs leading-relaxed text-muted-foreground">{nextStep.detail}</p>
        {/if}
        {#if nextStep.action === 'watch-h2h' && h2hGame !== null}
          <button
            type="button"
            class="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none
              focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:w-fit"
            disabled={busy || broadcastLoading}
            onclick={() => onwatchh2h(h2hGame.gameId)}
          >
            {broadcastLoading ? 'Preparing broadcast…' : nextStep.actionLabel}
          </button>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .season-hero {
    border-top: 3px solid var(--color-primary);
    background-image: radial-gradient(
      ellipse at top right,
      color-mix(in srgb, var(--color-primary) 12%, transparent),
      transparent 55%
    );
  }
</style>
