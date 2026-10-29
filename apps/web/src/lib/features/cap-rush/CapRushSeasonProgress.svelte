<script lang="ts">
  import {
    CAP_RUSH_GAME_COUNT,
    POSITIONS,
    franchiseAbbreviation,
    type CapRushDraftState,
    type CapRushPlayerSeasonLine,
    type CapRushStoredGame,
    type HavocParticipantLine,
    type HavocTeamResult,
  } from '@hoop-rush/data-contracts';
  import type { CapRushSeasonView } from '@hoop-rush/application/cap-rush';
  import { capRushPlayerSeasonLines } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import {
    formatAverage,
    formatMillions,
    formatShootingPercentage,
    initialsOf,
    recordLabel,
    variantLabel,
  } from './cap-rush-presentation.ts';

  let {
    draft,
    season,
    storedGames = [],
    art = null,
  }: {
    draft: CapRushDraftState;
    season: CapRushSeasonView;
    storedGames?: readonly CapRushStoredGame[];
    art?: CapRushArt | null;
  } = $props();

  let selectedGameNumber = $state<number | null>(null);

  const locked = $derived(draft.locked);
  const played = $derived(season.games.length);
  const latest = $derived(season.games.at(-1) ?? null);
  const remaining = $derived(Math.max(0, CAP_RUSH_GAME_COUNT - played));
  const hasBoxScores = $derived(storedGames.length > 0);
  const boxScoresComplete = $derived(played > 0 && storedGames.length === played);
  const gamesByNumber = $derived(new Map(storedGames.map((game) => [game.gameNumber, game])));
  const summaryByNumber = $derived(new Map(season.games.map((game) => [game.gameNumber, game])));
  const opponentTeams = $derived(
    new Map((locked?.opponents ?? []).map((entry) => [entry.opponentId, entry.team])),
  );
  const latestOpponent = $derived(
    latest === null ? null : (opponentTeams.get(latest.opponentId) ?? null),
  );
  const latestIdentity = $derived(
    latestOpponent === null || art === null ? null : art.teamFor(latestOpponent.teamId),
  );
  const picksBySlot = $derived(new Map(draft.picks.map((pick) => [pick.slot, pick])));
  const slotLines = $derived(
    locked === null
      ? []
      : capRushPlayerSeasonLines({ locked, games: storedGames })
          .slice()
          .sort((left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot)),
  );
  const selectedGame = $derived(
    selectedGameNumber === null ? null : (gamesByNumber.get(selectedGameNumber) ?? null),
  );
  const selectedSummary = $derived(
    selectedGameNumber === null ? null : (summaryByNumber.get(selectedGameNumber) ?? null),
  );
  const humanTeam = $derived(
    selectedGame === null
      ? null
      : selectedGame.summary.humanHome
        ? selectedGame.result.home
        : selectedGame.result.away,
  );
  const opponentTeam = $derived(
    selectedGame === null
      ? null
      : selectedGame.summary.humanHome
        ? selectedGame.result.away
        : selectedGame.result.home,
  );

  const cells = $derived(
    Array.from({ length: CAP_RUSH_GAME_COUNT }, (_, index) => {
      const gameNumber = index + 1;
      const summary = summaryByNumber.get(gameNumber) ?? null;
      const schedule = locked?.schedule[gameNumber - 1] ?? null;
      const opponentId = summary?.opponentId ?? schedule?.opponentId ?? null;
      const team = opponentId === null ? null : (opponentTeams.get(opponentId) ?? null);
      const identity = team === null || art === null ? null : art.teamFor(team.teamId);
      return {
        gameNumber,
        summary,
        stored: gamesByNumber.has(gameNumber),
        opponentLabel:
          identity?.abbreviation ??
          (team === null ? (opponentId ?? '—') : franchiseAbbreviation(team.teamId)),
        opponentName: team?.displayName ?? opponentId ?? 'Unknown opponent',
        humanHome: summary?.humanHome ?? schedule?.humanHome ?? false,
      };
    }),
  );

  function participantKindLabel(kind: HavocParticipantLine['kind']): string {
    return kind === 'starter' ? 'Starter' : kind === 'replacement' ? 'Replacement' : 'Clone';
  }

  function teamIdentityOf(team: HavocTeamResult) {
    return art === null ? null : art.teamFor(team.teamId);
  }

  function totalOf(
    lines: readonly CapRushPlayerSeasonLine[],
    field:
      | 'points'
      | 'rebounds'
      | 'assists'
      | 'steals'
      | 'blocks'
      | 'turnovers'
      | 'fieldGoalsMade'
      | 'fieldGoalsAttempted'
      | 'freeThrowsMade'
      | 'freeThrowsAttempted'
      | 'threesMade'
      | 'threesAttempted',
  ): number {
    return lines.reduce((total, line) => total + line[field], 0);
  }

  function toggleGame(gameNumber: number, stored: boolean): void {
    if (!stored) return;
    selectedGameNumber = selectedGameNumber === gameNumber ? null : gameNumber;
  }
