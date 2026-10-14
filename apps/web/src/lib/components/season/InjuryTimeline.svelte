<script lang="ts">
  import { INJURY_TYPE_LABEL, type InjuryTimelinePlayer } from '#lib/season/season-health-view.js';
  let {
    players,
  }: {
    players: InjuryTimelinePlayer[];
  } = $props();
  const SEVERITY_TONE: Record<string, string> = {
    minor: 'win',
    moderate: 'hardwood',
    major: 'warn',
    'season-ending': 'loss',
  };
  const injuredCount = $derived(players.length);
  const summary = $derived(
    `${String(injuredCount)} player${injuredCount === 1 ? '' : 's'} with recorded injuries`,
  );
</script>

<section aria-labelledby="injury-timeline-heading" class="sr-panel-quiet p-4">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id="injury-timeline-heading" class="sr-section-label">Injury history</h2>
    <span class="font-mono text-[10px] text-muted-foreground">{summary}</span>
  </div>
  {#if players.length === 0}
    <p class="mt-2 text-sm text-muted-foreground">
      No recorded injuries for this roster this season.
    </p>
  {:else}
    <ul class="mt-2 flex flex-col gap-3">
      {#each players as player (player.playerVersionId)}
        <li>
          <p class="text-sm font-semibold">{player.displayName}</p>
          <ul class="mt-1 flex flex-col divide-y divide-border/50">
            {#each player.entries as entry (entry.injuryId)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
                <span class="sr-badge shrink-0" data-tone={SEVERITY_TONE[entry.severity]}>
                  {INJURY_TYPE_LABEL[entry.type]} · {entry.severity}
                </span>
                <span class="font-mono text-[10px] text-muted-foreground">
                  {entry.gameId}
                  {#if entry.removedClock !== null}
                    · removed {entry.removedClock.period}:{String(
                      entry.removedClock.seconds,
                    ).padStart(2, '0')}
                  {/if}
                  {#if entry.returnedInGame}
                    · returned same game
                  {/if}
                </span>
                <span class="min-w-0 font-mono text-[10px] text-muted-foreground">
                  {entry.seasonEnding
                    ? 'out for the season'
                    : `missed ${String(entry.missedGamesTotal)} game${entry.missedGamesTotal === 1 ? '' : 's'}`}
                  {#if entry.actualReturnRound !== null}
                    · back since R{entry.actualReturnRound}
                  {:else if !entry.seasonEnding && entry.missedGamesRemaining > 0}
                    · {entry.missedGamesRemaining} still out
                  {/if}
                </span>
                {#if entry.recurrence}
                  <span class="sr-badge shrink-0" data-tone="warn">Recurrence risk</span>
                {/if}
                {#if entry.source === 'risky-rehab-failure'}
                  <span class="sr-badge shrink-0" data-tone="loss">Rehab failure</span>
                {/if}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">{summary}</p>
</section>
