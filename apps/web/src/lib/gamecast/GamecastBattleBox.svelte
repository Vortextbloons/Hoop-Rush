<script lang="ts">
  import type { Snippet } from 'svelte';
  import PlayerArt from '#lib/components/PlayerArt.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import {
    ratioPct,
    perGameText,
    trueShootingPct,
    usagePct,
    usagePossessions,
  } from '#lib/format.js';
  import { gamecastBattleParticipantKindLabel } from './gamecast-battle-labels';
  import type {
    GamecastBattleParticipantLine,
    GamecastBattleSideBox,
  } from './gamecast-battle-view';

  let {
    boxes,
    localSide,
    perGame = false,
    games = 1,
    theme = 'havoc',
    teamIdentity,
  }: {
    boxes: readonly GamecastBattleSideBox[];
    localSide: 'home' | 'away';
    perGame?: boolean;
    games?: number;
    theme?: 'havoc' | 'duel';
    teamIdentity?: Snippet<['home' | 'away']>;
  } = $props();

  const orderedBoxes = $derived([
    ...boxes.filter((box) => box.side === localSide),
    ...boxes.filter((box) => box.side !== localSide),
  ]);

  function statOf(value: number): string {
    return perGame ? perGameText(value, games) : String(value);
  }

  function labelOf(side: 'home' | 'away'): string {
    return side === localSide ? 'You' : 'Opponent';
  }

  function columnsFor(
    teamUsage: number,
  ): readonly PlayerStatColumn<GamecastBattleParticipantLine>[] {
    return [
      {
        key: 'role',
        label: 'Role',
        align: 'start',
        value: (line) => gamecastBattleParticipantKindLabel(line.kind),
        cellClass: 'hm-role',
      },
      { key: 'points', label: 'Pts', value: (line) => statOf(line.points), cellClass: 'hm-pts' },
      {
        key: 'fieldGoalPct',
        label: 'FG%',
        value: (line) => ratioPct(line.fieldGoalsMade, line.fieldGoalsAttempted),
      },
      {
        key: 'freeThrowPct',
        label: 'FT%',
        value: (line) => ratioPct(line.freeThrowsMade, line.freeThrowsAttempted),
      },
      {
        key: 'trueShootingPct',
        label: 'TS%',
        value: (line) =>
          trueShootingPct(line.points, line.fieldGoalsAttempted, line.freeThrowsAttempted),
      },
      {
        key: 'usagePct',
        label: 'USG%',
        value: (line) =>
          usagePct(
            usagePossessions(line.fieldGoalsAttempted, line.freeThrowsAttempted, line.turnovers),
            teamUsage,
          ),
      },
      { key: 'rebounds', label: 'Reb', value: (line) => statOf(line.rebounds) },
      { key: 'assists', label: 'Ast', value: (line) => statOf(line.assists) },
      { key: 'steals', label: 'Stl', value: (line) => statOf(line.steals) },
      { key: 'blocks', label: 'Blk', value: (line) => statOf(line.blocks) },
      { key: 'turnovers', label: 'TO', value: (line) => statOf(line.turnovers) },
      { key: 'fouls', label: 'PF', value: (line) => statOf(line.fouls) },
    ];
  }
</script>

