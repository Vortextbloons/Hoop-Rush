<script lang="ts">
  import { Crown, Sparkles } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';
  import type { FullCourtReportData } from './full-court-report-data.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';

  let {
    entry,
    data,
    art = null,
  }: {
    entry: FullCourtHistoryEntryView;
    data: FullCourtReportData;
    art?: FullCourtArt | null;
  } = $props();

  /** Per-game rows keyed by player, so a card can show what the season actually produced. */
  const statsByPlayer = $derived(new Map(data.playerRows.map((row) => [row.playerId, row])));
  const rotation = $derived(data.record.coaching.rotation);
  const starters = $derived.by(() => {
    if (rotation !== undefined) return new Set(rotation.startingFive);
    const byStarts = [...data.playerRows]
      .filter((row) => row.starts > 0)
      .sort((a, b) => b.starts - a.starts || b.mpg - a.mpg || b.ppg - a.ppg)
      .slice(0, 5);
    return new Set(byStarts.map((row) => row.playerId));
  });
  const closers = $derived(new Set(rotation?.closingFive ?? []));

  function minutesFor(playerId: string): number | null {
    if (rotation === undefined) return null;
    const target = rotation.minuteTargets[playerId];
    return target === undefined ? null : target;
  }
</script>

<Panel as="section" padding="md" aria-label="Roster">
  <SectionHeading
    eyebrow="The roster"
    title={`${String(entry.roster.length)} players`}
    level={2}
    size="sm"
    description={`${entry.payrollLabel} payroll · ${entry.capStatusLabel}`}
  />

  <ul class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
    {#each entry.roster as player (player.playerId)}
      {@const row = statsByPlayer.get(player.playerId)}
      {@const minutes = minutesFor(player.playerId)}
      {@const isStarter = starters.has(player.playerId)}
      {@const isCloser = closers.has(player.playerId)}
      <li class="player-card" data-starter={isStarter}>
        <div class="player-card-head">
          <span class="player-frame">
            <FullCourtPortrait {player} {art} size="md" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="player-name" title={player.displayName}>{player.displayName}</p>
            <p class="player-meta">
              {player.teamAbbreviation} · {player.seasonKey} · {player.position}
            </p>
          </div>
          <FullCourtRating value={player.overall} size="md" layout="stacked" align="right" />
        </div>

        <div class="player-role">
          {#if isStarter}
            <Badge tone="primary">Starter</Badge>
          {:else}
            <Badge>Bench</Badge>
          {/if}
          {#if isCloser}
            <Badge tone="accent">Closer</Badge>
          {/if}
          {#if minutes !== null}
            <span class="player-minutes">{minutes}m target</span>
          {/if}
          <span class="player-salary">{player.salaryLabel}</span>
        </div>

        {#if row !== undefined}
          <dl class="player-stats">
            <div>
              <dt>PPG</dt>
              <dd>{row.ppg.toFixed(1)}</dd>
            </div>
            <div>
              <dt>RPG</dt>
              <dd>{row.rpg.toFixed(1)}</dd>
            </div>
            <div>
              <dt>APG</dt>
              <dd>{row.apg.toFixed(1)}</dd>
            </div>
            <div>
              <dt>GP</dt>
              <dd>{row.games}</dd>
            </div>
          </dl>
        {:else}
          <p class="player-no-stats">No recorded games for this player.</p>
        {/if}
      </li>
    {/each}
  </ul>

  {#if entry.achievements.length > 0}
    <div class="mt-4 border-t border-line-soft pt-3">
      <p class="ui-label" data-tone="muted">Achievements</p>
      <ul class="mt-2 flex flex-wrap gap-1.5">
        {#each entry.achievements as achievement (achievement.id)}
          <li
            class="inline-flex items-center gap-1.5 rounded-full border border-accent/45 bg-accent/10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.08em] text-accent uppercase"
          >
            {#if achievement.id === 'bench-mob'}
              <Sparkles size={12} aria-hidden="true" />
            {:else}
              <Crown size={12} aria-hidden="true" />
            {/if}
            {achievement.name}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</Panel>

<style>
  .player-card {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
    transition:
      border-color 160ms ease,
      background-color 160ms ease;
  }
  .player-card[data-starter='true'] {
    border-color: color-mix(in srgb, var(--color-primary) 32%, var(--color-line-soft));
    background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-1));
  }
  .player-card-head {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.55rem;
  }
  .player-frame {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.9rem;
    height: 2.9rem;
    overflow: hidden;
    border-radius: 0.6rem;
    background: radial-gradient(
      ellipse at center bottom,
      color-mix(in srgb, var(--color-primary) 22%, transparent),
      transparent 72%
    );
  }
  .player-name {
    margin: 0;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .player-meta {
    margin: 0.15rem 0 0;
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.58rem;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .player-role {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  .player-minutes,
  .player-salary {
    margin-left: auto;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-variant-numeric: tabular-nums;
  }
  .player-salary {
    margin-left: 0;
    color: var(--color-foreground);
    font-weight: 700;
  }
  .player-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.3rem;
    margin: 0;
    padding-top: 0.5rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .player-stats dt {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.52rem;
    letter-spacing: 0.06em;
  }
  .player-stats dd {
    margin: 0.1rem 0 0;
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .player-no-stats {
    margin: 0;
    padding-top: 0.45rem;
    border-top: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-size: 0.65rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .player-card {
      transition: none;
    }
  }
</style>
