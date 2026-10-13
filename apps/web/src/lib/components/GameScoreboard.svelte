<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { GameScoreboardTeam } from './game-scoreboard';
  let {
    teams,
    status = null,
    team = null,
    layout = 'inline',
    label = 'Game score',
    ariaLive = 'off',
    class: className = '',
  }: {
    teams: readonly [GameScoreboardTeam, GameScoreboardTeam];
    status?: Snippet | null;
    team?: Snippet<[GameScoreboardTeam]> | null;
    layout?: 'inline' | 'duo';
    label?: string;
    ariaLive?: 'off' | 'polite' | 'assertive';
    class?: string;
  } = $props();
</script>

{#snippet teamCell(entry: GameScoreboardTeam)}
  {#if team !== null}
    {@render team(entry)}
  {:else}
    <div
      class="ui-scoreboard-team"
      data-align={entry.align ?? 'center'}
      data-winner={entry.winner === true}
    >
      <span class="ui-scoreboard-label">{entry.label}</span>
      {#key entry.score}
        <strong class="ui-scoreboard-score">{entry.score}</strong>
      {/key}
    </div>
  {/if}
{/snippet}

<div
  class={['ui-scoreboard', className]}
  data-layout={layout}
  aria-label={label}
  aria-live={ariaLive}
  role="group"
>
  {#if layout === 'inline'}
    {@render teamCell(teams[0])}
    {#if status !== null}{@render status()}{/if}
    {@render teamCell(teams[1])}
  {:else}
    {@render teamCell(teams[0])}
    {@render teamCell(teams[1])}
    {#if status !== null}{@render status()}{/if}
  {/if}
</div>