</script>

<div class="flex flex-col gap-3">
  <section
    class="season-scoreboard rounded-2xl border border-border bg-card p-5 sm:p-7"
    aria-label="Season progress"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          {variantLabel(draft.variant)} · Season in progress
        </p>
        <h2
          class="font-display mt-2 text-5xl leading-none font-extrabold tracking-tight tabular-nums sm:text-6xl"
        >
          {recordLabel(season.aggregate.wins, season.aggregate.losses)}
        </h2>
        <p class="mt-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {played} of {CAP_RUSH_GAME_COUNT} games played
        </p>
      </div>
      <dl class="grid grid-cols-3 gap-2">
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Points for
          </dt>
          <dd class="font-display mt-1 text-xl font-extrabold tabular-nums">
            {season.aggregate.pointsFor}
          </dd>
        </div>
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Points against
          </dt>
          <dd class="font-display mt-1 text-xl font-extrabold tabular-nums">
            {season.aggregate.pointsAgainst}
          </dd>
        </div>
        <div class="rounded-xl border border-line-soft bg-surface-1 px-3 py-2.5">
          <dt class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
            Remaining
          </dt>
          <dd class="font-display mt-1 text-xl font-extrabold tabular-nums">{remaining}</dd>
        </div>
      </dl>
    </div>

    {#if latest !== null}
      <div class="mt-5 rounded-xl border border-line-strong bg-surface-1 p-4">
        <p
          class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Latest ? Game {latest.gameNumber}
        </p>
        <GameScoreboard
          teams={[
            { key: 'you', label: 'Your five', score: latest.humanPoints, winner: latest.won },
            {
              key: 'opponent',
              label: opponentTeams.get(latest.opponentId)?.displayName ?? latest.opponentId,
              score: latest.opponentPoints,
              winner: !latest.won,
            },
          ]}
          label={`Game ${latest.gameNumber} score`}
          class="mt-2"
        >
          {#snippet team(entry)}
            <div class="ui-scoreboard-team" data-align="center" data-winner={entry.winner === true}>
              {#if entry.key === 'opponent' && latestIdentity !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={latestIdentity.franchiseId}
                  teamExternalId={latestIdentity.teamExternalId}
                  className="mx-auto mb-1 h-9 w-9"
                  eager
                />
              {/if}
              <span class="ui-scoreboard-label">{entry.label}</span>
              {#key entry.score}<strong class="ui-scoreboard-score">{entry.score}</strong>{/key}
            </div>
          {/snippet}
        </GameScoreboard>
      </div>
    {/if}
    {#if season.completedAt !== null}
      <p class="mt-2 text-xs font-semibold text-positive">
        Season complete · {new Date(season.completedAt).toLocaleDateString()}
      </p>
    {/if}
  </section>

  <section
    class="rounded-2xl border border-border bg-card p-4 sm:p-5"
    aria-label="Schedule results"
  >
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
        Schedule · 82 games
      </h3>
      <p class="font-mono text-[10px] text-muted-foreground uppercase">
        {hasBoxScores ? 'Select a stored game for its box score' : 'Results only'}
      </p>
    </div>

    <ol class="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8" aria-label="Game results">
      {#each cells as cell (cell.gameNumber)}
        {@const summary = cell.summary}
        {@const active = cell.stored && selectedGameNumber === cell.gameNumber}
        <li class="min-w-0">
          <button
            type="button"
            aria-pressed={cell.stored ? active : undefined}
            aria-label={summary === null
              ? `Game ${cell.gameNumber} vs ${cell.opponentName}, not played`
              : `Game ${cell.gameNumber} vs ${cell.opponentName}, ${summary.won ? 'win' : 'loss'} ${summary.humanPoints} to ${summary.opponentPoints}`}
            disabled={!cell.stored}
            onclick={() => toggleGame(cell.gameNumber, cell.stored)}
            class="flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg border px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring {summary ===
            null
              ? 'border-dashed border-line-soft bg-background/40 text-muted-foreground'
              : summary.won
                ? 'border-positive/40 bg-positive/10 text-foreground'
                : 'border-negative/40 bg-negative/10 text-foreground'} {active
              ? 'ring-2 ring-primary'
              : ''} {cell.stored ? 'hover:border-primary' : 'cursor-default'}"
          >
            <span class="flex items-baseline justify-between gap-1">
              <span class="font-mono text-[9px] font-bold tabular-nums opacity-70"
                >{cell.gameNumber}</span
              >
              <span
                class="font-mono text-[9px] font-extrabold uppercase {summary === null
                  ? ''
                  : summary.won
                    ? 'text-positive'
                    : 'text-negative'}">{summary === null ? '·' : summary.won ? 'W' : 'L'}</span
              >
            </span>
            <span class="truncate font-mono text-[10px] font-bold">{cell.opponentLabel}</span>
            <span class="truncate font-mono text-[9px] tabular-nums opacity-80">
              {summary === null
                ? cell.humanHome
                  ? 'vs'
                  : '@'
                : `${summary.humanPoints}–${summary.opponentPoints}`}
            </span>
          </button>
        </li>
      {/each}
    </ol>
  </section>

  {#if selectedSummary !== null}
    <section
      class="rounded-2xl border border-border bg-card p-4 sm:p-5"
      aria-label={`Game ${selectedSummary.gameNumber} box score`}
    >
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p
            class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase"
          >
            Game {selectedSummary.gameNumber} · {selectedSummary.humanHome ? 'Home' : 'Away'}
            {#if selectedSummary.overtimePeriods > 0}
              · {selectedSummary.overtimePeriods} OT
            {/if}
          </p>
          <GameScoreboard
            teams={[
              {
                key: 'you',
                label: 'Your five',
                score: selectedSummary.humanPoints,
                winner: selectedSummary.won,
              },
              {
                key: 'opponent',
                label:
                  opponentTeams.get(selectedSummary.opponentId)?.displayName ??
                  selectedSummary.opponentId,
                score: selectedSummary.opponentPoints,
                winner: !selectedSummary.won,
              },
            ]}
            label={`Game ${selectedSummary.gameNumber} score`}
            class="mt-2"
          />
        </div>
        <button
          type="button"
          class="inline-flex min-h-9 items-center rounded-lg border border-line-strong px-3 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => (selectedGameNumber = null)}>Close box score</button
        >
      </div>

      {#if humanTeam === null || opponentTeam === null}
        <p class="mt-3 text-xs text-muted-foreground">
          The full box score for this game is not available on this device.
        </p>
      {:else}
        <div class="mt-3 grid gap-3 lg:grid-cols-2">
          {#each [humanTeam, opponentTeam] as team (team.teamId)}
            {@const identity = teamIdentityOf(team)}
            <div class="min-w-0 rounded-xl bg-surface-1 p-3">
              <div class="flex items-center gap-2">
                {#if identity !== null && art !== null}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={identity.franchiseId}
                    teamExternalId={identity.teamExternalId}
                    className="h-5 w-5"
                  />
                {/if}
                <p class="min-w-0 truncate text-sm font-bold">{team.displayName}</p>
                <span class="ml-auto font-mono text-sm font-extrabold tabular-nums"
                  >{team.points}</span
                >
              </div>
              <div class="mt-2 overflow-x-auto">
                <table class="ui-stats-table text-[11px]">
                  <caption class="sr-only">Box score for {team.displayName}</caption>
                  <thead>
                    <tr
                      class="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
                    >
                      <th scope="col" class="px-1.5 py-1 text-left font-medium">Player</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Min</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Pts</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Reb</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Ast</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Stl</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">Blk</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">TO</th>
                      <th scope="col" class="px-1.5 py-1 text-right font-medium">PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each team.participants as line (line.instanceId)}
                      <tr class="border-b border-border/40">
                        <th
                          scope="row"
                          class="max-w-40 truncate px-1.5 py-1 text-left font-semibold"
                        >
                          {line.displayName}
                          <span class="ml-1 font-mono text-[9px] font-normal text-muted-foreground">
                            {line.slot} · {participantKindLabel(line.kind)}
                          </span>
                        </th>
                        <td class="px-1.5 py-1 text-right font-mono">{line.minutes}</td>
                        <td class="px-1.5 py-1 text-right font-mono font-bold">{line.points}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.rebounds.total}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.assists}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.steals}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.blocks}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.turnovers}</td>
                        <td class="px-1.5 py-1 text-right font-mono">{line.fouls}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  <section
    class="rounded-2xl border border-border bg-card p-4 sm:p-5"
    aria-label="Season player totals and averages"
  >
    <div class="flex flex-wrap items-end justify-between gap-2">
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
        Season averages
      </h3>
      <p class="font-mono text-[10px] text-muted-foreground uppercase">
        {#if boxScoresComplete}
          {storedGames.length} stored {storedGames.length === 1 ? 'game' : 'games'}
        {:else if hasBoxScores}
          {storedGames.length} of {played} box scores
        {:else}
          No stored box scores
        {/if}
      </p>
    </div>

    {#if !hasBoxScores}
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
        Season player totals need the stored box scores from this run. They appear as games are
        played and accepted in this session.
      </p>
    {:else if !boxScoresComplete}
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
        Only the {storedGames.length} box scores accepted in this session are loaded, so the totals below
        cover those games rather than the full {played}-game season.
      </p>
    {/if}
    {#if hasBoxScores}
      <div class="mt-3 overflow-x-auto">
        <table class="ui-stats-table text-[11px]">
          <caption class="sr-only">
            Cap Rush season totals and averages for the five signed slots
          </caption>
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
            >
              <th scope="col" class="px-2 py-1 text-left font-medium">Slot</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Pts</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Reb</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Ast</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Stl</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">Blk</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">TO</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">FG%</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">FT%</th>
              <th scope="col" class="px-2 py-1 text-right font-medium">3P%</th>
            </tr>
          </thead>
          <tbody>
            {#each slotLines as line (line.slot)}
              {@const pick = picksBySlot.get(line.slot) ?? null}
              {@const face = art !== null && pick !== null ? art.faceFor(pick.card.source) : null}
              <tr class="border-b border-border/40">
                <th scope="row" class="px-2 py-1.5 text-left font-semibold">
                  <span class="flex min-w-0 items-center gap-2">
                    <span
                      class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] font-bold"
                      >{line.slot}</span
                    >
                    {#if art !== null}
                      {#if face !== null}
                        <PlayerFace
                          player={face}
                          manifest={art.manifest}
                          size="sm"
                          fallbackInitials={initialsOf(line.displayName)}
                        />
                      {:else}
                        <span
                          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                          aria-hidden="true">{initialsOf(line.displayName)}</span
                        >
                      {/if}
                    {/if}
                    <span class="min-w-0">
                      <span class="block truncate text-xs font-bold">{line.displayName}</span>
                      <span class="font-mono text-[9px] text-muted-foreground uppercase">
                        {formatMillions(line.salaryDollars)}
                      </span>
                    </span>
                  </span>
                </th>
                <td class="px-2 py-1.5 text-right font-mono font-bold">
                  {formatAverage(line.points, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {formatAverage(line.rebounds, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {formatAverage(line.assists, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {formatAverage(line.steals, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {formatAverage(line.blocks, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {formatAverage(line.turnovers, line.gamesPlayed)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono"
                  >{formatShootingPercentage(line.fieldGoalsMade, line.fieldGoalsAttempted)}</td
                >
                <td class="px-2 py-1.5 text-right font-mono"
                  >{formatShootingPercentage(line.freeThrowsMade, line.freeThrowsAttempted)}</td
                >
                <td class="px-2 py-1.5 text-right font-mono"
                  >{formatShootingPercentage(line.threesMade, line.threesAttempted)}</td
                >
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="font-semibold">
              <th scope="row" class="px-2 py-1.5 text-left">Season totals</th>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'points')}</td>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'rebounds')}</td>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'assists')}</td>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'steals')}</td>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'blocks')}</td>
              <td class="px-2 py-1.5 text-right font-mono">{totalOf(slotLines, 'turnovers')}</td>
              <td class="px-2 py-1.5 text-right font-mono"
                >{formatShootingPercentage(
                  totalOf(slotLines, 'fieldGoalsMade'),
                  totalOf(slotLines, 'fieldGoalsAttempted'),
                )}</td
              >
              <td class="px-2 py-1.5 text-right font-mono"
                >{formatShootingPercentage(
                  totalOf(slotLines, 'freeThrowsMade'),
                  totalOf(slotLines, 'freeThrowsAttempted'),
                )}</td
              >
              <td class="px-2 py-1.5 text-right font-mono"
                >{formatShootingPercentage(
                  totalOf(slotLines, 'threesMade'),
                  totalOf(slotLines, 'threesAttempted'),
                )}</td
              >
            </tr>
          </tfoot>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .season-scoreboard {
    border-top: 3px solid var(--color-primary);
    background-image: radial-gradient(
      ellipse at top right,
      color-mix(in srgb, var(--color-primary) 12%, transparent),
      transparent 55%
    );
  }
</style>
