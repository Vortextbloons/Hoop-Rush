<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { BoxScoreTeam } from '../ui/types';

  let {
    label,
    teams,
    class: className = '',
    children,
    ...rest
  }: {
    label: string;
    teams: readonly BoxScoreTeam[];
    children: Snippet;
  } & Omit<HTMLAttributes<HTMLElement>, 'children'> = $props();

  const periodCount = $derived(
    teams.reduce((max, team) => Math.max(max, team.periods?.length ?? 0), 0),
  );
  const periodHeaders = $derived(Array.from({ length: periodCount }, (_, index) => index + 1));
</script>

<section {...rest} class={['ui-box-score', className]} aria-label={label}>
  <p class="ui-box-score-heading">{label}</p>
  <div class="ui-box-score-teams">
    {#each teams as team, index (index)}
      <div class="ui-box-score-team" data-user={team.isUser === true ? 'true' : undefined}>
        {#if team.logo !== undefined}
          <span class="ui-box-score-logo">{@render team.logo()}</span>
        {/if}
        <span class="ui-box-score-name">{team.name}</span>
      </div>
    {/each}
  </div>
  {#if periodCount > 0}
    <div class="ui-box-score-scroll">
      <table class="ui-stats-table ui-box-score-periods">
        <caption class="sr-only">{label} scoring by period</caption>
        <thead>
          <tr>
            <th scope="col" data-align="start">Team</th>
            {#each periodHeaders as period (period)}
              <th scope="col">P{period}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each teams as team, index (index)}
            <tr data-user={team.isUser === true ? 'true' : undefined}>
              <th scope="row" data-align="start" class="ui-box-score-team">{team.name}</th>
              {#each periodHeaders as period (period)}
                <td>{team.periods?.[period - 1] ?? '—'}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="ui-box-score-body">{@render children()}</div>
</section>
