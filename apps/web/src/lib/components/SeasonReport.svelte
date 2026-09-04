<script lang="ts">import { ArrowRight, Calendar, ChevronDown, Gamepad2, Pencil, RefreshCw, RotateCcw, ShieldCheck, Trophy, } from '@lucide/svelte';
import type { ChallengeRun, ExplanationFact, GameResult, HoopRushManifest, MadeAttempted, PeakPlayerSeason, PlayerSeasonAggregate, PlayersIndexEntry, RunAggregates, } from '@hoop-rush/data-contracts';
import { franchiseAbbreviation, playerIdSchema } from '@hoop-rush/data-contracts';
import type { SandboxHref } from '$lib/sandbox-url';
import { explainSeason, leagueMvp, perGamePlayer } from '@hoop-rush/engine';
import { resolve } from '$app/paths';
import GameStrip from '$lib/components/GameStrip.svelte';
import PlayerFace from '$lib/components/PlayerFace.svelte';
import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
import { oneDecimal, percentOneDecimal } from '$lib/format';
import { SLOT_LABELS } from '$lib/player-positions';
type PeakPlayer = PeakPlayerSeason;
let { manifest, run, byId, indexById, modeLabel, running, onRunAgain, onRetrySameTeam = null, editTeamHref = null, }: {
    manifest: HoopRushManifest | null;
    run: ChallengeRun;
    byId: Map<string, PeakPlayerSeason> | null;
    indexById: Map<string, PlayersIndexEntry> | null;
    modeLabel: string;
    running: boolean;
    onRunAgain: () => void;
    onRetrySameTeam?: (() => void) | null;
    editTeamHref?: SandboxHref | null;
} = $props();
let totalsMode = $state(false);
let tab = $state<'overview' | 'games' | 'players' | 'team'>('overview');
function franchiseLabel(franchiseId: string | null): string {
    return franchiseId ? franchiseAbbreviation(franchiseId) : 'Mixed';
}
const era = $derived(manifest?.eras.find((e) => e.eraId === run.eraId) ?? null);
const aggregates = $derived(run.aggregates ?? null);
const record = $derived(aggregates?.team ?? null);
const mvp = $derived(run.games.length > 0 ? leagueMvp(run) : null);
const mvpFace = $derived.by(() => {
    const current = mvp;
    if (!current)
        return null;
    const record = byId?.get(current.playerId) ?? indexById?.get(current.playerId);
    if (record)
        return record;
    return {
        playerId: playerIdSchema.parse(current.playerId),
        playerExternalId: '',
        altIds: null,
    } satisfies Pick<PeakPlayerSeason, 'playerId' | 'playerExternalId' | 'altIds'>;
});
const seasonTable = $derived.by(() => {
    if (!byId) {
        return [] as Array<{
            player: PeakPlayer;
            aggregate: PlayerSeasonAggregate;
        }>;
    }
    const playersById = byId;
    return run.players
        .map((snapshot) => {
        const aggregate = run.aggregates.players.find((p) => p.playerId === snapshot.playerId);
        const player = playersById.get(snapshot.playerId);
        if (!aggregate || !player)
            return null;
        return { player, aggregate };
    })
        .filter((row): row is {
        player: PeakPlayer;
        aggregate: PlayerSeasonAggregate;
    } => row !== null);
});
const displayAggregates = $derived.by(() => {
    if (!aggregates)
        return null;
    return {
        team: aggregates.team,
        players: aggregates.players.map((p) => (totalsMode ? p : perGamePlayer(p))),
    } satisfies RunAggregates;
});
const gamesPlayed = $derived(Math.max(1, record?.gamesPlayed ?? run.games.length));
const opponentPoints = $derived(run.games.reduce((total, game) => total + game.away.box.points, 0));
const opponentPointsPerGame = $derived(opponentPoints / gamesPlayed);
const pointDifferential = $derived((record?.points ?? 0) - opponentPoints);
const opponentTotals = $derived.by(() => {
    let points = 0;
    let fgm = 0;
    let fga = 0;
    let tpm = 0;
    let tpa = 0;
    let reb = 0;
    let tov = 0;
    for (const game of run.games) {
        const box = game.away.box;
        points += box.points;
        fgm += box.fieldGoals.made;
        fga += box.fieldGoals.attempted;
        tpm += box.threes.made;
        tpa += box.threes.attempted;
        reb += box.rebounds.total;
        tov += box.turnovers;
    }
    return { points, fgm, fga, tpm, tpa, reb, tov };
});
const lastGames = $derived(run.games.slice(-4));
const heroNote = $derived(run.outcome === 'perfect'
    ? 'Perfect season'
    : run.firstLossGameNumber !== null
        ? `First loss · game ${run.firstLossGameNumber}`
        : `after ${gamesPlayed} game${gamesPlayed === 1 ? '' : 's'}`);
