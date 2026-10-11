<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';

  let {
    comparison,
    selectedGame,
    onSelect,
  }: {
    comparison: HavocComparison;
    selectedGame: number | null;
    onSelect: (gameNumber: number) => void;
  } = $props();
</script>

<div class="overflow-x-auto" data-havoc-comparison-table>
  <table class="w-full min-w-[46rem] text-xs">
    <caption class="sr-only"> Matched Havoc and Normal results for all 82 games </caption>
    <thead>
      <tr
        class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
      >
        <th scope="col" class="px-2 py-1.5 text-left font-medium">Game</th>
        <th scope="col" class="px-2 py-1.5 text-left font-medium">Opponent</th>
        <th scope="col" class="px-2 py-1.5 text-left font-medium">Venue</th>
        <th scope="col" class="px-2 py-1.5 text-right font-medium">Havoc</th>
        <th scope="col" class="px-2 py-1.5 text-right font-medium">Normal</th>
        <th scope="col" class="px-2 py-1.5 text-right font-medium">Δ for</th>
        <th scope="col" class="px-2 py-1.5 text-right font-medium">Δ margin</th>
        <th scope="col" class="px-2 py-1.5 text-left font-medium">Flip</th>
        <th scope="col" class="px-2 py-1.5 text-right font-medium">
          <span class="sr-only">Details</span>
        </th>
      </tr>
    </thead>
    <tbody>
      {#each comparison.games as game (game.gameNumber)}
        <tr
          class="border-b border-border/40"
          data-havoc-matched-game={game.gameNumber}
          aria-current={selectedGame === game.gameNumber ? 'true' : undefined}
        >
          <th scope="row" class="px-2 py-1.5 text-left font-mono">{game.gameNumber}</th>
          <td class="px-2 py-1.5">{game.opponentId}</td>
          <td class="px-2 py-1.5">{game.humanHome ? 'Home' : 'Away'}</td>
          <td class="px-2 py-1.5 text-right font-mono">
            {game.havoc.humanScore}–{game.havoc.opponentScore}
            <span class="text-muted-foreground">{game.havoc.outcome === 'win' ? 'W' : 'L'}</span>
          </td>
          <td class="px-2 py-1.5 text-right font-mono">
            {game.normal.humanScore}–{game.normal.opponentScore}
            <span class="text-muted-foreground">{game.normal.outcome === 'win' ? 'W' : 'L'}</span>
          </td>
          <td class="px-2 py-1.5 text-right font-mono">{game.deltas.pointsFor}</td>
          <td class="px-2 py-1.5 text-right font-mono">{game.deltas.margin}</td>
          <td class="px-2 py-1.5">
            {#if game.flips.havocWinNormalLoss}
              Havoc win → Normal loss
            {:else if game.flips.normalWinHavocLoss}
              Normal win → Havoc loss
            {:else}
              —
            {/if}
          </td>
          <td class="px-2 py-1.5 text-right">
            <button
              type="button"
              aria-pressed={selectedGame === game.gameNumber}
              aria-label="View game {game.gameNumber} details"
              onclick={() => onSelect(game.gameNumber)}
              class="min-h-8 rounded border border-border px-2 py-0.5 font-mono text-[10px] font-bold uppercase outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              View
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
