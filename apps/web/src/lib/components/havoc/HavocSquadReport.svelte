<script lang="ts">
  import {
    HAVOC_GAME_COUNT,
    type HavocComparison,
    type HavocStatLine,
  } from '@hoop-rush/data-contracts';
  import type { HavocLineupSlotView } from '$lib/havoc/havoc-service-contract';
  import HavocPlayerArt from './HavocPlayerArt.svelte';
  let {
    comparison,
    lineup,
  }: { comparison: HavocComparison; lineup: readonly HavocLineupSlotView[] } = $props();
  const stats = [
    { key: 'points', label: 'PTS' },
    { key: 'rebounds', label: 'REB' },
    { key: 'assists', label: 'AST' },
    { key: 'steals', label: 'STL' },
    { key: 'blocks', label: 'BLK' },
    { key: 'turnovers', label: 'TO' },
  ] as const;
  const shooting = [
    { key: 'fieldGoals', label: 'FG%' },
    { key: 'threes', label: '3P%' },
    { key: 'freeThrows', label: 'FT%' },
  ] as const;
  function average(value: number) {
    return (value / HAVOC_GAME_COUNT).toFixed(1);
  }
  function total(line: HavocStatLine, key: (typeof stats)[number]['key']) {
    return key === 'rebounds' ? line.rebounds.total : line[key];
  }
  function change(value: number) {
    return `${value > 0 ? '+' : ''}${(value / HAVOC_GAME_COUNT).toFixed(1)}`;
  }
  function shootingChange(
    havoc: HavocStatLine,
    normal: HavocStatLine,
    key: (typeof shooting)[number]['key'],
  ): number | null {
    if (havoc[key].attempted === 0 || normal[key].attempted === 0) return null;
    return (
      (havoc[key].made / havoc[key].attempted - normal[key].made / normal[key].attempted) * 100
    );
  }
  function percent(line: HavocStatLine, key: (typeof shooting)[number]['key']) {
    return line[key].attempted === 0
      ? '—'
      : ((line[key].made / line[key].attempted) * 100).toFixed(1);
  }
</script>

<section class="mt-8" aria-labelledby="h-squad-report" data-havoc-squad-report>
  <div class="h-header">
    <div>
      <p class="h-eyebrow">Your five · Season stats</p>
      <h2 id="h-squad-report" class="h-subtitle mt-2">With powers. Without powers.</h2>
      <p class="h-copy mt-2">
        Per-game averages across both 82-game seasons. Each position includes its starter,
        replacement, and any clone.
      </p>
    </div>
    <div class="h-legend"><span>Havoc</span><span>Normal</span><span>Change</span></div>
  </div>
  <div class="h-performance-grid">
    {#each comparison.slots as player (player.slot)}
      {@const source = lineup.find((slot) => slot.slot === player.slot)}
      <article class="h-panel h-performance" data-havoc-player-stats={player.slot}>
        <header class="flex items-center gap-4">
          <HavocPlayerArt
            playerId={player.playerId}
            displayName={player.displayName}
            franchiseId={source?.franchiseId}
            seasonKey={source?.seasonKey}
          />
          <div>
            <p class="h-eyebrow">{player.slot}</p>
            <h3 class="h-subtitle">{player.displayName}</h3>
            <p class="h-copy text-xs">{source?.nickname ?? ''}</p>
          </div>
        </header>
        <div class="h-stat-columns" aria-hidden="true">
          <span>Per game</span><span>Havoc</span><span>Normal</span><span>Change</span>
        </div>
        <dl>
          {#each stats as stat (stat.key)}{@const delta = player.deltas[stat.key]}
            <div class="h-stat-columns" data-havoc-stat={stat.key}>
              <dt>{stat.label}</dt>
              <dd class="h-powered">{average(total(player.havoc.combined, stat.key))}</dd>
              <dd>{average(total(player.normal.combined, stat.key))}</dd>
              <dd
                class:better={stat.key === 'turnovers' ? delta < 0 : delta > 0}
                class:worse={stat.key === 'turnovers' ? delta > 0 : delta < 0}
              >
                {change(delta)}
              </dd>
            </div>{/each}
          {#each shooting as stat (stat.label)}
            {@const delta = shootingChange(player.havoc.combined, player.normal.combined, stat.key)}
            <div class="h-stat-columns">
              <dt>{stat.label}</dt>
              <dd class="h-powered">{percent(player.havoc.combined, stat.key)}</dd>
              <dd>{percent(player.normal.combined, stat.key)}</dd>
              <dd
                class:better={delta !== null && delta > 0}
                class:worse={delta !== null && delta < 0}
              >
                {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pp`}
              </dd>
            </div>{/each}
        </dl>
      </article>
    {/each}
  </div>
</section>

<style>
  .h-performance-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .h-stat-columns {
    display: grid;
    grid-template-columns: 1fr repeat(3, 0.8fr);
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid #3c486b;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .h-stat-columns > :not(:first-child) {
    text-align: right;
  }
  .h-stat-columns[aria-hidden] {
    margin-top: 12px;
    font-size: 10px;
    color: #aab9db;
  }
  .h-stat-columns dt {
    color: #c1cae4;
    font-size: 11px;
    font-weight: 700;
  }
  .h-stat-columns dd {
    color: #aab9db;
  }
  .h-stat-columns .h-powered {
    color: #ffd782;
    font-weight: 800;
  }
  .h-stat-columns .better {
    color: #8bceaf;
  }
  .h-stat-columns .worse {
    color: #f290c5;
  }
  .h-legend {
    display: flex;
    gap: 18px;
    font-size: 12px;
  }
  .h-legend span:first-child {
    color: #ffd782;
  }
  .h-legend span:nth-child(2) {
    color: #aab9db;
  }
  .h-legend span:last-child {
    color: #8bceaf;
  }
  @media (max-width: 760px) {
    .h-performance-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
