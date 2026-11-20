<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { SeriesRecapGame } from '../ui/types';

  let {
    games,
    onselect = undefined,
    label = 'Game recap',
    class: className = '',
    ...rest
  }: {
    games: readonly SeriesRecapGame[];
    onselect?: ((gameNumber: number) => void) | undefined;
    label?: string;
  } & Omit<HTMLAttributes<HTMLOListElement>, 'onselect'> = $props();
</script>

{#snippet rowContent(game: SeriesRecapGame)}
  <span class="ui-series-recap-game">G{game.gameNumber}</span>
  <span class="ui-series-recap-result">{game.won ? 'W' : 'L'}</span>
  <span class="ui-series-recap-score">{game.score}</span>
  {#if game.overtime === true}
    <span class="ui-series-recap-ot">OT</span>
  {/if}
  {#if game.standout !== null && game.standout !== undefined}
    <span class="ui-series-recap-standout">{game.standout}</span>
  {/if}
  {#if game.note !== null && game.note !== undefined}
    <span class="ui-series-recap-note">{game.note}</span>
  {/if}
{/snippet}

<ol {...rest} class={['ui-series-recap', className]} aria-label={label}>
  {#each games as game (game.gameNumber)}
    <li class="ui-series-recap-item">
      {#if onselect !== undefined}
        <button
          type="button"
          class="ui-series-recap-row"
          data-result={game.won ? 'win' : 'loss'}
          onclick={() => onselect(game.gameNumber)}
        >
          {@render rowContent(game)}
        </button>
      {:else}
        <div class="ui-series-recap-row" data-result={game.won ? 'win' : 'loss'}>
          {@render rowContent(game)}
        </div>
      {/if}
    </li>
  {/each}
</ol>
