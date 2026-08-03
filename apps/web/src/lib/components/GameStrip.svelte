<script lang="ts">
  import { untrack } from 'svelte';
  import type { ChallengeRun, GameResult } from '@hoop-rush/data-contracts';

  /**
   * The signature M3 progress element: an 82-cell strip that fills from left
   * to right as games are committed. Wins, losses, and the first eliminating
   * loss are highlighted; upcoming games stay muted. The strip is
   * presentation-only: revealed results come from accepted run state.
   */

  let {
    run,
    games,
    compact = false,
  }: {
    run: ChallengeRun;
    games: GameResult[];
    compact?: boolean;
  } = $props();

  const firstLoss = $derived(run.firstLossGameNumber);

  /**
   * Opponent display names keyed by opponentId. The bracket is fixed for the
   * mounted run, so this is built once via untrack: during the paced reveal
   * the run prop reassigns every reveal but the bracket never changes.
   */
  const opponentNames = $derived(
    untrack(() => new Map(run.bracket.opponents.map((o) => [o.opponentId, o.displayName]))),
  );

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

  /** Opponent display name for one game number. */
  function opponentName(gameNumber: number): string {
    const opponentId = run.bracket.schedule[gameNumber - 1]?.opponentId;
    return (
      (opponentId === undefined ? undefined : opponentNames.get(opponentId)) ??
      opponentId ??
      'Unknown'
    );
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
        class="block aspect-square w-full rounded-[3px] transition-colors {cell.result === undefined
          ? 'bg-surface-3/70'
          : cell.isFirstLoss
            ? 'bg-destructive shadow-[0_0_0_2px_hsl(var(--destructive))]'
            : cell.won
              ? 'bg-primary/80'
              : 'bg-destructive/70'}"
      ></button>
    </li>
  {/each}
</ol>
