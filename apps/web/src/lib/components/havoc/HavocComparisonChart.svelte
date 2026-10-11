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
  const values = $derived(
    games.flatMap((game) => [game.havoc.humanScore, game.normal.humanScore]),
  );
  const minValue = $derived(Math.min(0, ...values));
  const maxValue = $derived(Math.max(10, ...values));
  const maxDelta = $derived(
    Math.max(1, ...games.map((game) => Math.abs(game.deltas.pointsFor))),
  );
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
    games.map((game, index) => `${xFor(index).toFixed(1)},${yFor(game.havoc.humanScore).toFixed(1)}`).join(' '),
  );
  const normalPolyline = $derived(
    games.map((game, index) => `${xFor(index).toFixed(1)},${yFor(game.normal.humanScore).toFixed(1)}`).join(' '),
  );
</script>

<figure class="min-w-0" data-havoc-comparison-chart>
  <figcaption class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
  <div class="mt-2 overflow-x-auto">
    <svg
      viewBox="0 0 {width} 224"
      role="group"
      aria-label="Per-game points for the Havoc and Normal seasons across 82 games"
      class="min-w-[46rem] w-full"
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
      <polyline
        points={havocPolyline}
        fill="none"
        stroke="#37B7CC"
        stroke-width="2"
      />
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
          x={xFor(index) - 2.5}
          y={delta >= 0 ? deltaCenter - barHeight : deltaCenter}
          width="5"
          height={Math.max(1, barHeight)}
          rx="1"
          fill={delta >= 0 ? 'var(--color-primary)' : 'var(--color-destructive)'}
          opacity={selectedGame === game.gameNumber ? '1' : '0.6'}
        />
        <rect
          x={xFor(index) - 4}
          y={plotTop}
          width="8"
          height={212}
          fill={selectedGame === game.gameNumber ? 'currentColor' : 'transparent'}
          opacity={selectedGame === game.gameNumber ? '0.12' : '0'}
          class="text-primary"
          role="button"
          tabindex="0"
          aria-label="Game {game.gameNumber}: Havoc {game.havoc.humanScore}, Normal {game.normal.humanScore}. View details"
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
