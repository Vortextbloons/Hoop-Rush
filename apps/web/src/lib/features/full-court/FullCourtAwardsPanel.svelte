<script lang="ts">
  import type {
    FullCourtAwardResult,
    FullCourtAwardsBoard,
    FullCourtPlayerSeasonRow,
  } from '@hoop-rush/engine';
  import { Award, Crown, Shield, Sparkles, Trophy } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  let {
    awards,
    rosterStats,
    userTeamId,
    art = null,
  }: {
    awards: FullCourtAwardsBoard;
    rosterStats: readonly FullCourtPlayerSeasonRow[];
    userTeamId: string;
    art?: FullCourtArt | null;
  } = $props();

  let statScope = $state<'team' | 'leaders'>('team');
  let leaderCategory = $state<
    'scoring' | 'rebounding' | 'assists' | 'steals' | 'blocks' | 'threes'
  >('scoring');

  const awardCards = $derived<FullCourtAwardResult[]>([
    awards.mvp,
    awards.dpoy,
    awards.sixthMan,
    awards.scoringChamp,
    awards.finalsMvp,
  ]);

  const activeLeaders = $derived(awards.leaders[leaderCategory]);

  function pctText(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }
</script>

<Panel as="section" padding="md" aria-label="Full Court awards and races">
  <SectionHeading
    eyebrow="Hardware"
    title={awards.regularComplete ? 'Season Awards' : 'Awards Race'}
    level={2}
    size="md"
    description={awards.regularComplete
      ? 'Final regular-season and postseason honors across all 30 franchises.'
      : 'Live MVP, Defensive Player of the Year, and Sixth Man standings.'}
  >
    {#snippet actions()}
      <Badge tone={awards.regularComplete ? 'positive' : 'accent'}>
        {awards.regularComplete ? 'Finalized' : 'Live race'}
      </Badge>
    {/snippet}
  </SectionHeading>

  {#if !awards.hasPlayerStats}
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
      Simulate at least one game to populate player averages, league leaders, and award races.
    </p>
  {:else}
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each awardCards as award (award.id)}
        {@const winner = award.winner}
        {@const isUser = winner?.player.teamId === userTeamId}
        <article
          class="flex flex-col justify-between rounded-xl border p-3.5 {isUser
            ? 'border-accent/60 bg-accent/10'
            : 'border-line-soft bg-surface-2/60'}"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p
                class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
              >
                {award.subtitle}
              </p>
              <h3 class="font-display mt-0.5 text-lg font-extrabold tracking-tight uppercase">
                {award.title}
              </h3>
            </div>
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-surface-1 text-accent"
            >
              {#if award.id === 'mvp'}
                <Crown size={16} aria-hidden="true" />
              {:else if award.id === 'dpoy'}
                <Shield size={16} aria-hidden="true" />
              {:else if award.id === 'sixth-man'}
                <Sparkles size={16} aria-hidden="true" />
              {:else if award.id === 'finals-mvp'}
                <Trophy size={16} aria-hidden="true" />
              {:else}
                <Award size={16} aria-hidden="true" />
              {/if}
            </span>
          </div>

          {#if winner === null}
            <p class="mt-3 text-xs text-muted-foreground">
              {award.id === 'finals-mvp'
                ? 'Crowned once the NBA Finals conclude.'
                : 'No qualified candidates yet.'}
            </p>
          {:else}
            <div class="mt-3 flex items-center gap-3 border-t border-line-soft/70 pt-2.5">
              <FullCourtPortrait player={winner.player} {art} size="md" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <p class="truncate text-sm font-bold text-foreground">
                    {winner.player.displayName}
                  </p>
                  {#if isUser}
                    <Badge tone="primary">Your team</Badge>
                  {/if}
                </div>
                <p class="font-mono text-[10px] text-muted-foreground uppercase">
                  {winner.player.teamName}
                </p>
                <p class="mt-1 text-xs font-semibold text-foreground">{winner.summary}</p>
              </div>
            </div>
            {#if award.finalists.length > 1}
              <ol class="mt-2.5 space-y-1 border-t border-line-soft/50 pt-2">
                {#each award.finalists.slice(1) as runnerUp, idx (runnerUp.player.playerId)}
                  <li
                    class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span class="truncate">
                      {idx + 2}.
                      <strong class="text-foreground/90">{runnerUp.player.displayName}</strong>
                      · {runnerUp.player.teamName}
                    </span>
                    <span class="shrink-0 font-mono text-[10px] tabular-nums">
                      {runnerUp.player.ppg.toFixed(1)}p
                    </span>
                  </li>
                {/each}
              </ol>
            {/if}
          {/if}
        </article>
      {/each}
    </div>

    {#if awards.allLeagueFirst.length > 0}
      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        {#each [{ title: 'All-League First Team', players: awards.allLeagueFirst }, { title: 'All-League Second Team', players: awards.allLeagueSecond }] as squad (squad.title)}
          {#if squad.players.length > 0}
            <div class="rounded-xl border border-line-soft bg-surface-2/40 p-3">
              <p class="ui-label text-muted-foreground">{squad.title}</p>
              <ul class="mt-2 space-y-1.5">
                {#each squad.players as player (player.playerId + player.teamId)}
                  <li class="flex items-center justify-between gap-2 text-xs">
                    <span class="min-w-0 truncate">
                      <strong
                        class={player.teamId === userTeamId ? 'text-primary' : 'text-foreground'}
                      >
                        {player.displayName}
                      </strong>
                      <span class="text-muted-foreground"> · {player.teamName}</span>
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {player.ppg.toFixed(1)}p / {player.rpg.toFixed(1)}r / {player.apg.toFixed(1)}a
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</Panel>

{#if awards.hasPlayerStats}
  <Panel as="section" padding="md" aria-label="Full Court player stats and leaders">
    <SectionHeading
      eyebrow="Box Scores"
      title={statScope === 'team' ? 'Your Roster Averages' : 'League Stat Leaders'}
      level={2}
      size="md"
    >
      {#snippet actions()}
        <SegmentedControl
          label="Choose player stats view"
          size="md"
          value={statScope}
          onchange={(value) => (statScope = value)}
          options={[
            { value: 'team', label: 'Your Team' },
            { value: 'leaders', label: 'League Leaders' },
          ]}
        />
      {/snippet}
    </SectionHeading>

    {#if statScope === 'leaders'}
      <div class="mt-3 flex flex-wrap gap-1.5">
        {#each [{ id: 'scoring', label: 'PPG' }, { id: 'rebounding', label: 'RPG' }, { id: 'assists', label: 'APG' }, { id: 'steals', label: 'SPG' }, { id: 'blocks', label: 'BPG' }, { id: 'threes', label: '3PM/G' }] as cat (cat.id)}
          <button
            type="button"
            onclick={() =>
              (leaderCategory = cat.id as
                'scoring' | 'rebounding' | 'assists' | 'steals' | 'blocks' | 'threes')}
            class="rounded-lg border px-2.5 py-1 font-mono text-[10px] font-bold uppercase transition-colors {leaderCategory ===
            cat.id
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-line-soft bg-surface-2 text-muted-foreground hover:text-foreground'}"
          >
            {cat.label}
          </button>
        {/each}
      </div>
    {/if}

    {@const tableRows = statScope === 'team' ? rosterStats : activeLeaders}
    <div class="mt-3 overflow-x-auto">
      <table class="ui-stats-table" aria-label="Player season averages">
        <thead>
          <tr>
            <th scope="col" data-align="start">Player</th>
            {#if statScope === 'leaders'}
              <th scope="col" data-align="start">Team</th>
            {/if}
            <th scope="col">GP</th>
            <th scope="col">MPG</th>
            <th scope="col">PPG</th>
            <th scope="col">RPG</th>
            <th scope="col">APG</th>
            <th scope="col">SPG</th>
            <th scope="col">BPG</th>
            <th scope="col">FG%</th>
            <th scope="col">3P%</th>
            <th scope="col">TS%</th>
          </tr>
        </thead>
        <tbody>
          {#each tableRows as row (row.teamId + row.playerId)}
            <tr class={row.teamId === userTeamId ? 'bg-primary/5' : ''}>
              <th scope="row" data-align="start">
                <span class="flex items-center gap-2">
                  <FullCourtPortrait player={row} {art} size="sm" />
                  <span class={row.teamId === userTeamId ? 'text-primary' : ''}>
                    {row.displayName}
                  </span>
                </span>
              </th>
              {#if statScope === 'leaders'}
                <td data-align="start" class="text-muted-foreground">{row.teamName}</td>
              {/if}
              <td>{row.games}</td>
              <td>{row.mpg.toFixed(1)}</td>
              <td class="font-bold text-foreground">{row.ppg.toFixed(1)}</td>
              <td>{row.rpg.toFixed(1)}</td>
              <td>{row.apg.toFixed(1)}</td>
              <td>{row.spg.toFixed(1)}</td>
              <td>{row.bpg.toFixed(1)}</td>
              <td>{pctText(row.fgPct)}</td>
              <td>{pctText(row.tpPct)}</td>
              <td>{pctText(row.tsPct)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Panel>
{/if}
