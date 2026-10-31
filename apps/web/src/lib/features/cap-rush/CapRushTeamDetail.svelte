<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_NAMES,
    capRushAlignmentOf,
    capRushConferenceStandingsEntries,
    isConferenceStandings,
    type CapRushConferenceStandings,
    type CapRushDraftState,
    type CapRushLeagueGame,
    type CapRushLockedInputs,
    type CapRushPostseasonStandings,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    capStatusLabel,
    apronPenaltyRows,
    formatMillions,
    initialsOf,
    recordLabel,
  } from './cap-rush-presentation.ts';
  import CapRushPlayoffMark from './CapRushPlayoffMark.svelte';
  import CapRushPlayoffPanel from './CapRushPlayoffPanel.svelte';
  import {
    capRushPlayoffCoverage,
    capRushPlayoffRowFor,
    capRushPlayoffStatusOf,
  } from './cap-rush-playoff-presentation.ts';

  let {
    teamId,
    locked,
    draft = null,
    standings = null,
    leagueGames = [],
    art = null,
    onGameSelect,
  }: {
    teamId: string;
    locked: CapRushLockedInputs;
    draft?: CapRushDraftState | null;
    standings?: CapRushPostseasonStandings | CapRushConferenceStandings | null;
    leagueGames?: readonly CapRushLeagueGame[];
    art?: CapRushArt | null;
    onGameSelect?: (game: CapRushLeagueGame) => void;
  } = $props();

  const team = $derived(
    locked.human.teamId === teamId
      ? locked.human
      : (locked.opponents.find((entry) => entry.team.teamId === teamId)?.team ?? null),
  );
  const teamSeason = $derived(team === null ? null : (art?.opponentSeasonFor(team) ?? null));
  const isUserTeam = $derived(locked.human.teamId === teamId);
  const alignment = $derived(capRushAlignmentOf(teamId));
  const identity = $derived(art === null ? null : art.teamFor(teamId));
  const entry = $derived.by(() => {
    if (standings === null) return null;
    const entries = isConferenceStandings(standings)
      ? capRushConferenceStandingsEntries(standings)
      : standings.entries;
    return entries.find((candidate) => candidate.teamId === teamId) ?? null;
  });
  const record = $derived.by(() => {
    if (entry !== null) return { wins: entry.wins, losses: entry.losses, seed: entry.seed };
    let wins = 0;
    let losses = 0;
    for (const game of leagueGames) {
      if (game.homeTeamId !== teamId && game.awayTeamId !== teamId) continue;
      if (game.winnerTeamId === teamId) wins += 1;
      else losses += 1;
    }
    return { wins, losses, seed: null };
  });
  const salaries = $derived(
    isUserTeam ? new Map(locked.picks.map((pick) => [pick.slot, pick.salaryDollars])) : null,
  );
  const schedule = $derived.by(() => {
    if (locked.leagueSchedule === undefined) return [];
    return locked.leagueSchedule
      .filter((game) => game.homeTeamId === teamId || game.awayTeamId === teamId)
      .sort((left, right) => left.slot - right.slot)
      .map((game) => ({
        slot: game.slot,
        home: game.homeTeamId === teamId,
        opponentId: game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId,
        gameId: game.gameId,
        result: leagueGames.find((candidate) => candidate.gameId === game.gameId) ?? null,
      }));
  });
  const penalties = $derived(isUserTeam ? apronPenaltyRows(locked.payrollStatus) : []);
  const playoffStatus = $derived(draft === null ? 'legacy' : capRushPlayoffStatusOf(draft));
  const playoffCoverage = $derived(
    capRushPlayoffCoverage(
      locked,
      (team?.starters ?? []).map((starter) => starter.source.playerVersionId),
    ),
  );
  let selectedPlayerVersionId = $state<string | null>(null);
  const selectedPlayer = $derived.by(() => {
    if (selectedPlayerVersionId === null) return null;
    const starter = (team?.starters ?? []).find(
      (candidate) => candidate.source.playerVersionId === selectedPlayerVersionId,
    );
    if (starter === undefined) return null;
    const row = capRushPlayoffRowFor(locked, starter.source.playerVersionId);
    return row === null ? null : { starter, row };
  });
  const playoffSummary = $derived.by(() => {
    if (playoffStatus === 'legacy')
      return 'This run predates playoff performance, so its playoffs use the previous simulation.';
    if (playoffCoverage.withEvidence === 0)
      return 'No starter has a recorded playoff sample for this exact season, so the playoffs run at regular-season strength.';
    if (playoffStatus === 'active')
      return `${String(playoffCoverage.withEvidence)} of ${String(playoffCoverage.total)} starters carry a recorded playoff sample. Those adjustments are live in this postseason.`;
    return `${String(playoffCoverage.withEvidence)} of ${String(playoffCoverage.total)} starters carry a recorded playoff sample. They take effect when the playoffs start.`;
  });

  function opponentName(opponentId: string): string {
    if (locked.human.teamId === opponentId) return locked.human.displayName;
    return (
      locked.opponents.find((entry) => entry.team.teamId === opponentId)?.team.displayName ??
      opponentId
    );
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center gap-3">
    {#if identity && art}
      <TeamLogo
        manifest={art.manifest}
        franchiseId={identity.franchiseId}
        teamExternalId={identity.teamExternalId}
        alt=""
        className="h-11 w-11"
      />
    {:else}
      <span
        class="grid h-11 w-11 place-items-center rounded-lg bg-surface-3 font-display text-sm font-extrabold"
        >{teamId.slice(0, 3).toUpperCase()}</span
      >
    {/if}
    <div class="min-w-0">
      <p class="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
        {CAP_RUSH_CONFERENCE_NAMES[alignment.conference]} · {alignment.division}
      </p>
      <h2 class="font-display truncate text-xl font-extrabold tracking-tight uppercase">
        {team?.displayName ?? teamId}
      </h2>
    </div>
    {#if isUserTeam}
      <span
        class="ml-auto rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-bold text-primary uppercase"
        >You</span
      >
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <span
      class="rounded-lg border border-line-soft bg-surface-1 px-2.5 py-1 font-mono text-[10px] uppercase"
      >{recordLabel(record.wins, record.losses)}</span
    >
    {#if record.seed !== null}
      <span
        class="rounded-lg border border-line-soft bg-surface-1 px-2.5 py-1 font-mono text-[10px] uppercase"
        >Seed {record.seed}</span
      >
    {/if}
    {#if isUserTeam}
      <span
        class="rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[10px] text-accent uppercase"
        >{capStatusLabel(locked.payrollStatus)} · {formatMillions(locked.payrollDollars)}</span
      >
    {/if}
  </div>

  <section aria-label="Roster" class="rounded-xl border border-line-soft">
    <table class="w-full border-collapse text-left">
      <thead>
        <tr class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          <th scope="col" class="px-3 py-2 font-bold">Player</th>
          <th scope="col" class="px-2 py-2 text-center font-bold">Pos</th>
          <th scope="col" class="hidden px-2 py-2 text-center font-bold sm:table-cell">Season</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">OVR</th>
          {#if isUserTeam}
            <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">Salary</th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each team?.starters ?? [] as starter (starter.instanceId)}
          {@const metadata = isUserTeam ? null : (art?.opponentMetadataFor(starter.source) ?? null)}
          {@const face = art === null ? null : art.faceForPlayerId(starter.source.playerId)}
          {@const playoffRow = capRushPlayoffRowFor(locked, starter.source.playerVersionId)}
          <tr class="border-t border-line-soft/60">
            <th scope="row" class="px-3 py-1.5 text-left">
              <span class="flex min-w-0 items-center gap-2">
                {#if face !== null && art !== null}
                  <PlayerFace
                    player={face}
                    manifest={art.manifest}
                    size="sm"
                    fallbackInitials={initialsOf(starter.source.displayName)}
                  />
                {:else}
                  <span
                    class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-[8px] font-bold"
                    >{initialsOf(starter.source.displayName)}</span
                  >
                {/if}
                {#if playoffRow !== null}
                  <button
                    type="button"
                    class="min-w-0 truncate rounded text-left text-[11px] font-semibold underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    title={`${starter.source.displayName} playoff adjustment`}
                    onclick={() => (selectedPlayerVersionId = starter.source.playerVersionId)}
                  >
                    {starter.source.displayName}
                  </button>
                  <CapRushPlayoffMark row={playoffRow} status={playoffStatus} size="sm" />
                {:else}
                  <span
                    class="min-w-0 truncate text-[11px] font-semibold"
                    title={starter.source.displayName}>{starter.source.displayName}</span
                  >
                {/if}
              </span>
            </th>
            <td class="px-2 py-1.5 text-center font-mono text-[10px]">{starter.slot}</td>
            <td
              class="hidden px-2 py-1.5 text-center font-mono text-[9px] text-muted-foreground sm:table-cell"
            >
              {starter.source.seasonKey ?? metadata?.seasonKey ?? teamSeason ?? '\u2014'}
            </td>
            <td class="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums">
              {isUserTeam
                ? starter.source.originalOverall
                : (metadata?.overall ??
                  (starter.source.overallSource === 'catalog'
                    ? starter.source.originalOverall
                    : '\u2014'))}
            </td>
            {#if isUserTeam}
              <td
                class="hidden px-2 py-1.5 text-right font-mono text-[10px] tabular-nums sm:table-cell"
              >
                {formatMillions(salaries?.get(starter.slot) ?? 0)}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section
    aria-label="Playoff performance coverage"
    class="rounded-xl border border-line-soft bg-surface-1 p-3"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Playoff form
      </p>
      {#if playoffCoverage.withEvidence > 0}
        <span class="font-mono text-[10px] tabular-nums text-muted-foreground"
          >{playoffCoverage.withEvidence}/{playoffCoverage.total} sampled</span
        >
      {/if}
    </div>
    <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
      {playoffSummary}
      {#if playoffCoverage.withEvidence > 0}
        Select a marked player for the measured history and the exact simulation change.
      {/if}
    </p>
  </section>

  {#if isUserTeam && penalties.length > 0}
    <section
      aria-label="Active payroll effects"
      class="rounded-xl border border-accent/30 bg-accent/5 p-3"
    >
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-accent uppercase">
        Active effects
      </p>
      <ul class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {#each penalties as penalty (penalty.label)}
          <li class="flex items-baseline justify-between gap-2 text-[11px]">
            <span class="truncate text-muted-foreground">{penalty.label}</span>
            <span class="font-mono text-accent">−{penalty.reduction}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if schedule.length > 0}
    <section aria-label="Team schedule" class="rounded-xl border border-line-soft">
      <p
        class="px-3 pt-2 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
      >
        Schedule
      </p>
      <div class="max-h-72 overflow-y-auto">
        <table class="w-full border-collapse text-left">
          <tbody>
            {#each schedule as game (game.gameId)}
              <tr class="border-t border-line-soft/60">
                <td
                  class="w-10 px-3 py-1.5 font-mono text-[9px] text-muted-foreground tabular-nums"
                >
                  {game.slot}
                </td>
                <td class="px-2 py-1.5 font-mono text-[9px] text-muted-foreground uppercase">
                  {game.home ? 'vs' : '@'}
                </td>
                <td class="w-full min-w-0 px-2 py-1.5">
                  <span class="block truncate text-[11px]" title={opponentName(game.opponentId)}
                    >{opponentName(game.opponentId)}</span
                  >
                </td>
                <td class="px-3 py-1.5 text-right">
                  {#if game.result !== null && onGameSelect}
                    {@const userPoints =
                      game.result.homeTeamId === teamId
                        ? game.result.homePoints
                        : game.result.awayPoints}
                    {@const otherPoints =
                      game.result.homeTeamId === teamId
                        ? game.result.awayPoints
                        : game.result.homePoints}
                    <button
                      type="button"
                      class="rounded border border-line-soft px-2 py-0.5 font-mono text-[10px] tabular-nums outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring {game
                        .result.winnerTeamId === teamId
                        ? 'text-positive'
                        : 'text-negative'}"
                      onclick={() => onGameSelect(game.result as CapRushLeagueGame)}
                    >
                      {userPoints}–{otherPoints}
                    </button>
                  {:else}
                    <span class="font-mono text-[9px] text-muted-foreground uppercase">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else if locked.leagueSchedule === undefined && isUserTeam}
    <p class="text-[11px] text-muted-foreground">
      This legacy run stores only the user schedule and regular-season results.
    </p>
  {/if}
</div>

<DialogShell
  open={selectedPlayer !== null}
  onOpenChange={(open) => {
    if (!open) selectedPlayerVersionId = null;
  }}
  size="lg"
  layout="sheet"
  grabHandle={true}
>
  {#snippet header()}
    <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
      Playoff performance
    </p>
    <p class="font-display text-lg font-extrabold tracking-tight uppercase">
      {selectedPlayer?.starter.source.displayName ?? ''}
    </p>
  {/snippet}
  {#if selectedPlayer !== null}
    <CapRushPlayoffPanel
      row={selectedPlayer.row}
      displayName={selectedPlayer.starter.source.displayName}
      seasonKey={selectedPlayer.row.seasonKey}
      status={playoffStatus}
    />
  {/if}
</DialogShell>