<div class="hm-boxes-container">
  <div class="hm-boxes" data-havoc-multiplayer-boxes data-theme={theme}>
    {#each orderedBoxes as box (box.side)}
      {@const topPoints = Math.max(0, ...box.lines.map((line) => line.points))}
      {@const teamUsage = box.lines.reduce(
        (total, line) =>
          total +
          usagePossessions(line.fieldGoalsAttempted, line.freeThrowsAttempted, line.turnovers),
        0,
      )}
      {@const columns = columnsFor(teamUsage)}
      <section
        class="hm-box"
        data-side={box.side}
        data-local={box.side === localSide}
        aria-label={`${labelOf(box.side)} box score`}
      >
        <header class="hm-box-head">
          <span class="hm-box-label" data-side={box.side}
            >{#if teamIdentity}{@render teamIdentity(box.side)}{:else}{labelOf(box.side)}{/if}</span
          >
          {#if box.bonusPoints !== 0}
            <span class="hm-box-bonus" data-negative={box.bonusPoints < 0}
              >Team bonus {box.bonusPoints > 0 ? `+${box.bonusPoints}` : box.bonusPoints}</span
            >
          {/if}
          <strong class="hm-box-score" data-negative={box.score < 0}>{statOf(box.score)}</strong>
        </header>
        <div class="ui-stats-scroll">
          <PlayerStatsTable
            {columns}
            rows={box.lines}
            rowKey={(line) => line.instanceId}
            caption={`${labelOf(box.side)} participant lines`}
            tableClass="min-w-[38rem]"
            playerCellClass="ui-stats-player-cell"
            playerHeadCellClass="ui-stats-player-cell"
            rowAttributes={(line) => ({
              'data-kind': line.kind,
              'data-negative': String(line.points < 0),
              'data-top-scorer': String(topPoints > 0 && line.points === topPoints),
            })}
          >
            {#snippet identity(line)}
              <span class="ui-stats-player">
                <PlayerArt playerId={line.sourcePlayerId} displayName={line.displayName} compact />
                <span class="ui-stats-player-text">
                  <span class="ui-stats-player-name">{line.displayName}</span>
                  <span class="hm-player-slot">{line.slot}</span>
                  {#if topPoints > 0 && line.points === topPoints}<span class="hm-top-scorer"
                      >Top scorer</span
                    >{/if}
                </span>
              </span>
            {/snippet}
          </PlayerStatsTable>
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  .hm-boxes-container {
    container: havoc-boxes / inline-size;
    min-width: 0;
  }
  .hm-boxes {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr;
    --box-border: #465273;
    --box-card: #20294c;
    --box-head: transparent;
    --box-line: #3c486b;
    --box-muted: #aab9db;
    --box-accent: #679dff;
    --box-opponent: hsl(212 90% 62%);
    --box-highlight: #ffd782;
  }
  .hm-boxes[data-theme='duel'] {
    --box-border: var(--color-line-soft);
    --box-card: var(--color-surface-1);
    --box-head: linear-gradient(
      180deg,
      color-mix(in srgb, var(--color-card) 92%, white 8%),
      var(--color-card)
    );
    --box-line: var(--color-line-soft);
    --box-muted: var(--color-muted-foreground);
    --box-accent: var(--color-primary);
    --box-opponent: hsl(212 90% 62%);
    --box-highlight: var(--color-primary);
  }
  @container havoc-boxes (min-width: 76rem) {
    .hm-boxes {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
  }
  .hm-box {
    min-width: 0;
    overflow: clip;
    border: 1px solid var(--box-border);
    border-radius: 16px;
    background: var(--box-card);
    --ui-stats-line: var(--box-line);
    --ui-stats-row-line: color-mix(in srgb, var(--box-line) 55%, transparent);
    --ui-stats-muted: var(--box-muted);
    --ui-stats-player-width: 13rem;
  }
  .hm-box-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--box-line);
    background: var(--box-head);
  }
  .hm-box-label {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hm-box[data-local='true'] .hm-box-label {
    color: var(--box-accent);
  }
  .hm-box[data-local='false'] .hm-box-label {
    color: var(--box-opponent);
  }
  .hm-box-bonus {
    padding: 2px 8px;
    border: 1px solid var(--box-border);
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--box-highlight);
  }
  .hm-box-bonus[data-negative='true'] {
    color: var(--box-opponent);
  }
  .hm-box-score {
    margin-left: auto;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .hm-box-score[data-negative='true'] {
    color: var(--box-opponent);
  }
  .hm-box :global(tbody tr[data-kind='replacement']) {
    background: color-mix(in srgb, var(--box-accent) 7%, transparent);
  }
  .hm-box :global(tbody tr[data-kind='clone']) {
    background: color-mix(in srgb, var(--box-opponent) 7%, transparent);
  }
  .hm-box :global(tbody tr[data-top-scorer='true']) {
    background: color-mix(in srgb, var(--box-highlight) 12%, transparent);
  }
  .hm-top-scorer {
    color: var(--box-highlight);
    font-size: 9px;
  }
  .hm-player-slot {
    display: block;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--box-muted);
  }
  .hm-box :global(.hm-role) {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--box-muted);
  }
  .hm-box :global(.hm-pts) {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
  }
  .hm-box :global(tbody tr[data-negative='true'] .hm-pts) {
    color: var(--box-opponent);
  }
</style>
