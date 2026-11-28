<script lang="ts">
  import { buildFullCourtNotableMoments, type FullCourtPlayerSeasonRow } from '@hoop-rush/engine';
  import { Award, Coins, LayoutGrid, Trophy, Users } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';
  import type { FullCourtReportData } from './full-court-report-data.ts';
  import FullCourtReportPlayoffs from './FullCourtReportPlayoffs.svelte';
  import FullCourtReportRoster from './FullCourtReportRoster.svelte';
  import FullCourtReportStats from './FullCourtReportStats.svelte';
  import FullCourtReportSummary from './FullCourtReportSummary.svelte';

  export type FullCourtReportTab = 'summary' | 'roster' | 'stats' | 'playoffs';

  let {
    entry,
    data,
    art = null,
  }: {
    entry: FullCourtHistoryEntryView;
    data: FullCourtReportData;
    art?: FullCourtArt | null;
  } = $props();

  const tabs = [
    { value: 'summary', label: 'Summary', icon: LayoutGrid },
    { value: 'roster', label: 'Roster', icon: Users },
    { value: 'stats', label: 'Stats & Awards', icon: Award },
    { value: 'playoffs', label: 'Playoffs', icon: Trophy },
  ] as const satisfies readonly {
    value: FullCourtReportTab;
    label: string;
    icon: typeof LayoutGrid;
  }[];

  let activeTab = $state<FullCourtReportTab>('summary');

  const userTeam = $derived(
    data.seasonLock.season.teams.find(
      (team) => team.teamId === data.seasonLock.season.userTeamId,
    ) ?? null,
  );
  const identity = $derived(
    userTeam === null || art === null ? null : art.teamFor(userTeam.teamId),
  );
  const champion = $derived(entry.playoffStatus === 'champion');
  const userRow = $derived(
    [...data.standings.west, ...data.standings.east].find(
      (row) => row.teamId === data.seasonLock.season.userTeamId,
    ) ?? null,
  );
  const rosterStats = $derived<readonly FullCourtPlayerSeasonRow[]>(
    data.playerRows.filter((row) => row.teamId === data.seasonLock.season.userTeamId),
  );
  const moments = $derived(
    buildFullCourtNotableMoments({
      teams: data.seasonLock.season.teams,
      userTeamId: data.seasonLock.season.userTeamId,
      regularScores: data.regularScores,
      ...(data.bracket === null ? {} : { series: data.bracket.series }),
    }),
  );
</script>

