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

<div data-havoc-comparison-table>
  <ul class="flex flex-col gap-2 sm:hidden" data-havoc-comparison-table-mobile>
    {#each comparison.games as game (game.gameNumber)}
      <li
        class="rounded-lg bg-surface-2 p-3 {selectedGame === game.gameNumber
          ? 'border border-primary/50'
          : 'border border-transparent'}"
        data-havoc-matched-game-mobile={game.gameNumber}
        aria-current={selectedGame === game.gameNumber ? 'true' : undefined}
      >
        <p class="flex items-baseline justify-between gap-2">
          <span class="font-mono text-xs font-bold"
            >Game {game.gameNumber} · {game.humanHome ? 'Home' : 'Away'}</span
          >
          <span class="truncate text-xs text-muted-foreground">{game.opponentId}</span>
        </p>
        <p class="mt-1.5 grid grid-cols-2 gap-2 text-xs">
          <span class="rounded bg-surface-3/60 px-2 py-1.5 text-center font-mono">
            H {game.havoc.humanScore}–{game.havoc.opponentScore}
            {game.havoc.outcome === 'win' ? 'W' : 'L'}
          </span>
          <span class="rounded bg-surface-3/60 px-2 py-1.5 text-center font-mono">
            N {game.normal.humanScore}–{game.normal.opponentScore}
            {game.normal.outcome === 'win' ? 'W' : 'L'}
          </span>
        </p>
        <p
          class="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground"
        >
          <span>Δ for {game.deltas.pointsFor} · Δ margin {game.deltas.margin}</span>
          <span>
            {#if game.flips.havocWinNormalLoss}
              H flip
            {:else if game.flips.normalWinHavocLoss}
              N flip
            {:else}
              —
            {/if}
          </span>
        </p>
        <button
          type="button"
          aria-pressed={selectedGame === game.gameNumber}
          aria-label="View game {game.gameNumber} details"
          onclick={() => onSelect(game.gameNumber)}
          class="mt-2 inline-flex min-h-11 w-full touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 font-mono text-[11px] font-bold uppercase outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring"
        >
          View
        </button>
      </li>
    {/each}
  </ul>
  <div class="havoc-scroll-x hidden overflow-x-auto sm:block">
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
                class="min-h-11 min-w-11 touch-manipulation rounded border border-border px-3 py-2 font-mono text-[10px] font-bold uppercase outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
              >
                View
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
