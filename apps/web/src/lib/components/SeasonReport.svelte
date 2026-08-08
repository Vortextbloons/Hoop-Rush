<script lang="ts">
  import { RotateCcw, Pencil, RefreshCw } from '@lucide/svelte';
  import type {
    ChallengeRun,
    ExplanationFact,
    GameResult,
    HoopRushManifest,
    MadeAttempted,
    PeakPlayerSeason,
    PlayerSeasonAggregate,
    PlayersIndexEntry,
    RunAggregates,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { SandboxHref } from '$lib/sandbox-url';
  import { BEST_OF_ATTEMPTS, explainSeason, leagueMvp, perGamePlayer } from '@hoop-rush/engine';
  import { resolve } from '$app/paths';
  import GameStrip from '$lib/components/GameStrip.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
  import { SLOT_LABELS } from '$lib/player-positions';

  /**
   * Challenge result (spec/08): final record and 82-0 outcome with a League
   * MVP spotlight, the full game strip, aggregate shooting, turnover,
   * rebound, free-throw, and possession facts, and the user's five-player
   * season table. Shared by Sandbox and Classic; the owning route keeps the
   * page header, data loading, and the mode-specific Run again navigation.
   */

  type PeakPlayer = PeakPlayerSeason;

  let {
    manifest,
    run,
    byId,
    indexById,
    modeLabel,
    running,
    onRunAgain,
    onRetrySameTeam = null,
    editTeamHref = null,
  }: {
    manifest: HoopRushManifest | null;
    run: ChallengeRun;
    byId: Map<string, PeakPlayerSeason> | null;
    /** Global players-index entries by playerId, used for MVP headshots. */
    indexById: Map<string, PlayersIndexEntry> | null;
    modeLabel: string;
    running: boolean;
    onRunAgain: () => void;
    /** Sandbox only: simulate the same lineup again with a fresh seed. */
    onRetrySameTeam?: (() => void) | null;
    /** Sandbox only: return to the draft with this lineup pre-filled. */
    editTeamHref?: SandboxHref | null;
  } = $props();

  let totalsMode = $state(false);

  function franchiseLabel(franchiseId: string | null): string {
    return franchiseId ? franchiseAbbreviation(franchiseId) : 'Mixed';
  }

  const era = $derived(manifest?.eras.find((e) => e.eraId === run.eraId) ?? null);

  const aggregates = $derived(run.aggregates ?? null);
  const record = $derived(aggregates?.team ?? null);

  /** League MVP across every home and away appearance of the run's games. */
  const mvp = $derived(run.games.length > 0 ? leagueMvp(run) : null);

  /** Headshot record for the MVP: pool record, then global index, then initials. */
  const mvpFace = $derived.by(() => {
    const current = mvp;
    if (!current) return null;
    const record = byId?.get(current.playerId) ?? indexById?.get(current.playerId);
    if (record) return record;
    return {
      playerId: current.playerId,
      playerExternalId: '',
      altIds: null,
    } satisfies Pick<PeakPlayerSeason, 'playerId' | 'playerExternalId' | 'altIds'>;
  });

  /** The user's five in slot order with their packaged names. */
  const seasonTable = $derived.by(() => {
    if (!byId) {
      return [] as Array<{ player: PeakPlayer; aggregate: PlayerSeasonAggregate }>;
    }
    const playersById = byId;
    return run.players
      .map((snapshot) => {
        const aggregate = run.aggregates.players.find((p) => p.playerId === snapshot.playerId);
        const player = playersById.get(snapshot.playerId);
        if (!aggregate || !player) return null;
        return { player, aggregate };
      })
      .filter(
        (row): row is { player: PeakPlayer; aggregate: PlayerSeasonAggregate } => row !== null,
      );
  });

  const displayAggregates = $derived.by(() => {
    if (!aggregates) return null;
    return {
      team: aggregates.team,
      players: aggregates.players.map((p) => (totalsMode ? p : perGamePlayer(p))),
    } satisfies RunAggregates;
  });

  const gamesPlayed = $derived(Math.max(1, record?.gamesPlayed ?? run.games.length));
  const opponentPoints = $derived(
    run.games.reduce((total, game) => total + game.away.box.points, 0),
  );
  const opponentPointsPerGame = $derived(opponentPoints / gamesPlayed);
  const pointDifferential = $derived((record?.points ?? 0) - opponentPoints);
  const explanation = $derived(explainSeason(run));
  const firstLoss = $derived.by((): { game: GameResult; opponentName: string } | null => {
    const gameNumber = run.firstLossGameNumber;
    if (gameNumber === null) return null;
    const game = run.games.find((candidate) => candidate.gameNumber === gameNumber);
    if (!game) return null;
    const scheduled = run.bracket.schedule[gameNumber - 1];
    const opponent = run.bracket.opponents.find(
      (candidate) => candidate.opponentId === scheduled?.opponentId,
    );
    return { game, opponentName: opponent?.displayName ?? game.away.displayName };
  });

  function teamName(teamId: string, opponentName: string): string {
    return teamId === 'user' ? 'Your five' : opponentName;
  }

  function factCopy(fact: ExplanationFact, opponentName: string, game: GameResult): string {
    const team = teamName(fact.teamId, opponentName);
    const evidence = fact.evidence;
    switch (fact.kind) {
      case 'turnoverMargin':
        return `${team} won the turnover margin ${String(evidence.margin)} (${String(evidence.teamTurnovers)}–${String(evidence.opponentTurnovers)}).`;
      case 'shotEfficiency':
        return `${team} led effective FG% ${(Number(evidence.efgPct) * 100).toFixed(1)}–${(Number(evidence.opponentEfgPct) * 100).toFixed(1)}.`;
      case 'offensiveRebounds':
        return `${team} won offensive rebounds ${String(evidence.teamOffensiveRebounds)}–${String(evidence.opponentOffensiveRebounds)}.`;
      case 'freeThrows':
        return `${team} had ${String(evidence.teamFreeThrowAttempts)} free-throw attempts to ${String(evidence.opponentFreeThrowAttempts)}.`;
      case 'usage': {
        const player = game[fact.teamId === 'user' ? 'home' : 'away'].players.find(
          (candidate) => candidate.playerId === fact.playerIds[0],
        );
        const playerName = seasonTable.find((row) => row.aggregate.playerId === player?.playerId)
          ?.player.displayName;
        // Usage is the recorded diagnostic FGA + 0.44*FTA + TOV, not points.
        return player
          ? `${playerName ?? player.playerId} consumed ${Math.round(Number(evidence.usageShare) * 100)}% of ${team}'s estimated usage (${String(evidence.playerUsage)} of ${String(evidence.teamUsage)}).`
          : `${team} concentrated ${Math.round(Number(evidence.usageShare) * 100)}% of estimated usage in one player.`;
      }
      case 'overtime':
        return `${team} won the overtime period ${String(evidence.homeOvertimePoints)}–${String(evidence.awayOvertimePoints)}.`;
    }
  }

  function pct(made: number, attempted: number): string {
    return attempted === 0 ? '—' : `${((made / attempted) * 100).toFixed(1)}%`;
  }

  const netRatingLabel = $derived(
    explanation.netRatingPer100 >= 0
      ? `+${explanation.netRatingPer100.toFixed(1)}`
      : explanation.netRatingPer100.toFixed(1),
  );

  const usageLeaderName = $derived.by(() => {
    const leader = explanation.usageLeader;
    if (!leader) return '';
    const row = seasonTable.find((candidate) => candidate.aggregate.playerId === leader.playerId);
    return row?.player.displayName ?? leader.playerId;
  });

  const ZONE_NAMES: Readonly<Record<string, { label: string; noun: string }>> = {
    rim: { label: 'at the rim', noun: 'rim' },
    shortMid: { label: 'from short mid-range', noun: 'short mid-range' },
    longMid: { label: 'from long mid-range', noun: 'long mid-range' },
    cornerThree: { label: 'from the corner three', noun: 'corner-three' },
    aboveBreakThree: { label: 'from above the break', noun: 'above-the-break three' },
  };

  function zoneName(zone: string): string {
    return ZONE_NAMES[zone]?.label ?? 'by shot zone';
  }

  function zoneNoun(zone: string): string {
    return ZONE_NAMES[zone]?.noun ?? 'shot';
  }

  function zonePctLabel(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
  }

  /** True shooting percentage from exact season totals: PTS / (2*(FGA + 0.44*FTA)). */
  function trueShootingPct(points: number, fga: number, fta: number): string {
    const denominator = 2 * (fga + 0.44 * fta);
    return denominator <= 0 ? '—' : `${((points / denominator) * 100).toFixed(1)}%`;
  }

  /** Usage percentage: the player's possession estimate share of the team's. */
  function usagePct(raw: PlayerSeasonAggregate, team: RunAggregates['team']): string {
    const possessionEstimate = (p: {
      fieldGoals: MadeAttempted;
      freeThrows: MadeAttempted;
      turnovers: number;
    }) => p.fieldGoals.attempted + 0.44 * p.freeThrows.attempted + p.turnovers;
    const player = possessionEstimate(raw);
    const teamTotal = possessionEstimate(team);
    if (teamTotal <= 0) return '—';
    return `${((player / teamTotal) * 100).toFixed(1)}%`;
  }

  function perGameValue(value: number, games: number, decimals = 1): string {
    return (value / Math.max(1, games)).toFixed(decimals);
  }

  function formatAggregateStat(value: number): string {
    return totalsMode ? String(value) : value.toFixed(1);
  }

  function toggleMode() {
    totalsMode = !totalsMode;
  }
</script>

<!-- Final record and League MVP -->
<div
  class="mt-8 rounded-2xl border border-line-strong bg-card p-6 shadow-[0_0_24px_hsl(13_100%_62%/0.12)] sm:p-8"
  title={modeLabel}
>
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">{modeLabel}</p>
  <div class="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    <div class="min-w-0 flex-1">
      {#if mvp}
        <section aria-labelledby="mvp-heading">
          <div class="flex items-center gap-2">
            <h2
              id="mvp-heading"
              class="font-mono text-[10px] tracking-[0.16em] text-accent uppercase"
            >
              League MVP
            </h2>
            <span
              class="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {mvp.isUserTeam
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-surface-3 text-muted-foreground'}"
            >
              {mvp.isUserTeam ? 'Your five' : 'Opponent'}
            </span>
          </div>
          <div class="mt-3 flex items-center gap-3">
            {#if mvpFace}
              <PlayerFace
                player={mvpFace}
                manifest={manifest!}
                size="md"
                fallbackInitials={mvp.playerName.slice(0, 2).toUpperCase()}
              />
            {/if}
            <div class="min-w-0">
              <p class="font-display truncate text-xl font-extrabold tracking-tight uppercase">
                {mvp.playerName}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {mvp.teamName} · {mvp.appearances} games
              </p>
            </div>
          </div>
          <dl class="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">MVP score</dt>
              <dd class="font-bold text-foreground">{mvp.mvpScore.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">PTS</dt>
              <dd class="font-bold text-foreground">{mvp.averagePoints.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">TS%</dt>
              <dd class="font-bold text-foreground">{(mvp.averageEfficiency * 100).toFixed(1)}%</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">REB</dt>
              <dd class="font-bold text-foreground">{mvp.averageRebounds.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">AST</dt>
              <dd class="font-bold text-foreground">{mvp.averageAssists.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">STL</dt>
              <dd class="font-bold text-foreground">{mvp.averageSteals.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">BLK</dt>
              <dd class="font-bold text-foreground">{mvp.averageBlocks.toFixed(1)}</dd>
            </div>
            <div>
              <dt class="text-[9px] tracking-[0.14em] uppercase">Consistency</dt>
              <dd class="font-bold text-foreground">{mvp.consistency.toFixed(1)}</dd>
            </div>
          </dl>
        </section>
      {/if}
    </div>
    <div class="shrink-0 text-center sm:text-right">
      <p class="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
        {record!.wins}<span class="text-muted-foreground">–</span>{record!.losses}
      </p>
      <SeasonTierBadge wins={record!.wins} size="large" />
      <p class="mt-2 font-mono text-[10px] text-muted-foreground">
        {franchiseLabel(run.franchiseId)} · {era?.label ?? run.eraId} · five players, no bench
      </p>
    </div>
  </div>

  <!-- The full 82-game strip -->
  <div class="mt-6 rounded-xl border border-border bg-surface-1 p-3 sm:p-4">
    <GameStrip {run} games={run.games} compact />
  </div>

  <section
    aria-labelledby="season-snapshot-heading"
    class="mt-5 rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id="season-snapshot-heading"
        class="font-display text-xl font-extrabold tracking-tight uppercase"
      >
        Season snapshot
      </h2>
      <span class="font-mono text-[10px] text-muted-foreground"
        >Recorded over {gamesPlayed} games</span
      >
    </div>
    <dl class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div class="rounded-lg border border-border bg-card p-3">
        <dt class="font-mono text-[10px] text-muted-foreground uppercase">Your PPG</dt>
        <dd class="mt-1 font-display text-xl font-extrabold">
          {perGameValue(record!.points, gamesPlayed)}
        </dd>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <dt class="font-mono text-[10px] text-muted-foreground uppercase">Opponent PPG</dt>
        <dd class="mt-1 font-display text-xl font-extrabold">{opponentPointsPerGame.toFixed(1)}</dd>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <dt class="font-mono text-[10px] text-muted-foreground uppercase">Point diff</dt>
        <dd class="mt-1 font-display text-xl font-extrabold">
          {pointDifferential >= 0 ? '+' : ''}{perGameValue(pointDifferential, gamesPlayed)}
        </dd>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <dt class="font-mono text-[10px] text-muted-foreground uppercase">Pace</dt>
        <dd class="mt-1 font-display text-xl font-extrabold">
          {perGameValue(record!.possessions, gamesPlayed)}
        </dd>
      </div>
      <div class="rounded-lg border border-border bg-card p-3">
        <dt class="font-mono text-[10px] text-muted-foreground uppercase">Rebounds/G</dt>
        <dd class="mt-1 font-display text-xl font-extrabold">
          {perGameValue(record!.rebounds.total, gamesPlayed)}
        </dd>
      </div>
    </dl>
    <div class="mt-3 grid gap-2 font-mono text-xs sm:grid-cols-4">
      <p>
        <span class="text-muted-foreground">FG</span>
        {pct(record!.fieldGoals.made, record!.fieldGoals.attempted)}
      </p>
      <p>
        <span class="text-muted-foreground">3P</span>
        {pct(record!.threes.made, record!.threes.attempted)}
      </p>
      <p>
        <span class="text-muted-foreground">FT</span>
        {pct(record!.freeThrows.made, record!.freeThrows.attempted)}
      </p>
      <p>
        <span class="text-muted-foreground">TOV/G</span>
        {perGameValue(record!.turnovers, gamesPlayed)}
      </p>
    </div>
  </section>

  {#if firstLoss}
    <section
      aria-labelledby="first-loss-heading"
      class="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="first-loss-heading"
          class="font-display text-xl font-extrabold tracking-tight uppercase"
        >
          First loss
        </h2>
        <span class="font-mono text-[10px] text-muted-foreground"
          >Game {firstLoss.game.gameNumber}</span
        >
      </div>
      <p class="mt-2 text-sm font-semibold">
        {firstLoss.opponentName} won {firstLoss.game.away.box.points}–{firstLoss.game.home.box
          .points}.
      </p>
      {#if firstLoss.game.facts.length > 0}
        <ul class="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          {#each firstLoss.game.facts as fact (fact.kind)}
            <li class="rounded-lg border border-border bg-card p-3">
              {factCopy(fact, firstLoss.opponentName, firstLoss.game)}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="mt-3 text-xs text-muted-foreground">
          No thresholded deciding factor was recorded for this game.
        </p>
      {/if}
    </section>
  {/if}

  <div class="mt-5 flex flex-wrap items-center gap-2">
    {#if onRetrySameTeam}
      <button
        type="button"
        onclick={onRetrySameTeam}
        disabled={running || byId === null}
        class="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:border-primary/60 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <RefreshCw class="h-4 w-4" />
        Retry with same team
      </button>
    {/if}
    <button
      type="button"
      onclick={onRunAgain}
      disabled={running}
      class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <RotateCcw class="h-4 w-4" />
      Run again
    </button>
    {#if editTeamHref}
      <a
        href={resolve(editTeamHref)}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil class="h-4 w-4" />
        Edit team
      </a>
    {/if}
    <span class="ml-auto font-mono text-[10px] text-muted-foreground">
      seed {run.runSeed} · best of {BEST_OF_ATTEMPTS} · engine {run.versions.engineVersion} · bracket
      {run.versions.bracketVersion} · schedule {run.versions.scheduleVersion}
    </span>
  </div>
</div>

<!-- How the five won: thresholded comparisons of recorded season data -->
<section aria-labelledby="how-won-heading" class="mt-6 rounded-xl border border-border bg-card p-5">
  <h2 id="how-won-heading" class="font-display text-xl font-extrabold tracking-tight uppercase">
    How your five won
  </h2>
  <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
    <li class="rounded-lg border border-border bg-surface-1 p-3">
      <span class="font-semibold">{explanation.turnoverBattleWins} of {run.games.length} games</span
      >
      <span class="text-muted-foreground">
        &nbsp;you won the turnover battle{explanation.turnoverBattleLosses > 0
          ? ` (${explanation.turnoverBattleLosses} went the other way)`
          : ''}.
      </span>
    </li>
    <li class="rounded-lg border border-border bg-surface-1 p-3">
      <span class="font-semibold">{netRatingLabel}</span>
      <span class="text-muted-foreground"> net points per 100 possessions.</span>
    </li>
    {#if explanation.zoneAdvantage}
      <li class="rounded-lg border border-border bg-surface-1 p-3">
        <span class="font-semibold"
          >Your advantage came primarily {zoneName(explanation.zoneAdvantage.zone)}.</span
        >
        <span class="text-muted-foreground">
          &nbsp;You shot {zonePctLabel(explanation.zoneAdvantage.pct)} to your opponents'
          {zonePctLabel(explanation.zoneAdvantage.opponentPct)} on {explanation.zoneAdvantage.attempts.toLocaleString()}
          {zoneNoun(explanation.zoneAdvantage.zone)} attempts.
        </span>
      </li>
    {/if}
    {#if explanation.opponentOffensiveReboundRate >= 0.3}
      <li class="rounded-lg border border-border bg-surface-1 p-3">
        <span class="font-semibold">This lineup was weak on the defensive glass.</span>
        <span class="text-muted-foreground">
          &nbsp;Opponents grabbed {(explanation.opponentOffensiveReboundRate * 100).toFixed(1)}% of
          their own misses.
        </span>
      </li>
    {/if}
    {#if explanation.usageLeader}
      <li class="rounded-lg border border-border bg-surface-1 p-3">
        <span class="font-semibold">{usageLeaderName}</span>
        <span class="text-muted-foreground">
          &nbsp;consumed {(explanation.usageLeader.usageShare * 100).toFixed(0)}% of estimated
          usage.
        </span>
      </li>
    {/if}
  </ul>
  <p class="mt-3 font-mono text-[10px] text-muted-foreground">
    Turnovers, possessions, zone splits, rebounds, and usage come from recorded game diagnostics;
    usage is FGA + 0.44 × FTA + turnovers.
  </p>
</section>

<!-- Five-player season table directly below the record -->
<section
  aria-labelledby="season-table-heading"
  class="mt-6 rounded-xl border border-border bg-card p-5"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2
      id="season-table-heading"
      class="font-display text-xl font-extrabold tracking-tight uppercase"
    >
      Your five · season
    </h2>
    <div class="flex rounded-lg border border-border p-0.5" role="group" aria-label="Season values">
      <button
        type="button"
        aria-pressed={!totalsMode}
        onclick={toggleMode}
        class="rounded-md px-3 py-1 font-mono text-xs font-semibold {!totalsMode
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground'}"
      >
        Per game
      </button>
      <button
        type="button"
        aria-pressed={totalsMode}
        onclick={toggleMode}
        class="rounded-md px-3 py-1 font-mono text-xs font-semibold {totalsMode
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground'}"
      >
        Totals
      </button>
    </div>
  </div>
  {#if displayAggregates}
    <div class="mt-4 hidden overflow-x-auto sm:block">
      <table class="w-full min-w-[1080px] border-collapse text-sm">
        <thead>
          <tr
            class="border-b border-border font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
          >
            <th scope="col" class="py-2 pr-3 text-left">Player</th>
            <th scope="col" class="px-2 py-2 text-right">PTS</th>
            <th scope="col" class="px-2 py-2 text-right">FGA</th>
            <th scope="col" class="px-2 py-2 text-right">FG%</th>
            <th scope="col" class="px-2 py-2 text-right">3PA</th>
            <th scope="col" class="px-2 py-2 text-right">3P%</th>
            <th scope="col" class="px-2 py-2 text-right">FTA</th>
            <th scope="col" class="px-2 py-2 text-right">FT%</th>
            <th scope="col" class="px-2 py-2 text-right">TS%</th>
            <th scope="col" class="px-2 py-2 text-right">USG%</th>
            <th scope="col" class="px-2 py-2 text-right">REB</th>
            <th scope="col" class="px-2 py-2 text-right">AST</th>
            <th scope="col" class="px-2 py-2 text-right">STL</th>
            <th scope="col" class="px-2 py-2 text-right">BLK</th>
            <th scope="col" class="px-2 py-2 text-right">TOV</th>
            <th scope="col" class="px-2 py-2 text-right">3PA/G</th>
          </tr>
        </thead>
        <tbody>
          {#each displayAggregates.players as aggregate, index (aggregate.playerId)}
            {@const row = seasonTable[index]}
            {@const raw = aggregates!.players.find((p) => p.playerId === aggregate.playerId)!}
            <tr class="border-b border-border/50 last:border-0">
              <th scope="row" class="py-2 pr-3 text-left">
                <span class="flex items-center gap-2">
                  {#if row}
                    <PlayerFace
                      player={row.player}
                      manifest={manifest!}
                      size="sm"
                      fallbackInitials={row.player.firstName[0]! + row.player.lastName[0]!}
                    />
                    <span class="min-w-0">
                      <span class="block truncate font-semibold">
                        {row.player.displayName}
                      </span>
                      <span class="block font-mono text-[10px] text-muted-foreground">
                        {SLOT_LABELS[index]}
                      </span>
                    </span>
                  {:else}
                    <span class="font-mono text-xs">{aggregate.playerId}</span>
                  {/if}
                </span>
              </th>
              <td class="px-2 py-2 text-right font-mono font-bold">
                {formatAggregateStat(aggregate.points)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.fieldGoals.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {pct(raw.fieldGoals.made, raw.fieldGoals.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.threes.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {pct(raw.threes.made, raw.threes.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.freeThrows.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {pct(raw.freeThrows.made, raw.freeThrows.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {trueShootingPct(raw.points, raw.fieldGoals.attempted, raw.freeThrows.attempted)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {usagePct(raw, aggregates!.team)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.rebounds.total)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.assists)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.steals)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.blocks)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {formatAggregateStat(aggregate.turnovers)}
              </td>
              <td class="px-2 py-2 text-right font-mono">
                {perGameValue(raw.threes.attempted, raw.gamesPlayed)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-4 grid gap-2 sm:hidden">
      {#each displayAggregates.players as aggregate, index (aggregate.playerId)}
        {@const row = seasonTable[index]}
        {@const raw = aggregates!.players.find((p) => p.playerId === aggregate.playerId)!}
        <article class="rounded-lg border border-border bg-surface-1 p-3">
          <div class="flex items-start gap-3">
            {#if row}
              <PlayerFace
                player={row.player}
                manifest={manifest!}
                size="sm"
                fallbackInitials={row.player.firstName[0]! + row.player.lastName[0]!}
              />
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-bold">
                    {row?.player.displayName ?? aggregate.playerId}
                  </p>
                  <p class="font-mono text-[10px] text-muted-foreground">
                    {SLOT_LABELS[index]} · {aggregate.gamesPlayed} games
                  </p>
                </div>
                <p class="shrink-0 font-mono text-sm font-bold tabular-nums">
                  {formatAggregateStat(aggregate.points)} PTS
                </p>
              </div>
            </div>
          </div>
          <table class="mt-3 w-full text-xs">
            <tbody class="font-mono tabular-nums">
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">FGA</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.fieldGoals.attempted)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">FG%</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {pct(raw.fieldGoals.made, raw.fieldGoals.attempted)}
                </td>
              </tr>
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">3PA</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.threes.attempted)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">3P%</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {pct(raw.threes.made, raw.threes.attempted)}
                </td>
              </tr>
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">FTA</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.freeThrows.attempted)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">FT%</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {pct(raw.freeThrows.made, raw.freeThrows.attempted)}
                </td>
              </tr>
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">TS%</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {trueShootingPct(raw.points, raw.fieldGoals.attempted, raw.freeThrows.attempted)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">USG%</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {usagePct(raw, aggregates!.team)}
                </td>
              </tr>
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">REB</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.rebounds.total)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">AST</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.assists)}
                </td>
              </tr>
              <tr class="border-b border-border/40">
                <td class="py-1.5 pr-2 text-muted-foreground">STL</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.steals)}
                </td>
                <td class="py-1.5 pr-2 pl-3 text-muted-foreground">BLK</td>
                <td class="py-1.5 text-right font-semibold text-foreground">
                  {formatAggregateStat(aggregate.blocks)}
                </td>
              </tr>
              <tr>
                <td class="py-1.5 pr-2 text-muted-foreground">TOV</td>
                <td class="py-1.5 text-right font-semibold text-foreground" colspan="3">
                  {formatAggregateStat(aggregate.turnovers)}
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      {/each}
    </div>
    {#if byId === null}
      <p class="mt-3 animate-pulse text-sm text-muted-foreground">Loading player details…</p>
    {/if}
  {:else}
    <p class="mt-4 animate-pulse text-sm text-muted-foreground">Loading season table…</p>
  {/if}
</section>

<!-- Aggregate facts -->
<div class="mt-6">
  <section aria-labelledby="facts-heading" class="rounded-xl border border-border bg-card p-5">
    <h2 id="facts-heading" class="font-display text-xl font-extrabold tracking-tight uppercase">
      Season facts
    </h2>
    <dl class="mt-4 flex flex-col gap-3 text-sm">
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Field goal
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {pct(record!.fieldGoals.made, record!.fieldGoals.attempted)} · {record!.fieldGoals.made}/
          {record!.fieldGoals.attempted}
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Three-point
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {pct(record!.threes.made, record!.threes.attempted)} · {record!.threes.made}/
          {record!.threes.attempted}
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Free throws
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {pct(record!.freeThrows.made, record!.freeThrows.attempted)} · {record!.freeThrows.made}/
          {record!.freeThrows.attempted}
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Turnovers
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {perGameValue(record!.turnovers, record!.gamesPlayed)} per game · {record!.turnovers} total
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Rebounds
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          <span class="block sm:inline"
            >{perGameValue(record!.rebounds.total, record!.gamesPlayed)} per game</span
          >
          <span class="block text-muted-foreground sm:inline">
            <span class="hidden sm:inline"> · </span>
            {record!.rebounds.offensive} offensive · {record!.rebounds.defensive} defensive
          </span>
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Assists
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {perGameValue(record!.assists, record!.gamesPlayed)} per game · {record!.assists} total
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <dt
          class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
        >
          Possessions
        </dt>
        <dd class="min-w-0 font-mono sm:text-right">
          {perGameValue(record!.possessions, record!.gamesPlayed)} per game · {record!.possessions} total
        </dd>
      </div>
    </dl>
  </section>
</div>
