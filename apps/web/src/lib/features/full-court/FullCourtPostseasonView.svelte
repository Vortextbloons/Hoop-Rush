<script lang="ts">
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
    fullCourtPlayoffStatus,
    fullCourtSeriesGames,
    fullCourtUserSeries,
    type FullCourtAdvanceOptions,
    type FullCourtHomeAction,
    type FullCourtPlayoffView,
    type FullCourtSimulationNotice,
  } from './full-court-season-presenter.js';
  import {
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
  const status = $derived(
    playoff === null ? null : fullCourtPlayoffStatus(playoff, userTeamId, teamName),
  );
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

  const message = $derived.by(() => {
    if (playoff === null) {
      return regularComplete
        ? 'The regular season is complete. Seed the top eight in each conference and play the bracket.'
        : `${String(remaining)} ${remaining === 1 ? 'regular-season game remains' : 'regular-season games remain'} before the top eight in each conference are seeded.`;
    }
    if (championId !== null) return status?.message ?? '';
    if (playoff.userOutcome.status === 'not-qualified') {
      return `You finished ${userRow === null ? 'outside the top eight' : `${String(userRow.seed)} in the ${userRow.conference} conference at ${recordLabel(userRow.wins, userRow.losses)}`}. The bracket finishes without you — sim it to crown a champion.`;
    }
    if (playoff.userOutcome.status === 'eliminated') {
      return `The ${capRushConferenceRoundName(playoff.userOutcome.round ?? 1)} ended your run. The rest of the bracket is finishing without you.`;
    }
    if (!userSeriesActive) {
      return 'Your series is decided. The rest of the round must finish before the next round opens.';
    }
    return 'One game at a time. Your locked lineup, rotation and health carry into every round.';
  });
</script>

<section class="postseason flex flex-col gap-3" aria-label="Full Court postseason">
  <header class="postseason-hero">
    <div class="min-w-0">
      <p class="ui-label">Full Court · Postseason</p>
      <h1 class="postseason-title">{headline}</h1>
      <p class="postseason-message">{message}</p>
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
    <div class="champion-banner trophy-banner" role="status">
      <div class="confetti" aria-hidden="true">
        {#each Array.from({ length: 14 }, (_, index) => index) as piece (piece)}
          <span style="--i:{piece}"></span>
        {/each}
      </div>
      <div class="relative flex items-center gap-4">
        <Trophy size={38} class="shrink-0 text-accent" aria-hidden="true" />
        <div class="min-w-0">
          <p class="ui-label text-accent">Full Court champions</p>
          <h2 class="postseason-champion-name">{userTeamName}</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Four rounds. Four wins each. The championship is yours.
          </p>
        </div>
      </div>
    </div>
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
        <span
          class="inline-flex min-h-11 items-center gap-2 font-mono text-[10px] font-bold text-primary uppercase"
        >
          <span class="live-dot" aria-hidden="true"></span>
          {stopRequested ? 'Saving current game…' : 'Simulating…'}
        </span>
        {#if onStopAfterGame !== undefined}
          <Button size="sm" tone="secondary" disabled={stopRequested} onclick={onStopAfterGame}>
            Stop after this game
          </Button>
        {/if}
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
    <p class="mt-2 text-[11px] text-muted-foreground" role="status">{controls.status}</p>

    {#if simulating}
      <div class="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div class="sim-sweep h-full w-1/3 rounded-full bg-primary"></div>
      </div>
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
      <Alert class="mt-3" tone={notice.tone} title={notice.title}>
        <p>{notice.message}</p>
        {#snippet actions()}
          <Button size="sm" tone="secondary" onclick={() => onDismissNotice?.()}>Dismiss</Button>
        {/snippet}
      </Alert>
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
              <span class="series-wins" data-won={won}>{wins}</span>
              <div class="mt-1 flex justify-center gap-1" aria-hidden="true">
                {#each [0, 1, 2, 3] as pip (pip)}
                  <span class="pip" data-filled={pip < wins}></span>
                {/each}
              </div>
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

      {#if userSeriesActive && userPlayoffAdjustment !== null}
        <div class="adjustment" aria-label="Playoff opponent adjustment">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="ui-label text-muted-foreground">Opponent adjustment</p>
            <Badge tone="accent">{userPlayoffAdjustment.settingLabel}</Badge>
          </div>
          <p class="mt-1 text-[11px] font-bold">{userPlayoffAdjustment.reasonLabel}</p>
          <p class="mt-0.5 text-[11px] text-muted-foreground">
            {userPlayoffAdjustment.detailLabel}
          </p>
        </div>
      {/if}

      {#if userSeriesGames.length > 0}
        <ol class="mt-4 flex flex-col gap-1.5" aria-label="Games in your playoff series">
          {#each [...userSeriesGames].reverse() as game, index (game.gameId)}
            <li class="game-row" data-latest={index === 0}>
              <span class="font-mono text-[9px] font-bold text-muted-foreground uppercase"
                >Game {game.gameOrdinal}</span
              >
              <span class="font-mono text-[10px] text-muted-foreground uppercase">
                {game.userHome ? 'Home' : 'Away'}
              </span>
              <span class="font-display ml-auto text-lg font-extrabold tabular-nums"
                >{game.userPoints}–{game.opponentPoints}</span
              >
              <span class="result-pill" data-won={game.won}>{game.won ? 'Win' : 'Loss'}</span>
              {#if game.opponentAdaptation !== null}
                {@const adjustment = fullCourtPlayoffAdaptationRead(game.opponentAdaptation)}
                <span
                  class="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[8px] font-bold text-accent uppercase"
                  title={`${adjustment.reasonLabel}: ${adjustment.detailLabel}`}
                  aria-label={`Game ${String(game.gameOrdinal)} opponent adjustment: ${adjustment.settingLabel}`}
                  >{adjustment.settingLabel}</span
                >
              {/if}
              {#if game.forfeit}
                <span class="font-mono text-[8px] text-muted-foreground uppercase">Forfeit</span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if latestSeriesGame !== null && opponentId !== null && championId === null}
        <p class="mt-3 text-[11px] text-muted-foreground">
          Latest: Game {latestSeriesGame.gameOrdinal}
          {latestSeriesGame.userHome ? 'at home' : 'on the road'} against {teamName(opponentId)}.
          Series {userSeriesWins}–{opponentWins}.
        </p>
      {/if}
    </section>
  {:else if playoff !== null && championId === null}
    <Panel padding="md" class="border-dashed" aria-label="Postseason status">
      <p class="font-display text-lg font-extrabold uppercase">
        {playoff.userOutcome.status === 'not-qualified'
          ? 'Not in the bracket'
          : 'The bracket moves on'}
      </p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        {playoff.userOutcome.status === 'not-qualified'
          ? 'No series for your five this season. Sim the remaining rounds to crown a champion.'
          : 'Your run is over. Sim the remaining rounds to crown a champion.'}
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

  .postseason-message {
    margin: 0.45rem 0 0;
    max-width: 52ch;
    color: var(--color-muted-foreground);
    font-size: 0.8125rem;
    line-height: 1.6;
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

  .champion-banner {
    position: relative;
    overflow: hidden;
    padding: 1.1rem 1.25rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 50%, transparent);
    border-radius: 1rem;
    background:
      radial-gradient(
        120% 120% at 0% 0%,
        color-mix(in srgb, var(--color-accent) 22%, transparent),
        transparent 66%
      ),
      var(--color-surface-1);
  }

  .adjustment {
    margin-top: 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
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

  .series-wins {
    display: block;
    font-family: var(--font-display);
    font-size: 2.25rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    animation: win-bump 280ms ease-out;
  }

  .series-wins[data-won='true'] {
    color: var(--color-accent);
  }

  .pip {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--color-surface-3);
  }

  .pip[data-filled='true'] {
    background: var(--color-accent);
  }

  .game-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.65rem;
    background: var(--color-surface-1);
  }

  .game-row[data-latest='true'] {
    border-color: color-mix(in srgb, var(--color-accent) 38%, var(--color-line-soft));
    animation: score-in 320ms ease-out both;
  }

  .result-pill {
    padding: 0.05rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-negative) 40%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-negative) 10%, transparent);
    color: var(--color-negative);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .result-pill[data-won='true'] {
    border-color: color-mix(in srgb, var(--color-positive) 40%, transparent);
    background: color-mix(in srgb, var(--color-positive) 10%, transparent);
    color: var(--color-positive);
  }

  .live-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--color-primary);
    animation: live-pulse 1.4s ease-out infinite;
  }

  .sim-sweep {
    animation: sim-sweep 1.15s ease-in-out infinite;
  }

  .confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .confetti span {
    position: absolute;
    top: -10%;
    left: calc((var(--i) + 0.5) * 7%);
    width: 6px;
    height: 10px;
    border-radius: 1px;
    background: var(--fs-gold);
    opacity: 0.8;
    animation: confetti-fall 1600ms ease-in both;
    animation-delay: calc(var(--i) * 35ms);
  }

  .confetti span:nth-child(3n) {
    background: var(--color-primary);
  }

  .confetti span:nth-child(4n) {
    background: var(--color-foreground);
  }

  .trophy-banner {
    animation: trophy-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  @keyframes live-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 55%, transparent);
    }
    70%,
    100% {
      box-shadow: 0 0 0 0.4rem transparent;
    }
  }

  @keyframes sim-sweep {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(300%);
    }
  }

  @keyframes win-bump {
    0% {
      transform: scale(1.3);
      color: var(--fs-gold);
    }
    100% {
      transform: scale(1);
    }
  }

  @keyframes score-in {
    from {
      transform: translateY(4px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes trophy-in {
    from {
      transform: translateY(10px) scale(0.98);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes confetti-fall {
    0% {
      transform: translateY(-20%) rotate(0deg);
      opacity: 0;
    }
    15% {
      opacity: 0.9;
    }
    100% {
      transform: translateY(780%) rotate(540deg);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .series-wins,
    .game-row[data-latest='true'],
    .trophy-banner,
    .sim-sweep,
    .live-dot {
      animation: none;
    }
    .confetti {
      display: none;
    }
  }
</style>
