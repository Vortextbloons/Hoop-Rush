<script lang="ts">
  import { Dialog } from 'bits-ui';
  import {
    HAVOC_GAME_COUNT,
    type HavocComparison,
    type HavocStatLine,
  } from '@hoop-rush/data-contracts';
  import type { HavocLineupSlotView } from '@hoop-rush/application/havoc';
  import {
    havocMvpFormulaLabel,
    mutationNameOf,
    mutationDescriptionOf,
    mutationDownsideOf,
    mutationTierOf,
    formatSignedPoints,
  } from './havoc-presentation';
  import { trueShootingRate } from '#lib/format.js';
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import Panel from '#lib/components/ui/Panel.svelte';
  let {
    comparison,
    lineup,
  }: { comparison: HavocComparison; lineup: readonly HavocLineupSlotView[] } = $props();
  type SquadRow = HavocComparison['slots'][number];
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
    const rounded = Number((value / HAVOC_GAME_COUNT).toFixed(1));
    return `${rounded > 0 ? '+' : ''}${rounded === 0 ? '0.0' : rounded.toFixed(1)}`;
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
  function usageOf(line: HavocStatLine): number {
    return line.fieldGoals.attempted + 0.44 * line.freeThrows.attempted + line.turnovers;
  }
  const havocTeamUsage = $derived(
    comparison.slots.reduce((sum, slot) => sum + usageOf(slot.havoc.combined), 0),
  );
  const normalTeamUsage = $derived(
    comparison.slots.reduce((sum, slot) => sum + usageOf(slot.normal.combined), 0),
  );
  function usageShare(line: HavocStatLine, teamTotal: number): string {
    if (teamTotal <= 0) return '—';
    return ((usageOf(line) / teamTotal) * 100).toFixed(1);
  }
  function usageChange(havoc: HavocStatLine, normal: HavocStatLine): string {
    const delta = usageDelta(havoc, normal);
    return delta === null ? '—' : `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp`;
  }
  function usageDelta(havoc: HavocStatLine, normal: HavocStatLine): number | null {
    if (havocTeamUsage <= 0 || normalTeamUsage <= 0) return null;
    return usageOf(havoc) / havocTeamUsage - usageOf(normal) / normalTeamUsage;
  }
  function trueShootingLabel(line: HavocStatLine): string {
    const rate = trueShootingRate(
      line.points,
      line.fieldGoals.attempted,
      line.freeThrows.attempted,
    );
    return rate === null ? '—' : (rate * 100).toFixed(1);
  }
  function trueShootingChange(havoc: HavocStatLine, normal: HavocStatLine): number | null {
    const havocRate = trueShootingRate(
      havoc.points,
      havoc.fieldGoals.attempted,
      havoc.freeThrows.attempted,
    );
    const normalRate = trueShootingRate(
      normal.points,
      normal.fieldGoals.attempted,
      normal.freeThrows.attempted,
    );
    return havocRate === null || normalRate === null ? null : (havocRate - normalRate) * 100;
  }
  function trueShootingChangeLabel(havoc: HavocStatLine, normal: HavocStatLine): string {
    const delta = trueShootingChange(havoc, normal);
    return delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pp`;
  }
  type StatCell = {
    value: string;
    delta: string;
    better: boolean;
    worse: boolean;
  };
  function statCell(player: SquadRow, key: string): StatCell | null {
    if (key === 'trueShooting') {
      const value = trueShootingRate(
        player.havoc.combined.points,
        player.havoc.combined.fieldGoals.attempted,
        player.havoc.combined.freeThrows.attempted,
      );
      const delta = trueShootingChange(player.havoc.combined, player.normal.combined);
      return {
        value: value === null ? '—' : (value * 100).toFixed(1),
        delta: trueShootingChangeLabel(player.havoc.combined, player.normal.combined),
        better: delta !== null && delta > 0,
        worse: delta !== null && delta < 0,
      };
    }
    if (key === 'usage') {
      const delta = usageDelta(player.havoc.combined, player.normal.combined);
      return {
        value: usageShare(player.havoc.combined, havocTeamUsage),
        delta: usageChange(player.havoc.combined, player.normal.combined),
        better: delta !== null && delta > 0,
        worse: delta !== null && delta < 0,
      };
    }
    const stat = stats.find((entry) => entry.key === key);
    if (stat === undefined) return null;
    const delta = player.deltas[stat.key];
    return {
      value: average(total(player.havoc.combined, stat.key)),
      delta: change(delta),
      better: stat.key === 'turnovers' ? delta < 0 : delta > 0,
      worse: stat.key === 'turnovers' ? delta > 0 : delta < 0,
    };
  }
  const squadColumns: readonly PlayerStatColumn<SquadRow>[] = [
    ...stats.map((stat) => ({
      key: stat.key,
      label: stat.label,
      value: (player: SquadRow) => statCell(player, stat.key)?.value ?? '—',
    })),
    {
      key: 'trueShooting',
      label: 'TS%',
      value: (player: SquadRow) => statCell(player, 'trueShooting')?.value ?? '—',
    },
    {
      key: 'usage',
      label: 'USG%',
      value: (player: SquadRow) => statCell(player, 'usage')?.value ?? '—',
    },
  ];
  let selectedSlot = $state<string | null>(null);
  let detailsOpen = $state(false);
  const selectedPlayer = $derived(comparison.slots.find((player) => player.slot === selectedSlot));
  const selectedSource = $derived(lineup.find((player) => player.slot === selectedSlot));
</script>

<Panel
  as="section"
  padding="md"
  class="mt-4"
  aria-labelledby="h-squad-report"
  data-havoc-squad-report
>
  <h2 id="h-squad-report" class="h-subtitle">Season box score</h2>
  <p class="h-copy text-xs mt-2">
    Per-game Havoc stats. The signed value below is the change from Normal. Select a player for both
    lines and their powers. Each position includes replacements and clones.
  </p>
  <p class="h-mobile-hint h-copy text-xs mt-2">Swipe the stats to see every column.</p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable box score needs keyboard access.) -->
  <div
    class="h-box-score ui-stats-scroll mt-4"
    role="region"
    aria-label="Player season box score"
    tabindex="0"
  >
    <PlayerStatsTable
      columns={squadColumns}
      rows={comparison.slots}
      rowKey={(player) => player.slot}
      caption="Player season box score"
      tableClass="min-w-[720px]"
      rowAttributes={(player) => ({ 'data-havoc-player-stats': player.slot })}
      stickyIdentity
    >
      {#snippet identity(player)}
        {@const source = lineup.find((slot) => slot.slot === player.slot)}
        <button
          class="h-player-button"
          onclick={() => {
            selectedSlot = player.slot;
            detailsOpen = true;
          }}
          aria-label="View {player.displayName} stats and powers"
        >
          <PlayerArt
            playerId={player.playerId}
            displayName={player.displayName}
            franchiseId={source?.franchiseId}
            seasonKey={source?.seasonKey}
          />
          <span
            ><span class="h-player-name">{player.displayName}</span><span class="h-player-caption"
              >{player.slot}{comparison.mvp.slot === player.slot ? ' / MVP' : ''} / View details</span
            ></span
          >
        </button>
      {/snippet}
      {#snippet cell(player, column)}
        {@const view = statCell(player, column.key)}
        {#if view}
          <span class="h-box-value">{view.value}</span>
          <span class="h-box-delta" class:better={view.better} class:worse={view.worse}
            >{view.delta}</span
          >
        {/if}
      {/snippet}
    </PlayerStatsTable>
  </div>
</Panel>
<Dialog.Root bind:open={detailsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="h-result-overlay" />
    <Dialog.Content class="havoc-world h-result-dialog">
      {#if selectedPlayer !== undefined}
        {@const player = selectedPlayer}
        <header class="h-header">
          <div>
            <p class="h-eyebrow">{player.slot} / Season comparison</p>
            <Dialog.Title class="h-subtitle mt-2">{player.displayName}</Dialog.Title>
          </div>
          <Dialog.Close class="ui-btn" data-tone="secondary" aria-label="Close player details"
            >Close</Dialog.Close
          >
        </header>
        <Dialog.Description class="h-copy text-xs"
          >Per-game averages over 82 games, including this position's replacements and clones.</Dialog.Description
        >
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
          <div class="h-stat-columns" data-havoc-stat="trueShooting">
            <dt>TS%</dt>
            <dd class="h-powered">{trueShootingLabel(player.havoc.combined)}</dd>
            <dd>{trueShootingLabel(player.normal.combined)}</dd>
            <dd
              class:better={(trueShootingChange(player.havoc.combined, player.normal.combined) ??
                0) > 0}
              class:worse={(trueShootingChange(player.havoc.combined, player.normal.combined) ??
                0) < 0}
            >
              {trueShootingChangeLabel(player.havoc.combined, player.normal.combined)}
            </dd>
          </div>
          <div class="h-stat-columns" data-havoc-stat="usage">
            <dt>USG%</dt>
            <dd class="h-powered">{usageShare(player.havoc.combined, havocTeamUsage)}</dd>
            <dd>{usageShare(player.normal.combined, normalTeamUsage)}</dd>
            <dd>{usageChange(player.havoc.combined, player.normal.combined)}</dd>
          </div>
        </dl>

        <h3 class="h-subtitle mt-6">Player powers</h3>
        <p class="h-copy text-xs mt-2">
          Direct power points count recorded score adjustments. Shared abilities show totals across
          their owners.
        </p>
        <ul class="h-player-powers mt-3">
          {#each selectedSource?.mutations ?? [] as entry (entry.mutationId)}
            {@const power = comparison.mutations.find(
              (value) => value.mutationId === entry.mutationId,
            )}
            <li>
              <details>
                <summary
                  >{mutationNameOf(
                    entry.mutationId,
                  )}{#if power !== undefined && mutationTierOf(entry.mutationId) !== 1}<span
                      class="h-copy text-xs"
                    >
                      · {formatSignedPoints(power.pointsDelta)} direct pts{power.ownerCount > 1
                        ? ' across all owners'
                        : ''}</span
                    >{/if}</summary
                >
                <p class="h-copy text-xs">{mutationDescriptionOf(entry.mutationId)}</p>
                {#if mutationDownsideOf(entry.mutationId)}<p class="h-copy text-xs">
                    Tradeoff: {mutationDownsideOf(entry.mutationId)}
                  </p>{/if}
                {#if power !== undefined && mutationTierOf(entry.mutationId) !== 1}
                  <p class="h-copy text-xs mt-2">
                    {power.triggers} activations · {power.freeThrowsGranted} bonus free throws · {power.turnoversCancelled}
                    turnovers saved · {power.extraPossessionsUsed}/{power.extraPossessionsEarned} extra
                    possessions used · {power.extraPossessionsExpired} expired · {power.swapSeconds}s
                    ratings swapped · {power.capSeconds}s ratings capped.
                  </p>
                  {#if power.swapPoints !== 0}<p class="h-copy text-xs">
                      {formatSignedPoints(power.swapPoints)} points scored in the stolen body.
                    </p>{/if}
                  {#if power.ownerCount > 1}<p class="h-copy text-xs">
                      Shared ability: these are combined totals for all {power.ownerCount} owners.
                    </p>{/if}
                {/if}
              </details>
            </li>
          {/each}
        </ul>

        {#if comparison.mvp.slot === player.slot}
          <details class="mt-2">
            <summary>How the MVP was chosen</summary>
            <p class="h-copy text-xs">
              Production index: {comparison.mvp.havocIndex} with powers / {comparison.mvp
                .normalIndex} without powers ({formatSignedPoints(comparison.mvp.gain)} gain).
            </p>
            <p class="h-copy text-xs">
              {havocMvpFormulaLabel(comparison.mvpIndexWeights)}. Highest gain wins; ties use the
              Havoc index, then draft order. Includes replacements and clones.
            </p>
          </details>
        {/if}
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .h-box-score {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .h-box-score:focus-visible {
    outline: 2px solid var(--h-pink);
    outline-offset: 3px;
  }
  .h-mobile-hint {
    display: none;
  }
  .h-player-button :global(.h-player-art) {
    width: 36px;
    height: 36px;
  }
  .h-player-button :global(.h-initials) {
    font-size: 1.25rem;
  }
  .h-player-button :global(.h-team-crest) {
    display: none;
  }
  .h-box-value {
    display: block;
    font-size: 14px;
    font-weight: 700;
  }
  .h-box-delta {
    display: block;
    font-size: 10px;
    color: #aab9db;
  }
  .better {
    color: #8bceaf;
  }
  .worse {
    color: #f290c5;
  }
  .h-player-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    padding: 10px 4px;
    border-radius: 8px;
    cursor: pointer;
  }
  .h-player-button:hover {
    background: #303c63;
  }
  .h-player-name {
    display: block;
    font-size: 13px;
    font-weight: 700;
  }
  .h-player-caption {
    display: block;
    color: #c1cae4;
    font-size: 10px;
    margin-top: 3px;
  }
  .h-stat-columns {
    display: grid;
    grid-template-columns: 1fr repeat(3, 0.8fr);
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid #465273;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .h-stat-columns > :not(:first-child) {
    text-align: right;
  }
  .h-stat-columns[aria-hidden] {
    margin-top: 16px;
    font-size: 10px;
    color: #c1cae4;
  }
  .h-stat-columns dt {
    color: #c1cae4;
    font-size: 11px;
  }
  .h-powered {
    color: #ffd782;
    font-weight: 700;
  }
  .h-player-powers > li {
    border-bottom: 1px solid #465273;
  }
  @media (max-width: 600px) {
    .h-mobile-hint {
      display: block;
    }
    .h-player-button {
      gap: 8px;
      min-height: 64px;
      padding-right: 8px;
    }
    .h-player-name {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .h-player-caption {
      font-size: 9px;
    }
    .h-player-button :global(.h-player-art) {
      width: 28px;
      height: 28px;
    }
    .h-stat-columns {
      gap: 6px;
      font-size: 12px;
    }
  }
</style>
