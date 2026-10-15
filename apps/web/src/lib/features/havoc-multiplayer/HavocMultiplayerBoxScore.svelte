<script lang="ts">
  import HavocPlayerArt from '#lib/features/havoc/HavocPlayerArt.svelte';
  import { ratioPct, perGameText } from '#lib/format.js';
  import { havocParticipantKindLabel } from '#lib/features/havoc/havoc-presentation.js';
  import type { HavocMultiplayerSideBox } from './havoc-multiplayer-playback-view';

  let {
    boxes,
    localSide,
    perGame = false,
    games = 1,
  }: {
    boxes: readonly HavocMultiplayerSideBox[];
    localSide: 'home' | 'away';
    perGame?: boolean;
    games?: number;
  } = $props();

  function statOf(value: number): string {
    return perGame ? perGameText(value, games) : String(value);
  }

  function labelOf(side: 'home' | 'away'): string {
    return side === localSide ? 'You' : 'Opponent';
  }
</script>

<div class="hm-boxes-container">
  <div class="hm-boxes" data-havoc-multiplayer-boxes>
    {#each boxes as box (box.side)}
      {@const topPoints = Math.max(0, ...box.lines.map((line) => line.points))}
      <section class="hm-box" data-side={box.side} aria-label={`${labelOf(box.side)} box score`}>
        <header class="hm-box-head">
          <span class="hm-box-label" data-side={box.side}>{labelOf(box.side)}</span>
          {#if box.bonusPoints !== 0}
            <span class="hm-box-bonus" data-negative={box.bonusPoints < 0}
              >Team bonus {box.bonusPoints > 0 ? `+${box.bonusPoints}` : box.bonusPoints}</span
            >
          {/if}
          <strong class="hm-box-score" data-negative={box.score < 0}>{statOf(box.score)}</strong>
        </header>
        <div class="hm-box-scroll">
          <table>
            <caption class="sr-only">{labelOf(box.side)} participant lines</caption>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Role</th>
                <th scope="col">Pts</th>
                <th scope="col">FG%</th>
                <th scope="col">FT%</th>
                <th scope="col">Reb</th>
                <th scope="col">Ast</th>
                <th scope="col">Stl</th>
                <th scope="col">Blk</th>
                <th scope="col">TO</th>
                <th scope="col">PF</th>
              </tr>
            </thead>
            <tbody>
              {#each box.lines as line (line.instanceId)}
                <tr
                  data-kind={line.kind}
                  data-negative={line.points < 0}
                  data-top-scorer={topPoints > 0 && line.points === topPoints}
                >
                  <th scope="row" class="hm-player">
                    <div class="hm-player-identity">
                      <HavocPlayerArt
                        playerId={line.sourcePlayerId}
                        displayName={line.displayName}
                        compact
                      />
                      <div class="hm-player-detail">
                        <span class="hm-player-name">{line.displayName}</span>
                        <span class="hm-player-slot">{line.slot}</span>
                        {#if topPoints > 0 && line.points === topPoints}<span class="hm-top-scorer"
                            >Top scorer</span
                          >{/if}
                      </div>
                    </div>
                  </th>
                  <td class="hm-role">{havocParticipantKindLabel(line.kind)}</td>
                  <td class="hm-pts" data-negative={line.points < 0}>{statOf(line.points)}</td>
                  <td>{ratioPct(line.fieldGoalsMade, line.fieldGoalsAttempted)}</td>
                  <td>{ratioPct(line.freeThrowsMade, line.freeThrowsAttempted)}</td>
                  <td>{statOf(line.rebounds)}</td>
                  <td>{statOf(line.assists)}</td>
                  <td>{statOf(line.steals)}</td>
                  <td>{statOf(line.blocks)}</td>
                  <td>{statOf(line.turnovers)}</td>
                  <td>{statOf(line.fouls)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
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
    border: 1px solid #465273;
    border-radius: 16px;
    background: #20294c;
  }
  .hm-box-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid #3c486b;
  }
  .hm-box-label {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hm-box-label[data-side='home'] {
    color: #679dff;
  }
  .hm-box-label[data-side='away'] {
    color: #f290c5;
  }
  .hm-box-bonus {
    padding: 2px 8px;
    border: 1px solid #465273;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #ffd782;
  }
  .hm-box-bonus[data-negative='true'] {
    color: #f290c5;
  }
  .hm-box-score {
    margin-left: auto;
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .hm-box-score[data-negative='true'] {
    color: #f290c5;
  }
  .hm-box-scroll {
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  table {
    width: 100%;
    min-width: 34rem;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 7px 9px;
    text-align: right;
    white-space: nowrap;
  }
  thead th {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #aab9db;
    border-bottom: 1px solid #3c486b;
  }
  tbody tr {
    border-top: 1px solid rgb(60 72 107 / 55%);
  }
  tbody tr:first-child {
    border-top: 0;
  }
  tbody tr[data-kind='replacement'] {
    background: rgb(103 157 255 / 7%);
  }
  tbody tr[data-kind='clone'] {
    background: rgb(242 144 197 / 7%);
  }
  .hm-player {
    max-width: 13rem;
    overflow: hidden;
    text-align: left;
  }
  tbody tr[data-top-scorer='true'] {
    background: rgb(255 215 130 / 12%);
  }
  .hm-top-scorer {
    color: #ffd782;
    font-size: 9px;
  }
  .hm-player-name {
    display: block;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
  }
  .hm-player-identity {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hm-player-detail {
    min-width: 0;
  }
  .hm-player-slot {
    display: block;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: #aab9db;
  }
  .hm-role {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #aab9db;
  }
  .hm-pts {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
  }
  .hm-pts[data-negative='true'] {
    color: #f290c5;
  }
</style>