const explanation = $derived(explainSeason(run));
const firstLoss = $derived.by((): {
    game: GameResult;
    opponentName: string;
} | null => {
    const gameNumber = run.firstLossGameNumber;
    if (gameNumber === null)
        return null;
    const game = run.games.find((candidate) => candidate.gameNumber === gameNumber);
    if (!game)
        return null;
    const scheduled = run.bracket.schedule[gameNumber - 1];
    const opponent = run.bracket.opponents.find((candidate) => candidate.opponentId === scheduled?.opponentId);
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
            return `${team} led effective FG% ${percentOneDecimal(Number(evidence.efgPct))}–${percentOneDecimal(Number(evidence.opponentEfgPct))}.`;
        case 'offensiveRebounds':
            return `${team} won offensive rebounds ${String(evidence.teamOffensiveRebounds)}–${String(evidence.opponentOffensiveRebounds)}.`;
        case 'freeThrows':
            return `${team} had ${String(evidence.teamFreeThrowAttempts)} free-throw attempts to ${String(evidence.opponentFreeThrowAttempts)}.`;
        case 'usage': {
            const player = game[fact.teamId === 'user' ? 'home' : 'away'].players.find((candidate) => candidate.playerId === fact.playerIds[0]);
            const playerName = seasonTable.find((row) => row.aggregate.playerId === player?.playerId)
                ?.player.displayName;
            return player
                ? `${playerName ?? player.playerId} consumed ${Math.round(Number(evidence.usageShare) * 100)}% of ${team}'s estimated usage (${String(evidence.playerUsage)} of ${String(evidence.teamUsage)}).`
                : `${team} concentrated ${Math.round(Number(evidence.usageShare) * 100)}% of estimated usage in one player.`;
        }
        case 'overtime':
            return `${team} won the overtime period ${String(evidence.homeOvertimePoints)}–${String(evidence.awayOvertimePoints)}.`;
    }
}
function pct(made: number, attempted: number): string {
    return attempted === 0 ? '—' : percentOneDecimal(made / attempted);
}
const netRatingLabel = $derived(explanation.netRatingPer100 >= 0
    ? `+${oneDecimal(explanation.netRatingPer100)}`
    : oneDecimal(explanation.netRatingPer100));
const usageLeaderName = $derived.by(() => {
    const leader = explanation.usageLeader;
    if (!leader)
        return '';
    const row = seasonTable.find((candidate) => candidate.aggregate.playerId === leader.playerId);
    return row?.player.displayName ?? leader.playerId;
});
const ZONE_NAMES: Readonly<Record<string, {
    label: string;
    noun: string;
}>> = {
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
    return percentOneDecimal(rate);
}
function trueShootingPct(points: number, fga: number, fta: number): string {
    const denominator = 2 * (fga + 0.44 * fta);
    return denominator <= 0 ? '—' : percentOneDecimal(points / denominator);
}
function usagePct(raw: PlayerSeasonAggregate, team: RunAggregates['team']): string {
    const possessionEstimate = (p: {
        fieldGoals: MadeAttempted;
        freeThrows: MadeAttempted;
        turnovers: number;
    }) => p.fieldGoals.attempted + 0.44 * p.freeThrows.attempted + p.turnovers;
    const player = possessionEstimate(raw);
    const teamTotal = possessionEstimate(team);
    if (teamTotal <= 0)
        return '—';
    return percentOneDecimal(player / teamTotal);
}
function perGameValue(value: number, games: number, decimals = 1): string {
    return (value / Math.max(1, games)).toFixed(decimals);
}
function formatAggregateStat(value: number): string {
    return totalsMode ? String(value) : oneDecimal(value);
}
function toggleMode() {
    totalsMode = !totalsMode;
}
function viewSeasonStats() {
    tab = 'team';
    document.getElementById('season-report-tabs')?.scrollIntoView({ behavior: 'smooth' });
}
</script>

