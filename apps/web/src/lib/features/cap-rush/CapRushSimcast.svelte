<script lang="ts">
  import { onMount } from 'svelte';
  import '#lib/gamecast/gamecast-broadcast.css';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { initialsOf } from '#lib/branding.js';
  import { ratioPct } from '#lib/format.js';
  import type { CapRushArt } from './cap-rush-art.js';
  import { capRushPlaybackItems } from './cap-rush-playback.js';
  import type { CapRushSeasonController } from './cap-rush-season-state.svelte.js';
  import { havocMultiplayerVisibleState } from '#lib/features/havoc-multiplayer/havoc-multiplayer-playback.js';
  import {
    havocMultiplayerLiveBoxes,
    havocMultiplayerFinalBoxes,
  } from '#lib/features/havoc-multiplayer/havoc-multiplayer-playback-view.js';
  import HavocMultiplayerBoxScore from '#lib/features/havoc-multiplayer/HavocMultiplayerBoxScore.svelte';
  import {
    formatHavocClock,
    havocPeriodLabel,
    havocEventTextOf,
  } from '#lib/features/havoc/havoc-presentation.js';

  let { controller, art = null }: { controller: CapRushSeasonController; art?: CapRushArt | null } =
    $props();
  let paused = $state(false);
  const speed = 4;
  const playback = $derived(controller.playback);
  const items = $derived(playback === null ? [] : capRushPlaybackItems(playback.evidence.tape));
  const cursor = $derived(playback?.evidence.cursor ?? 0);
  const finished = $derived(cursor === items.length);
  const visible = $derived(havocMultiplayerVisibleState(items, cursor));
  const boxes = $derived(
    playback === null
      ? []
      : finished
        ? havocMultiplayerFinalBoxes(playback.result)
        : havocMultiplayerLiveBoxes(playback.result, visible),
  );
  const names = $derived(
    new Map(
      playback === null
        ? []
        : [...playback.result.home.participants, ...playback.result.away.participants].map(
            (line) => [line.instanceId, line.displayName],
          ),
    ),
  );
  const context = $derived({
    playerName: (id: string) => names.get(id) ?? 'Player',
    homeName: playback?.result.home.displayName ?? 'Home',
    awayName: playback?.result.away.displayName ?? 'Away',
    humanSide: playback?.result.humanSide ?? ('home' as const),
  });
  const localSide = $derived(playback?.result.humanSide ?? 'home');
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const sides = $derived(
    localBox === undefined || opponentBox === undefined ? [] : [localBox, opponentBox],
  );
  const leader = $derived(
    localBox?.score === opponentBox?.score
      ? null
      : (localBox?.score ?? 0) > (opponentBox?.score ?? 0)
        ? 'local'
        : 'opponent',
  );
  const possession = $derived(
    visible.events.findLast((event) => event.kind === 'possession-start'),
  );
  const feed = $derived(items.slice(0, cursor).slice(-18).reverse());

  const apronFacts = $derived.by(() => {
    if (playback === null) return [];
    const counts = { home: 0, away: 0 };
    for (const event of visible.events)
      if (event.kind === 'possession-start') counts[event.offenseSide] += 1;
    return playback.evidence.facts.filter((fact) => {
      const offense = fact.kind === 'strike' ? (fact.side === 'home' ? 'away' : 'home') : fact.side;
      return finished || counts[offense] > fact.possessionOrdinal;
    });
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (paused || finished || controller.playbackSaving || controller.error !== null) return;
      const step = Math.max(1, Math.ceil((items.length * speed) / 100));
      void controller.seekPlayback(Math.min(items.length, cursor + step));
    }, 100);
    return () => clearInterval(timer);
  });
</script>

