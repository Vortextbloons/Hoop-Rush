<script lang="ts">import { untrack } from 'svelte';
import type { ChallengeRun, GameResult } from '@hoop-rush/data-contracts';
let { run, games, compact = false, }: {
    run: ChallengeRun;
    games: GameResult[];
    compact?: boolean;
} = $props();
const firstLoss = $derived(run.firstLossGameNumber);
const opponentNames = $derived(untrack(() => new Map(run.bracket.opponents.map((o) => [o.opponentId, o.displayName]))));
const cells = $derived.by(() => {
    const byGame = new Map(games.map((g) => [g.gameNumber, g]));
    return Array.from({ length: 82 }, (_, index) => {
        const gameNumber = index + 1;
        const result = byGame.get(gameNumber);
        return {
            gameNumber,
            result,
            won: result?.winner === 'home',
            lost: result?.winner === 'away',
            isFirstLoss: result !== undefined && firstLoss !== null && gameNumber === firstLoss,
        };
    });
});
function opponentName(gameNumber: number): string {
    const opponentId = run.bracket.schedule[gameNumber - 1]?.opponentId;
    return ((opponentId === undefined ? undefined : opponentNames.get(opponentId)) ??
        opponentId ??
        'Unknown');
}
</script>

<ol
  class="grid w-full gap-[3px] {compact
    ? 'grid-cols-41'
    : 'grid-cols-14 sm:grid-cols-21 md:grid-cols-41'}"
  aria-label="82-game strip"
>
  {#each cells as cell (cell.gameNumber)}
    <li>
      <button
        type="button"
        tabindex="-1"
        aria-hidden={cell.result === undefined}
        title={cell.result === undefined
          ? `Game ${cell.gameNumber} upcoming`
          : `Game ${cell.gameNumber} vs ${opponentName(cell.gameNumber)}: ${cell.result?.home.box.points ?? 0}-${cell.result?.away.box.points ?? 0} ${cell.won ? 'W' : 'L'}`}
        class="block aspect-square w-full rounded-[3px] {cell.result === undefined
          ? 'bg-surface-3/70'
          : cell.isFirstLoss
            ? 'bg-destructive ring-2 ring-inset ring-destructive'
            : cell.won
              ? 'bg-primary/80'
              : 'bg-destructive/70'}"
      ></button>
    </li>
  {/each}
</ol>
