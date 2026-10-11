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

  const games = $derived(comparison.games);
  const values = $derived(games.flatMap((game) => [game.havoc.humanScore, game.normal.humanScore]));
  const minValue = $derived(Math.min(0, ...values));
  const maxValue = $derived(Math.max(10, ...values));
  const maxDelta = $derived(Math.max(1, ...games.map((game) => Math.abs(game.deltas.pointsFor))));
  const width = 820;
  const plotLeft = 34;
  const plotRight = 812;
  const plotTop = 12;
  const plotBottom = 152;
  const deltaCenter = 186;
  const deltaAmplitude = 30;

  function xFor(index: number): number {
    const span = plotRight - plotLeft;
    return plotLeft + (index * span) / Math.max(1, games.length - 1);
  }

  function yFor(points: number): number {
    const ratio = (points - minValue) / Math.max(1, maxValue - minValue);
    return plotBottom - ratio * (plotBottom - plotTop);
  }

  const havocPolyline = $derived(
    games
      .map((game, index) => `${xFor(index).toFixed(1)},${yFor(game.havoc.humanScore).toFixed(1)}`)
      .join(' '),
  );
  const normalPolyline = $derived(
    games
      .map((game, index) => `${xFor(index).toFixed(1)},${yFor(game.normal.humanScore).toFixed(1)}`)
      .join(' '),
  );
  const selectedIndex = $derived(
    selectedGame === null
      ? 0
      : Math.max(
          0,
          games.findIndex((game) => game.gameNumber === selectedGame),
        ),
  );
  const selectedDetail = $derived(games[selectedIndex] ?? null);

  function selectIndex(index: number): void {
    const game = games[Math.min(games.length - 1, Math.max(0, index))];
    if (game !== undefined) onSelect(game.gameNumber);
  }
</script>

<figure class="min-w-0" data-havoc-comparison-chart>
  <figcaption class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
    <span class="inline-flex items-center gap-1.5">
      <span aria-hidden="true" class="inline-block h-2 w-4 rounded-full bg-[#37B7CC]"></span>
      Havoc points
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span aria-hidden="true" class="inline-block h-2 w-4 rounded-full bg-muted-foreground"></span>
      Normal points
    </span>
    <span class="inline-flex items-center gap-1.5">
      <span aria-hidden="true" class="inline-block h-2 w-4 rounded-full bg-primary"></span>
      Points delta (havoc − normal)
    </span>
    <span>Select a game for both scorelines.</span>
  </figcaption>
  <div
    class="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg bg-surface-2 p-2"
    data-havoc-chart-navigator
  >
    <button
      type="button"
      onclick={() => selectIndex(selectedIndex - 1)}
      disabled={selectedIndex <= 0}
      aria-label="Previous game"
      class="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 font-mono text-xs font-bold outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      ← Prev
    </button>
    <label class="flex min-w-28 flex-col items-center gap-1">
      <span class="sr-only">Choose game</span>
      <select
        value={selectedDetail?.gameNumber ?? 1}
        onchange={(event) => onSelect(Number((event.currentTarget as HTMLSelectElement).value))}
        class="min-h-11 w-full touch-manipulation rounded-lg border border-border bg-surface-1 px-2 py-2 text-center text-base font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-havoc-chart-select
      >
        {#each games as game (game.gameNumber)}
          <option value={game.gameNumber}>Game {game.gameNumber}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      onclick={() => selectIndex(selectedIndex + 1)}
      disabled={selectedIndex >= games.length - 1}
      aria-label="Next game"
      class="inline-flex min-h-11 touch-manipulation items-center justify-center rounded-lg border border-border px-3 py-2 font-mono text-xs font-bold outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      Next →
    </button>
  </div>
  {#if selectedDetail !== null}
    <p class="mt-2 text-xs text-muted-foreground" data-havoc-chart-selected>
      Game {selectedDetail.gameNumber}: Havoc {selectedDetail.havoc.humanScore}–{selectedDetail
        .havoc.opponentScore}, Normal {selectedDetail.normal.humanScore}–{selectedDetail.normal
        .opponentScore}
    </p>
  {/if}
  <div class="havoc-scroll-x mt-2 overflow-x-auto rounded-lg border border-border/50">
    <svg
      viewBox="0 0 {width} 224"
      role="group"
      aria-label="Per-game points for the Havoc and Normal seasons across 82 games"
      class="w-full min-w-[38rem] touch-manipulation sm:min-w-[46rem]"
    >
      <line
        x1={plotLeft}
        y1={plotBottom}
        x2={plotRight}
        y2={plotBottom}
        stroke="currentColor"
        class="text-border"
      />
      <polyline
        points={normalPolyline}
        fill="none"
        stroke="currentColor"
        class="text-muted-foreground"
        stroke-width="1.5"
        stroke-dasharray="4 3"
      />
      <polyline points={havocPolyline} fill="none" stroke="#37B7CC" stroke-width="2" />
      <line
        x1={plotLeft}
        y1={deltaCenter}
        x2={plotRight}
        y2={deltaCenter}
        stroke="currentColor"
        class="text-border"
      />
      {#each games as game, index (game.gameNumber)}
        {@const delta = game.deltas.pointsFor}
        {@const barHeight = (Math.abs(delta) / maxDelta) * deltaAmplitude}
        <rect
          x={xFor(index) - 3}
          y={delta >= 0 ? deltaCenter - barHeight : deltaCenter}
          width="6"
          height={Math.max(1, barHeight)}
          rx="1"
          fill={delta >= 0 ? 'var(--color-primary)' : 'var(--color-destructive)'}
          opacity={selectedGame === game.gameNumber ? '1' : '0.6'}
        />
        <rect
          x={xFor(index) - 7}
          y={plotTop}
          width="14"
          height={212}
          fill={selectedGame === game.gameNumber ? 'currentColor' : 'transparent'}
          opacity={selectedGame === game.gameNumber ? '0.12' : '0'}
          class="text-primary"
          role="button"
          tabindex="0"
          aria-label="Game {game.gameNumber}: Havoc {game.havoc.humanScore}, Normal {game.normal
            .humanScore}. View details"
          data-havoc-chart-game={game.gameNumber}
          onclick={() => onSelect(game.gameNumber)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(game.gameNumber);
            }
          }}
        />
      {/each}
    </svg>
  </div>
</figure>