<section class="broadcast" aria-label="Cap Rush Simcast">
  <GameScoreboard
    teams={[
      { key: 'local', label: 'You', score: localBox?.score ?? 0 },
      { key: 'opponent', label: 'Opponent', score: opponentBox?.score ?? 0 },
    ]}
    label="Cap Rush game score"
    class="bc-board"
  >
    {#snippet team(entry)}
      {@const box = entry.key === 'local' ? localBox : opponentBox}
      {@const teamId =
        playback === null || box === undefined ? '' : playback.result[box.side].teamId}
      {@const identity = art?.teamFor(teamId)}
      <div
        class={entry.key === 'local' ? 'bc-team you' : 'bc-team opp'}
        data-leading={entry.key === leader}
      >
        <span class="bc-team-label">{entry.label} &middot; {box?.side ?? ''}</span>
        <span class="simcast-team-name">
          {#if identity && art}<TeamLogo
              manifest={art.manifest}
              franchiseId={identity.franchiseId}
              teamExternalId={identity.teamExternalId}
              alt=""
              className="h-6 w-6"
            />{/if}
          {box?.displayName ?? ''}
        </span>
        {#if entry.key === leader}<span class="bc-leader">{finished ? 'Winner' : 'Leading'}</span
          >{:else}<span class="bc-leader invisible" aria-hidden="true">Leading</span>{/if}
        {#key entry.score}<span class="bc-score">{entry.score}</span>{/key}
      </div>
    {/snippet}
    {#snippet status()}
      <div class="bc-center">
        <span class="bc-live" data-tone={finished ? 'final' : 'live'}
          ><span class="bc-live-dot" aria-hidden="true"></span>{finished
            ? 'Final'
            : paused
              ? 'Paused'
              : 'Live'}</span
        >
        <span class="bc-clock"
          >{havocPeriodLabel(visible.period)} &middot; {formatHavocClock(
            visible.clockSeconds,
          )}</span
        >
        {#if !finished}<span class="bc-possession"
            >{possession?.kind === 'possession-start'
              ? `${possession.offenseSide === localSide ? 'Your' : 'Opponent'} possession`
              : 'Tip-off soon'}</span
          >{/if}
        <span class="bc-quarters" aria-hidden="true"
          >{#each [1, 2, 3, 4] as quarter (quarter)}<span
              class="bc-quarter"
              class:done={quarter < visible.period}
              class:now={quarter === visible.period}
            ></span>{/each}</span
        >
      </div>
    {/snippet}
  </GameScoreboard>
  <div
    class="bc-progress"
    role="progressbar"
    aria-label="Broadcast progress"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round((cursor / Math.max(1, items.length)) * 100)}
  >
    <div
      class="bc-progress-fill"
      data-active={finished ? undefined : 'true'}
      style:width={`${(cursor / Math.max(1, items.length)) * 100}%`}
    ></div>
  </div>
  <div class="mt-3 flex flex-wrap items-center gap-3">
    {#if finished}
      <button
        class="min-h-11 rounded-xl border border-primary px-4 font-bold text-primary"
        disabled={controller.playbackSaving || controller.busy}
        onclick={() => void controller.finishPlayback()}>Continue</button
      >
    {:else}
      <button
        class="min-h-11 rounded-xl border border-line-strong px-4"
        onclick={() => (paused = !paused)}>{paused ? 'Resume' : 'Pause'}</button
      >
      <span class="font-mono text-xs text-muted-foreground uppercase">4× speed</span>
      <button
        class="min-h-11 rounded-xl border border-line-strong px-4"
        disabled={controller.playbackSaving}
        onclick={() => void controller.seekPlayback(items.length)}>Skip to final</button
      >
    {/if}
  </div>
  {#if controller.error !== null}
    <div role="alert" class="rounded-xl border border-negative p-4">
      <p>{controller.error}</p>
      <button
        class="mt-2 min-h-11 underline"
        onclick={() => {
          controller.error = null;
          paused = false;
        }}>Retry playback</button
      >
    </div>
  {/if}
  <div class="bc-panels">
    {#each sides as side (side.side)}
      <section class="bc-panel" aria-label={`${side.displayName} player stats`}>
        <header class="bc-panel-head">
          <span class="bc-panel-team" data-side={side.side}
            >{side.side === localSide ? 'You' : 'Opponent'}</span
          ><strong class="bc-panel-score">{side.score}</strong>
        </header>
        <div class="bc-panel-cols" aria-hidden="true">
          <span>Player</span><span>PTS</span><span>REB</span><span>AST</span><span>TO</span><span
            >FG%</span
          ><span>FT%</span>
        </div>
        <ul class="bc-rows">
          {#each side.lines as row (row.instanceId)}
            {@const face =
              row.sourcePlayerId === undefined ? null : art?.faceForPlayerId(row.sourcePlayerId)}
            {@const hot =
              row.points > 0 && row.points === Math.max(...side.lines.map((line) => line.points))}
            <li class="bc-row" class:hot>
              <span class="bc-ident">
                {#if face && art}<PlayerFace
                    manifest={art.manifest}
                    player={face}
                    size="sm"
                    fallbackInitials={initialsOf(row.displayName)}
                  />{:else}<span class="bc-face">{initialsOf(row.displayName)}</span>{/if}
                <span class="bc-ident-text"
                  ><span class="bc-name">{row.displayName}</span><span class="bc-sub"
                    >{row.slot} &middot; {row.kind}{#if hot}<span class="bc-hot">Top scorer</span
                      >{/if}</span
                  ></span
                >
              </span>
              <span class="bc-stat big" data-stat="pts">{row.points}</span><span
                class="bc-stat"
                data-stat="reb">{row.rebounds}</span
              ><span class="bc-stat" data-stat="ast">{row.assists}</span><span
                class="bc-stat"
                data-stat="tov">{row.turnovers}</span
              ><span class="bc-stat" data-stat="fg"
                >{ratioPct(row.fieldGoalsMade, row.fieldGoalsAttempted)}</span
              ><span class="bc-stat" data-stat="tp"
                >{ratioPct(row.freeThrowsMade, row.freeThrowsAttempted)}</span
              >
            </li>
          {/each}
        </ul>
        <p
          class="px-4 py-2 font-mono text-xs text-muted-foreground {side.bonusPoints === 0
            ? 'invisible'
            : ''}"
          aria-hidden={side.bonusPoints === 0}
        >
          Team bonus {side.bonusPoints > 0 ? '+' : ''}{side.bonusPoints}
        </p>
      </section>
    {/each}
  </div>
  {#if playback !== null}
    <details class="rounded-xl border border-line-soft bg-card p-4">
      <summary class="cursor-pointer text-sm font-bold"
        >Full {finished ? 'final' : 'live'} box score</summary
      >
      <div class="mt-3"><HavocMultiplayerBoxScore {boxes} {localSide} /></div>
    </details>
  {/if}
  {#if apronFacts.length > 0}
    <section class="rounded-2xl border border-line-soft bg-card p-4" aria-label="Apron facts">
      <h2 class="font-display text-lg font-bold">Apron effects</h2>
      <ol class="mt-3 space-y-2 text-sm">
        {#each apronFacts as fact, index (index)}
          <li>
            {fact.side === 'home' ? context.homeName : context.awayName} &middot; Possession {fact.possessionOrdinal}:
            {fact.kind === 'isolation'
              ? `${fact.reason}: ${context.playerName(fact.targetInstanceId)}`
              : fact.kind === 'strike'
                ? `${context.playerName(fact.targetInstanceId)} strike`
                : 'Pass interception'}
          </li>
        {/each}
      </ol>
    </section>
  {/if}
  <section class="bc-feed" aria-label="Play-by-play feed">
    <header class="bc-feed-head">
      <h3>Live feed</h3>
      <span class="bc-feed-count"
        >{visible.events.filter((event) => event.kind === 'possession-start').length} possessions</span
      >
    </header>
    {#if feed.length > 0}
      <ul class="bc-feed-list" aria-live="polite">
        {#each feed as item, index (item.key)}
          {@const side =
            item.scoring?.side ??
            (item.event !== null && 'side' in item.event
              ? item.event.side
              : item.event?.kind === 'possession-start'
                ? item.event.offenseSide
                : null)}
          <li
            class="bc-feed-line"
            class:latest={index === 0}
            data-offense={side === localSide ? 'local' : 'opponent'}
          >
            <span class="bc-feed-clock"
              >{havocPeriodLabel(item.period)} {formatHavocClock(item.clockSeconds)}</span
            >
            <span class="bc-feed-team" data-side={side === localSide ? 'local' : 'opponent'}
              >{side === null ? 'Game' : side === localSide ? 'You' : 'Opp'}</span
            >
            <span class="bc-feed-tag" data-points={(item.scoring?.points ?? 0) > 0 ? 'yes' : 'no'}
              >{item.scoring?.kind === 'adjustment'
                ? 'ADJ'
                : item.scoring?.kind === 'bonus'
                  ? 'BONUS'
                  : item.event?.kind === 'possession-start'
                    ? 'POSS'
                    : item.scoring !== null
                      ? 'PTS'
                      : 'PLAY'}</span
            >
            <span class="bc-feed-summary"
              >{item.event !== null
                ? havocEventTextOf(item.event, context)
                : item.scoring !== null
                  ? `${context.playerName(item.scoring.actorInstanceId)} ${item.scoring.kind}`
                  : ''}</span
            >
            {#if item.scoring !== null}<span
                class="bc-feed-pts"
                data-negative={item.scoring.points < 0}
                >{item.scoring.points > 0 ? '+' : ''}{item.scoring.points}</span
              >{/if}
          </li>
        {/each}
      </ul>
    {:else}<p class="bc-feed-empty">Waiting for the first possession&hellip;</p>{/if}
  </section>
</section>

<style>
  .bc-feed-pts[data-negative='true'] {
    color: var(--color-negative);
  }
  .simcast-team-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-muted-foreground);
  }
  .bc-feed-list,
  .bc-feed-empty {
    height: 236px;
  }
</style>