<div
  class="mt-8 rounded-2xl border border-primary/25 bg-card shadow-[0_0_40px_hsl(13_100%_62%/0.12)]"
  title={modeLabel}
>
  <div class="border-b border-border/60 px-4 py-6 text-center sm:px-8 sm:py-8">
    <p class="font-mono text-[11px] tracking-[0.18em] text-primary uppercase">Season complete</p>
    {#if record}
      <p
        class="font-display mt-3 text-5xl font-extrabold tracking-tight tabular-nums sm:text-6xl"
        aria-label={`Final record ${record.wins} wins and ${record.losses} losses`}
      >
        {record.wins}<span class="mx-2 text-muted-foreground">–</span>{record.losses}
      </p>
      <div class="mt-2 flex justify-center">
        <SeasonTierBadge wins={record.wins} size="large" />
      </div>
    {/if}
    <p class="mt-2 font-mono text-[11px] tracking-[0.3em] text-muted-foreground uppercase">
      {heroNote}
    </p>
    <p class="mt-1 font-mono text-[11px] text-muted-foreground">
      {modeLabel} · {franchiseLabel(run.franchiseId)} · {era?.label ?? run.eraId}
    </p>
  </div>

  {#if lastGames.length > 0}
    <div class="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4 sm:px-6" aria-label="Closing games">
      {#each lastGames as game (game.gameNumber)}
        {@const won = game.winner === 'home'}
        <div class="rounded-xl border border-primary/25 bg-surface-1 p-3 text-center sm:p-4">
          <div class="flex items-center justify-between">
            <span class="font-mono text-[11px] text-muted-foreground">G{game.gameNumber}</span>
            <span
              class="font-mono text-[11px] font-bold tracking-widest uppercase {won
                ? 'text-positive'
                : 'text-primary'}">{won ? 'Win' : 'Loss'}</span
            >
          </div>
          <p class="font-display mt-2 text-2xl font-extrabold tabular-nums">
            {game.home.box.points} <span class="text-muted-foreground">-</span>
            {game.away.box.points}
          </p>
          <p class="mt-1 font-mono text-[10px] text-muted-foreground uppercase">You · Opp</p>
          <p class="font-mono text-[10px] text-muted-foreground">Final</p>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-center sm:px-6">
    <button
      type="button"
      onclick={onRunAgain}
      disabled={running}
      class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold tracking-widest uppercase text-primary-foreground disabled:opacity-50"
    >
      <RotateCcw class="h-4 w-4" />
      Run again
    </button>
    {#if onRetrySameTeam}
      <button
        type="button"
        onclick={onRetrySameTeam}
        disabled={running || byId === null}
        class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line-soft bg-surface-1 px-6 py-3 text-sm font-bold tracking-widest uppercase disabled:opacity-50"
      >
        <RefreshCw class="h-4 w-4" />
        Retry same team
      </button>
    {/if}
    <button
      type="button"
      onclick={viewSeasonStats}
      class="inline-flex items-center justify-center gap-1.5 px-4 py-3 font-mono text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-foreground sm:ml-auto"
    >
      View season stats <ArrowRight class="h-4 w-4" />
    </button>
  </div>
  {#if editTeamHref}
    <div class="px-4 pb-4 sm:px-6 sm:pb-0">
      <a
        href={resolve(editTeamHref)}
        class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pencil class="h-4 w-4" />
        Edit team
      </a>
    </div>
  {/if}

  <div
    id="season-report-tabs"
    class="flex gap-6 overflow-x-auto border-y border-border/60 px-4 sm:px-6"
    role="tablist"
    aria-label="Season sections"
  >
    {#each [['overview', 'Overview'], ['games', 'Games'], ['players', 'Players'], ['team', 'Team stats']] as [id, label] (id)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === id}
        onclick={() => (tab = id as typeof tab)}
        class="border-b-2 py-3 font-mono text-xs font-bold tracking-widest uppercase {tab === id
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
      >
        {label}
      </button>
    {/each}
  </div>

  {#if tab === 'overview'}
    <div class="p-4 sm:p-6">
      <section aria-label="Your five" class="rounded-xl border border-line-soft bg-surface-1 p-4">
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Your five
        </h3>
        {#if seasonTable.length > 0}
          <ul class="mt-2 flex flex-col divide-y divide-border/60">
            {#each seasonTable as row, index (row.aggregate.playerId)}
              <li class="flex min-w-0 items-center gap-3 py-2.5">
                {#if manifest}
                  <PlayerFace
                    player={row.player}
                    {manifest}
                    size="sm"
                    fallbackInitials={row.player.firstName[0]! + row.player.lastName[0]!}
                  />
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-bold">{row.player.displayName}</span>
                  <span class="block truncate font-mono text-[10px] text-muted-foreground">
                    {SLOT_LABELS[index] ?? `Slot ${index + 1}`} · {row.aggregate.gamesPlayed} games
                  </span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <span class="font-mono text-sm font-bold tabular-nums">
                    {perGameValue(row.aggregate.points, row.aggregate.gamesPlayed)}
                    <span class="text-[10px] font-normal text-muted-foreground">PPG</span>
                  </span>
                  <span class="flex items-end gap-[2px]" aria-hidden="true">
                    <span
                      class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                      style="height: 5px"
                    ></span>
                    <span
                      class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                      style="height: 8px"
                    ></span>
                    <span
                      class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                      style="height: 11px"
                    ></span>
                    <span
                      class="inline-block w-[3px] rounded-sm bg-muted-foreground/60"
                      style="height: 14px"
                    ></span>
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-3 animate-pulse text-sm text-muted-foreground">Loading player details…</p>
        {/if}
      </section>
    </div>

    <div class="grid gap-4 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-3">
      <section
        aria-label="League MVP"
        class="rounded-xl border border-line-soft bg-surface-1 p-4 text-center"
      >
        <h3
          class="text-left font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase"
        >
          League MVP
        </h3>
        {#if mvp}
          <div class="mt-2 flex items-center justify-center gap-2">
            <span
              class="rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {mvp.isUserTeam
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-surface-3 text-muted-foreground'}"
            >
              {mvp.isUserTeam ? 'Your five' : 'Opponent'}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-center">
            {#if mvpFace && manifest}
              <PlayerFace
                player={mvpFace}
                {manifest}
                size="md"
                fallbackInitials={mvp.playerName.slice(0, 2).toUpperCase()}
              />
            {/if}
          </div>
          <p class="font-display mt-2 text-xl font-extrabold">{mvp.playerName}</p>
          <p class="font-mono text-[11px] text-muted-foreground">
            {mvp.teamName} · {mvp.appearances} games
          </p>
          <div class="mt-3 grid grid-cols-3 divide-x divide-border/60">
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {oneDecimal(mvp.averagePoints)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">PPG</p>
            </div>
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {oneDecimal(mvp.averageRebounds)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">REB</p>
            </div>
            <div>
              <p class="font-display text-2xl font-extrabold text-primary tabular-nums">
                {oneDecimal(mvp.averageAssists)}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">AST</p>
            </div>
          </div>
        {:else}
          <p class="mt-3 text-sm text-muted-foreground">No games recorded yet.</p>
        {/if}
      </section>

      <section
        aria-label="Season comparison"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Season comparison
        </h3>
        {#if record}
          <table class="mt-2 w-full text-sm">
            <thead>
              <tr class="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                <th scope="col" class="py-1 text-left">You</th>
                <th scope="col" class="py-1 text-center">Stat</th>
                <th scope="col" class="py-1 text-right">Opp avg</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/50 tabular-nums">
              <tr>
                <td class="py-2 text-left font-bold">{perGameValue(record.points, gamesPlayed)}</td>
                <td class="py-2 text-center text-xs text-muted-foreground">Points per game</td>
                <td class="py-2 text-right font-bold">{oneDecimal(opponentPointsPerGame)}</td>
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pct(record.fieldGoals.made, record.fieldGoals.attempted)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">FG%</td>
                <td class="py-2 text-right font-bold"
                  >{pct(opponentTotals.fgm, opponentTotals.fga)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{pct(record.threes.made, record.threes.attempted)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">3P%</td>
                <td class="py-2 text-right font-bold"
                  >{pct(opponentTotals.tpm, opponentTotals.tpa)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGameValue(record.rebounds.total, gamesPlayed)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Rebounds per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGameValue(opponentTotals.reb, gamesPlayed)}</td
                >
              </tr>
              <tr>
                <td class="py-2 text-left font-bold"
                  >{perGameValue(record.turnovers, gamesPlayed)}</td
                >
                <td class="py-2 text-center text-xs text-muted-foreground">Turnovers per game</td>
                <td class="py-2 text-right font-bold"
                  >{perGameValue(opponentTotals.tov, gamesPlayed)}</td
                >
              </tr>
            </tbody>
          </table>
        {/if}
      </section>

      <section
        aria-label="Season summary"
        class="rounded-xl border border-line-soft bg-surface-1 p-4"
      >
        <h3 class="font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
          Season summary
        </h3>
        <ul class="mt-3 flex flex-col gap-3 text-sm">
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Gamepad2 class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase">Mode</span
              ><span class="font-semibold">{modeLabel}</span></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Calendar class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase"
                >Season</span
              ><span class="font-semibold"
                >{franchiseLabel(run.franchiseId)} · {era?.label ?? run.eraId}</span
              ></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><ShieldCheck class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase">Games</span
              ><span class="font-semibold">{gamesPlayed} played</span></span
            >
          </li>
          <li class="flex items-center gap-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-3"
              ><Trophy class="h-4 w-4 text-muted-foreground" /></span
            >
            <span
              ><span class="block font-mono text-[10px] text-muted-foreground uppercase"
                >Record</span
              ><span class="font-semibold"
                >{#if record}{record.wins}–{record.losses}{run.outcome === 'perfect'
                    ? ' · perfect'
                    : ''}{:else}—{/if}</span
              ></span
            >
          </li>
        </ul>
      </section>
    </div>

    <div class="px-4 pb-4 sm:px-6 sm:pb-6">
      <details class="rounded-xl border border-line-soft bg-surface-1">
        <summary
          class="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden"
        >
          <ShieldCheck class="h-5 w-5 text-muted-foreground" />
          <span class="font-mono text-xs font-bold tracking-widest uppercase">Season details</span>
          <span class="text-xs text-muted-foreground">Click to view technical details</span>
          <ChevronDown class="ml-auto h-4 w-4 text-muted-foreground" />
        </summary>
        <div class="border-t border-border/60 p-4">
          <p class="truncate font-mono text-[11px] text-muted-foreground" title={run.runSeed}>
            Seed: {run.runSeed.slice(0, 16)}…{run.runSeed.slice(-8)}
          </p>
          <p class="mt-1 break-all font-mono text-[11px] text-muted-foreground">{run.runSeed}</p>
          <p class="mt-2 font-mono text-[11px] text-muted-foreground">
            Data {run.versions.dataVersion} · Engine {run.versions.engineVersion} · Bracket {run
              .versions.bracketVersion}
          </p>
        </div>
      </details>
    </div>
  {:else if tab === 'games'}
    <div class="p-4 sm:p-6">
      <div class="rounded-xl border border-border bg-surface-1 p-3 sm:p-4">
        <GameStrip {run} games={run.games} compact />
      </div>
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
            <p class="mt-3 text-xs text-muted-foreground">No clear factor recorded.</p>
          {/if}
        </section>
      {/if}
    </div>
  {:else if tab === 'players'}
    <section aria-label="Your five, season table" class="min-w-0 p-4 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-display text-xl font-extrabold tracking-tight uppercase">
          Your five · season
        </h2>
        <div
          class="flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Season values"
        >
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
                    {trueShootingPct(
                      raw.points,
                      raw.fieldGoals.attempted,
                      raw.freeThrows.attempted,
                    )}
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
        <div class="mt-4 grid min-w-0 gap-2 sm:hidden">
          {#each displayAggregates.players as aggregate, index (aggregate.playerId)}
            {@const row = seasonTable[index]}
            {@const raw = aggregates!.players.find((p) => p.playerId === aggregate.playerId)!}
            <article class="min-w-0 rounded-lg border border-border bg-surface-1 px-4 py-3">
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
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
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
              <div class="mt-3 grid min-w-0 grid-cols-2 gap-x-4 text-xs font-mono tabular-nums">
                <div class="min-w-0 divide-y divide-border/40">
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">FGA</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.fieldGoals.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">3PA</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.threes.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">FTA</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.freeThrows.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">TS%</span>
                    <span class="font-semibold text-foreground">
                      {trueShootingPct(
                        raw.points,
                        raw.fieldGoals.attempted,
                        raw.freeThrows.attempted,
                      )}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">REB</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.rebounds.total)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">STL</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.steals)}
                    </span>
                  </div>
                </div>
                <div class="min-w-0 divide-y divide-border/40">
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">FG%</span>
                    <span class="font-semibold text-foreground">
                      {pct(raw.fieldGoals.made, raw.fieldGoals.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">3P%</span>
                    <span class="font-semibold text-foreground">
                      {pct(raw.threes.made, raw.threes.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">FT%</span>
                    <span class="font-semibold text-foreground">
                      {pct(raw.freeThrows.made, raw.freeThrows.attempted)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">USG%</span>
                    <span class="font-semibold text-foreground">
                      {usagePct(raw, aggregates!.team)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">AST</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.assists)}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-2 py-1.5">
                    <span class="text-muted-foreground">BLK</span>
                    <span class="font-semibold text-foreground">
                      {formatAggregateStat(aggregate.blocks)}
                    </span>
                  </div>
                </div>
              </div>
              <div
                class="flex items-center justify-between gap-2 border-t border-border/40 py-1.5 text-xs font-mono tabular-nums"
              >
                <span class="text-muted-foreground">TOV</span>
                <span class="font-semibold text-foreground">
                  {formatAggregateStat(aggregate.turnovers)}
                </span>
              </div>
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
  {:else}
    <div class="flex flex-col gap-4 p-4 sm:p-6">
      {#if record}
        <section
          aria-label="Season snapshot"
          class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="font-display text-xl font-extrabold tracking-tight uppercase">
              Season snapshot
            </h2>
            <span class="font-mono text-[10px] text-muted-foreground">{gamesPlayed} games</span>
          </div>
          <dl class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div class="rounded-lg border border-border bg-card p-3">
              <dt class="font-mono text-[10px] text-muted-foreground uppercase">Your PPG</dt>
              <dd class="mt-1 font-display text-xl font-extrabold">
                {perGameValue(record.points, gamesPlayed)}
              </dd>
            </div>
            <div class="rounded-lg border border-border bg-card p-3">
              <dt class="font-mono text-[10px] text-muted-foreground uppercase">Opponent PPG</dt>
              <dd class="mt-1 font-display text-xl font-extrabold">
                {oneDecimal(opponentPointsPerGame)}
              </dd>
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
                {perGameValue(record.possessions, gamesPlayed)}
              </dd>
            </div>
            <div class="rounded-lg border border-border bg-card p-3">
              <dt class="font-mono text-[10px] text-muted-foreground uppercase">Rebounds/G</dt>
              <dd class="mt-1 font-display text-xl font-extrabold">
                {perGameValue(record.rebounds.total, gamesPlayed)}
              </dd>
            </div>
          </dl>
          <div class="mt-3 grid gap-2 font-mono text-xs sm:grid-cols-4">
            <p>
              <span class="text-muted-foreground">FG</span>
              {pct(record.fieldGoals.made, record.fieldGoals.attempted)}
            </p>
            <p>
              <span class="text-muted-foreground">3P</span>
              {pct(record.threes.made, record.threes.attempted)}
            </p>
            <p>
              <span class="text-muted-foreground">FT</span>
              {pct(record.freeThrows.made, record.freeThrows.attempted)}
            </p>
            <p>
              <span class="text-muted-foreground">TOV/G</span>
              {perGameValue(record.turnovers, gamesPlayed)}
            </p>
          </div>
        </section>
      {/if}

      <section aria-label="How your five won" class="rounded-xl border border-border bg-card p-5">
        <h2 class="font-display text-xl font-extrabold tracking-tight uppercase">
          How your five won
        </h2>
        <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li class="rounded-lg border border-border bg-surface-1 p-3">
            <span class="font-semibold"
              >{explanation.turnoverBattleWins} of {run.games.length} games</span
            >
            <span class="text-muted-foreground"> &nbsp;you won the turnover battle.</span>
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
                &nbsp;Opponents grabbed {percentOneDecimal(
                  explanation.opponentOffensiveReboundRate,
                )} of their own misses.
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
      </section>
    </div>
  {/if}
</div>
