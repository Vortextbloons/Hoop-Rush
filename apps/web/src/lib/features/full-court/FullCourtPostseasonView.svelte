<script lang="ts">
  import PlayoffSeriesWins from '#lib/components/screens/PlayoffSeriesWins.svelte';
  import PlayoffGameRow from '#lib/components/screens/PlayoffGameRow.svelte';
  import SimulationStatus from '#lib/components/screens/SimulationStatus.svelte';
  import ChampionshipBanner from '#lib/components/screens/ChampionshipBanner.svelte';
  import {
    CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    CAP_RUSH_SERIES_WINS,
    capRushConferenceRoundName,
    capRushSeriesWins,
    type FullCourtSeasonCheckpoint,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { FastForward, Play, ShieldAlert, SkipForward, Trophy } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import PlayoffBracket from '#lib/components/basketball/PlayoffBracket.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { getManifest } from '#lib/data.js';
  import type { FullCourtArt } from './full-court-art.js';
  import {
    fullCourtHomeControls,
    fullCourtPlayoffAdaptationRead,
    fullCourtSeriesGames,
    fullCourtUserSeries,
    type FullCourtAdvanceOptions,
    type FullCourtHomeAction,
    type FullCourtPlayoffView,
    type FullCourtSimulationNotice,
  } from './full-court-season-presenter.js';
  import {
    buildFullCourtNotableMoments,
    fullCourtUserNextPlayoffMatchup,
    type FullCourtSeasonLock,
    type FullCourtStandings,
  } from '@hoop-rush/engine';

  let {
    lock,
    checkpoint,
    playoff,
    standings,
    pendingForfeit,
    busy,
    simulating = false,
    simProgress = null,
    stopRequested = false,
    notice = null,
    onDismissNotice,
    onAdvance,
    onStartPlayoffs,
    onStopAfterGame,
    art = null,
  }: {
    lock: FullCourtSeasonLock;
    checkpoint: FullCourtSeasonCheckpoint;
    playoff: FullCourtPlayoffView | null;
    standings: FullCourtStandings;
    pendingForfeit: boolean;
    busy: boolean;
    simulating?: boolean;
    simProgress?: { readonly completed: number; readonly total: number } | null;
    stopRequested?: boolean;
    notice?: FullCourtSimulationNotice | null;
    onDismissNotice?: () => void;
    onAdvance: (count: number, acceptForfeit?: boolean, options?: FullCourtAdvanceOptions) => void;
    onStartPlayoffs: () => void;
    onStopAfterGame?: () => void;
    art?: FullCourtArt | null;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);

  onMount(() => {
    let mounted = true;
    void getManifest()
      .then((loaded) => {
        if (mounted) manifest = loaded;
      })
      .catch(() => {
        // Logos are optional; every team still renders by name.
      });
    return () => {
      mounted = false;
    };
  });

  const teamsById = $derived(new Map(lock.season.teams.map((team) => [team.teamId, team])));
  const userTeamId = $derived(lock.season.userTeamId);
  const userTeamName = $derived(teamName(userTeamId));
  const rowByTeam = $derived(
    new Map([...standings.west, ...standings.east].map((row) => [row.teamId, row])),
  );
  const userRow = $derived(rowByTeam.get(userTeamId) ?? null);
  const played = $derived(
    Math.min(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, checkpoint.completedThroughSlot),
  );
  const remaining = $derived(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - played);
  const regularComplete = $derived(remaining === 0);

  const userSeries = $derived(
    playoff === null ? null : fullCourtUserSeries(playoff.series, userTeamId),
  );
  const userSeriesGames = $derived(
    userSeries === null ? [] : fullCourtSeriesGames(userSeries, userTeamId),
  );
  const userSeriesWins = $derived(
    userSeries === null ? 0 : capRushSeriesWins(userSeries, userTeamId),
  );
  const opponentWins = $derived(
    userSeries === null
      ? 0
      : capRushSeriesWins(
          userSeries,
          userSeries.highTeamId === userTeamId ? userSeries.lowTeamId : userSeries.highTeamId,
        ),
  );
  const userSeriesActive = $derived(
    userSeries !== null &&
      userSeriesWins < CAP_RUSH_SERIES_WINS &&
      opponentWins < CAP_RUSH_SERIES_WINS,
  );
  const opponentId = $derived(
    userSeries === null
      ? null
      : userSeries.highTeamId === userTeamId
        ? userSeries.lowTeamId
        : userSeries.highTeamId,
  );
  const championId = $derived(playoff?.championTeamId ?? null);
  const isChampion = $derived(championId !== null && championId === userTeamId);
  const latestSeriesGame = $derived(userSeriesGames.at(-1) ?? null);
  const nextSeriesGame = $derived(
    userSeries === null || !userSeriesActive ? null : userSeries.games.length + 1,
  );
  const controls = $derived(
    fullCourtHomeControls({ lock, checkpoint, playoff, pendingForfeit, busy }),
  );
  const playoffRecord = $derived.by(() => {
    if (playoff === null) return { wins: 0, losses: 0 };
    let wins = 0;
    let losses = 0;
    for (const series of playoff.series) {
      if (series.highTeamId !== userTeamId && series.lowTeamId !== userTeamId) continue;
      for (const game of series.games) {
        if (game.winnerTeamId === userTeamId) wins += 1;
        else losses += 1;
      }
    }
    return { wins, losses };
  });
  const playoffRounds = $derived(
    playoff === null
      ? 0
      : Math.max(
          1,
          ...playoff.series.filter((entry) => entry.games.length > 0).map((entry) => entry.round),
        ),
  );
  const userPlayoffPreview = $derived(
    playoff === null || !userSeriesActive
      ? null
      : fullCourtUserNextPlayoffMatchup({
          userTeamId,
          runSeed: lock.season.runSeed,
          series: playoff.series,
        }),
  );
  const userPlayoffAdjustment = $derived(
    userPlayoffPreview?.adaptation == null
      ? null
      : fullCourtPlayoffAdaptationRead(userPlayoffPreview.adaptation),
  );
  const playoffMoments = $derived(
    playoff === null
      ? null
      : buildFullCourtNotableMoments({
          teams: lock.season.teams,
          userTeamId,
          regularScores: [],
          series: playoff.series,
        }),
  );

  function teamName(teamId: string): string {
    return teamsById.get(teamId)?.displayName ?? teamId;
  }

  function seedOf(teamId: string): number {
    return rowByTeam.get(teamId)?.seed ?? 0;
  }

  function recordLabel(wins: number, losses: number): string {
    return `${String(wins)}–${String(losses)}`;
  }

  function identityOf(teamId: string) {
    const identity = manifest === null ? null : franchiseIdentityOf(manifest, teamId);
    if (identity === null) return null;
    return {
      franchiseId: identity.franchiseId,
      teamExternalId: identity.teamExternalId,
      abbreviation: identity.abbreviation,
    };
  }

  function runAction(action: FullCourtHomeAction): void {
    if (busy || pendingForfeit) return;
    if (action.kind === 'start-playoffs') {
      onStartPlayoffs();
      return;
    }
    if (action.count <= 0) return;
    onAdvance(action.count, false, {
      stopAtInjury: action.stopAtInjury,
      stopAtReview: action.stopAtReview,
    });
  }

  /** Headline copy per postseason state, in the broadcast register Cap Rush uses. */
  const headline = $derived.by(() => {
    if (playoff === null) {
      return regularComplete ? 'The bracket is ready to seed' : 'The bracket opens after 82 games';
    }
    if (championId !== null) {
      return isChampion ? 'Champions.' : `${teamName(championId)} take the title`;
    }
    if (playoff.userOutcome.status === 'not-qualified') return 'The field closed without you';
    if (playoff.userOutcome.status === 'eliminated') {
      return `Out in the ${capRushConferenceRoundName(playoff.userOutcome.round ?? 1).toLowerCase()}`;
    }
    const round = userSeries?.round ?? 1;
    if (round === 4) return 'The NBA Finals';
    if (round === 1) return 'The first round is live';
    return `${capRushConferenceRoundName(round)} is live`;
  });
</script>

<section class="postseason flex flex-col gap-3" aria-label="Full Court postseason">
  <header class="postseason-hero">
    <div class="min-w-0">
      <p class="ui-label">Full Court · Postseason</p>
      <h1 class="postseason-title">{headline}</h1>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if userRow !== null}
        <span class="seed-pill">
          {userRow.conference} seed {userRow.seed} · {recordLabel(userRow.wins, userRow.losses)}
        </span>
      {:else}
        <span class="seed-pill" data-tone="muted">82 games complete</span>
      {/if}
      {#if playoff !== null}
        <Badge tone={championId === null ? 'accent' : 'positive'}>
          {championId === null ? `Round ${String(playoffRounds)}` : 'Bracket final'}
        </Badge>
      {/if}
    </div>
  </header>

  {#if isChampion}
    <ChampionshipBanner team={userTeamName} label="Full Court champions" />
  {:else if championId !== null}
    <Panel padding="md" class="border-accent/40" role="status">
      <p class="ui-label text-accent">Champion</p>
      <div class="mt-2 flex items-center gap-3">
        {#if identityOf(championId) !== null && manifest !== null}
          {@const identity = identityOf(championId)}
          <TeamLogo
            {manifest}
            franchiseId={identity?.franchiseId ?? championId}
            teamExternalId={identity?.teamExternalId ?? ''}
            alt=""
            className="h-9 w-9"
          />
        {/if}
        <h2 class="postseason-champion-name">{teamName(championId)}</h2>
      </div>
      <StatGrid class="mt-3" columns={3} mobile={3}>
        <StatTile
          label="Your series"
          size="md"
          surface="tile"
          value={userSeries === null ? '—' : `${String(userSeriesWins)}–${String(opponentWins)}`}
        />
        <StatTile
          label="Playoff record"
          size="md"
          surface="tile"
          value={`${String(playoffRecord.wins)}–${String(playoffRecord.losses)}`}
        />
        <StatTile
          label="Final record"
          size="md"
          surface="tile"
          value={recordLabel(userRow?.wins ?? 0, userRow?.losses ?? 0)}
        />
      </StatGrid>
    </Panel>
  {/if}

  <Panel padding="none" class="p-4" aria-label="Postseason action">
    <div class="flex flex-wrap items-center gap-2">
      {#if simulating}
        <SimulationStatus
          class="w-full"
          label="Postseason simulation progress"
          progress={simProgress}
          stopping={stopRequested}
          onStop={onStopAfterGame}
        />
      {:else if controls.primary !== null}
        <Button
          tone="primary"
          disabled={busy}
          onclick={() => {
            if (controls.primary !== null) runAction(controls.primary);
          }}
        >
          {#if controls.primary.kind === 'start-playoffs'}
            <Trophy size={15} aria-hidden="true" />
          {:else}
            <Play size={15} aria-hidden="true" />
          {/if}
          {controls.primary.label}
        </Button>
      {:else}
        <span
          class="inline-flex min-h-11 items-center gap-2 font-mono text-[10px] font-bold text-muted-foreground uppercase"
        >
          <Trophy size={14} aria-hidden="true" />
          Bracket complete
        </span>
      {/if}

      {#if !simulating && !pendingForfeit}
        {#each controls.secondary as action (action.label)}
          <Button size="sm" tone="secondary" disabled={busy} onclick={() => runAction(action)}>
            {#if action.count >= 5}
              <FastForward size={13} aria-hidden="true" />
            {:else}
              <SkipForward size={13} aria-hidden="true" />
            {/if}
            {action.label}
          </Button>
        {/each}
      {/if}
    </div>
    {#if controls.status}
      <p class="mt-2 text-[11px] text-muted-foreground" role="status">{controls.status}</p>
    {/if}

    {#if pendingForfeit}
      <Alert class="mt-3" tone="warning" title="Confirm the forfeit">
        <p>
          The next playoff game is a forfeit. Confirm it to record the result and keep the bracket
          moving.
        </p>
        {#snippet actions()}
          <Button tone="primary" disabled={busy} onclick={() => onAdvance(1, true)}>
            <ShieldAlert size={15} aria-hidden="true" />
            {busy ? 'Recording…' : 'Confirm forfeit'}
          </Button>
        {/snippet}
      </Alert>
    {:else if notice !== null && !busy}
      {#if notice.stop.kind === 'injury'}
        <Alert class="mt-3" tone={notice.tone} title={notice.title}>
          <p>{notice.message}</p>
          {#snippet actions()}
            <Button size="sm" tone="secondary" onclick={() => onDismissNotice?.()}>Dismiss</Button>
          {/snippet}
        </Alert>
      {:else}
        <p class="mt-2 text-xs font-medium text-muted-foreground" role="status">
          <span class="font-semibold text-foreground">{notice.title}</span> · {notice.message}
        </p>
      {/if}
    {/if}
  </Panel>

  {#if userSeries !== null && championId === null}
    <section class="series-panel" aria-label="Your playoff series">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div class="min-w-0">
          <p class="ui-label text-accent">
            {capRushConferenceRoundName(userSeries.round)} ·
            {userSeriesActive ? `Game ${String(nextSeriesGame ?? 1)}` : 'Series complete'}
          </p>
          <h2 class="series-title">
            {userSeriesActive ? 'Your series is live' : 'Your series is decided'}
          </h2>
        </div>
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          Best of seven · First to {CAP_RUSH_SERIES_WINS}
        </p>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {#each [userSeries.highTeamId, userSeries.lowTeamId] as teamId, index (teamId)}
          {@const identity = identityOf(teamId)}
          {@const wins = capRushSeriesWins(userSeries, teamId)}
          {@const won = wins >= CAP_RUSH_SERIES_WINS}
          {@const isUser = teamId === userTeamId}
          <div
            class="series-side {isUser ? 'series-side-user' : ''} {index === 1
              ? 'sm:order-3 sm:text-right'
              : ''}"
          >
            {#if identity !== null && manifest !== null}
              <TeamLogo
                {manifest}
                franchiseId={identity.franchiseId}
                teamExternalId={identity.teamExternalId}
                alt=""
                className="h-8 w-8 {index === 1 ? 'sm:order-2' : ''}"
              />
            {/if}
            <div class="min-w-0 flex-1">
              <p class="font-mono text-[9px] text-muted-foreground uppercase">
                Seed {seedOf(teamId)}
              </p>
              <p class="truncate text-sm font-bold" title={teamName(teamId)}>
                {teamName(teamId)}
              </p>
              {#if won}
                <p class="font-mono text-[9px] font-bold text-positive uppercase">Series won</p>
              {/if}
            </div>
            <div class="shrink-0 text-center">
              <PlayoffSeriesWins {wins} {won} />
            </div>
          </div>
          {#if index === 0}
            <span
              class="hidden text-center font-mono text-[10px] text-muted-foreground uppercase sm:order-2 sm:block"
              >vs</span
            >
          {/if}
        {/each}
      </div>

      {#if userSeriesGames.length > 0}
        <ol class="mt-4 flex flex-col gap-1.5" aria-label="Games in your playoff series">
          {#each [...userSeriesGames].reverse() as game, index (game.gameId)}
            {@const topMoment = playoffMoments?.byGameId.get(game.gameId)?.[0] ?? null}
            <PlayoffGameRow
              ordinal={game.gameOrdinal}
              home={game.userHome}
              won={game.won}
              latest={index === 0}
            >
              {#snippet score()}
                <span class="font-display ml-auto text-lg font-extrabold tabular-nums"
                  >{game.userPoints}–{game.opponentPoints}</span
                >
              {/snippet}
              {#if game.forfeit}
                <span class="font-mono text-[8px] text-muted-foreground uppercase">Forfeit</span>
              {/if}
              {#if topMoment !== null}
                <span class="w-full text-[11px] text-muted-foreground">
                  <strong
                    class={topMoment.tier === 'historic'
                      ? 'text-accent'
                      : topMoment.isUserPlayerOrTeam
                        ? 'text-primary'
                        : 'text-foreground'}
                  >
                    {topMoment.headline}
                  </strong>
                  · {topMoment.playerName ?? topMoment.teamName} ({topMoment.statLine})
                </span>
              {/if}
            </PlayoffGameRow>
          {/each}
        </ol>
      {/if}
    </section>
  {:else if playoff !== null && championId === null}
    <Panel padding="md" class="border-dashed" aria-label="Postseason status">
      <p class="font-display text-lg font-extrabold uppercase">
        {playoff.userOutcome.status === 'not-qualified'
          ? 'Not in the bracket'
          : 'The bracket moves on'}
      </p>
    </Panel>
  {/if}

  {#if playoff !== null}
    <PlayoffBracket
      series={playoff.series}
      {manifest}
      {userTeamId}
      teamNameOf={teamName}
      teamSeedOf={seedOf}
      teamIdentityOf={identityOf}
      ariaLabel="Full Court playoff bracket"
      eyebrow="Bracket"
      title="Four rounds to the title"
    />
  {/if}
</section>

<style>
  .postseason {
    --fs-gold: var(--color-accent);
    --fs-panel: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-1));
  }

  .postseason-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 26%, var(--color-line-soft));
    border-radius: 1rem;
    background:
      radial-gradient(
        100% 140% at 0% 0%,
        color-mix(in srgb, var(--color-accent) 13%, transparent),
        transparent 62%
      ),
      linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 78%);
  }

  .postseason-title {
    margin: 0.3rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 3.4vw, 2.35rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.02;
    text-transform: uppercase;
  }

  .postseason-champion-name {
    margin: 0.15rem 0 0;
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 3vw, 2rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.05;
    text-transform: uppercase;
  }

  .seed-pill {
    padding: 0.3rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 42%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .seed-pill[data-tone='muted'] {
    border-color: var(--color-line-soft);
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
  }

  .series-panel {
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--color-line-strong) 80%, transparent);
    border-radius: 1rem;
    background: linear-gradient(180deg, var(--fs-panel), transparent 70%), var(--color-card);
  }

  .series-title {
    margin: 0.2rem 0 0;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.1;
    text-transform: uppercase;
  }

  .series-side {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.85rem;
    background: var(--color-surface-1);
  }

  .series-side-user {
    border-color: color-mix(in srgb, var(--color-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary) 9%, var(--color-surface-1));
  }
</style>