<section class="report" aria-label="Final report">
  <header class="report-hero" data-champion={champion}>
    <div class="report-hero-glow" aria-hidden="true"></div>
    <div class="report-hero-inner">
      <div class="report-hero-id">
        {#if identity !== null && art !== null}
          <span class="report-crest">
            <TeamLogo
              manifest={art.manifest}
              franchiseId={identity.franchiseId}
              teamExternalId={identity.teamExternalId}
              alt=""
              className="h-11 w-11"
              eager
            />
          </span>
        {/if}
        <div class="min-w-0">
          <p class="ui-label">{entry.variantLabel} · Final report</p>
          <h1 class="report-team">{entry.teamName}</h1>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={entry.playoffTone}>{entry.playoffLabel}</Badge>
            <Badge class={entry.capStatusClass}>{entry.capStatusLabel}</Badge>
            {#if userRow !== null}
              <Badge tone="neutral">
                #{userRow.seed}
                {userRow.conference === 'east' ? 'East' : 'West'}
              </Badge>
            {/if}
          </div>
        </div>
      </div>

      <div class="report-hero-score">
        <p class="report-record" aria-label={`${entry.regularRecordLabel} regular-season record`}>
          {entry.regularRecordLabel}
        </p>
        <p class="ui-micro">Regular season</p>
        <p class="report-hero-meta">
          Point diff {entry.pointDiffLabel} · {entry.championName === entry.teamName
            ? 'you won the title'
            : `champion: ${entry.championName}`}
        </p>
      </div>
    </div>

    {#if entry.achievements.length > 0}
      <div class="report-achievements">
        {#each entry.achievements as achievement (achievement.id)}
          <span class="report-achievement">
            <Award size={12} aria-hidden="true" />
            {achievement.name}
          </span>
        {/each}
      </div>
    {/if}
  </header>

  <div class="report-tabs" role="tablist" aria-label="Final report sections">
    {#each tabs as tab (tab.value)}
      <button
        type="button"
        role="tab"
        id={`report-tab-${tab.value}`}
        aria-selected={activeTab === tab.value}
        aria-controls={`report-panel-${tab.value}`}
        class="report-tab"
        onclick={() => (activeTab = tab.value)}
      >
        <tab.icon size={14} aria-hidden="true" />
        {tab.label}
      </button>
    {/each}
  </div>

  <div
    id={`report-panel-${activeTab}`}
    role="tabpanel"
    aria-labelledby={`report-tab-${activeTab}`}
    class="report-panel"
  >
    {#if activeTab === 'summary'}
      <FullCourtReportSummary
        {entry}
        {rosterStats}
        {userRow}
        awards={data.awards}
        {art}
        topMoments={moments.userMoments.slice(0, 3)}
      />
    {:else if activeTab === 'roster'}
      <FullCourtReportRoster {entry} {data} {art} />
    {:else if activeTab === 'stats'}
      <FullCourtReportStats
        awards={data.awards}
        {rosterStats}
        userTeamId={data.seasonLock.season.userTeamId}
        standings={data.standings}
        {art}
        {moments}
      />
    {:else}
      <FullCourtReportPlayoffs {entry} {data} {art} />
    {/if}
  </div>

  <footer class="report-footer">
    <div class="flex items-center gap-2 text-muted-foreground">
      <Coins size={13} aria-hidden="true" />
      <span class="ui-micro">
        {entry.warChestSpentLabel} spent · {entry.warChestRemainingLabel} left
      </span>
    </div>
    <p class="ui-micro">
      {data.record.completedAtIso.slice(0, 10)} · run {data.record.runId.slice(0, 8)}
    </p>
  </footer>
</section>

<style>
  .report {
    --report-accent: var(--color-primary);
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  /* Hero */
  .report-hero {
    position: relative;
    overflow: clip;
    border: 1px solid color-mix(in srgb, var(--report-accent) 26%, var(--color-line-soft));
    border-radius: 1rem;
    background:
      radial-gradient(
        120% 150% at 8% -20%,
        color-mix(in srgb, var(--report-accent) 16%, transparent),
        transparent 62%
      ),
      linear-gradient(180deg, var(--color-surface-2), var(--color-surface-1) 76%);
    padding: 1.15rem 1.25rem 0.95rem;
  }
  .report-hero[data-champion='true'] {
    --report-accent: var(--color-accent);
  }
  .report-hero-glow {
    position: absolute;
    inset-inline: 0;
    top: 0;
    height: 3px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--report-accent) 18%,
      var(--report-accent) 82%,
      transparent
    );
  }
  .report-hero-inner {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .report-hero-id {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }
  .report-crest {
    display: grid;
    flex: none;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    border: 1px solid color-mix(in srgb, var(--report-accent) 35%, transparent);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--report-accent) 10%, transparent);
  }
  .report-team {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 3.4vw, 2.05rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.05;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .report-hero-score {
    display: grid;
    justify-items: end;
    min-width: 0;
    text-align: right;
  }
  .report-record {
    margin: 0;
    color: var(--report-accent);
    font-family: var(--font-display);
    font-size: clamp(2.15rem, 6vw, 3.1rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 0.95;
  }
  .report-hero-meta {
    margin: 0.3rem 0 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    line-height: 1.5;
  }
  .report-achievements {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--color-line-soft);
  }
  .report-achievement {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Tabs */
  .report-tabs {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.25rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
    scrollbar-width: none;
  }
  .report-tabs::-webkit-scrollbar {
    display: none;
  }
  .report-tab {
    display: inline-flex;
    min-height: 2.25rem;
    flex: none;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    outline: none;
    transition:
      color 150ms ease,
      background-color 150ms ease,
      border-color 150ms ease;
  }
  .report-tab:hover {
    color: var(--color-foreground);
    background: var(--color-surface-2);
  }
  .report-tab[aria-selected='true'] {
    border-color: color-mix(in srgb, var(--report-accent) 55%, transparent);
    background: color-mix(in srgb, var(--report-accent) 14%, transparent);
    color: var(--report-accent);
  }
  .report-tab:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .report-panel {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
  }

  .report-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-top: 0.35rem;
  }

  @media (max-width: 560px) {
    .report-hero-score {
      justify-items: start;
      text-align: left;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .report-tab {
      transition: none;
    }
  }
</style>
