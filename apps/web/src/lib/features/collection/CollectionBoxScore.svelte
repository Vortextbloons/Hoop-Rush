<script lang="ts">
  import type { CollectionCatalogCard, HoopRushManifest } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import type { GameExplanationFacts } from './collection-gamecast';
  import {
    teamBoxViewOf,
    teamComparisonOf,
    type CollectionCompletedResult,
    type PlayerBoxRow,
  } from './collection-box-score';

  let {
    result,
    starters,
    facts,
    nameOf,
    cardOf,
    manifest,
  }: {
    result: CollectionCompletedResult;
    starters: { home: readonly string[]; away: readonly string[] };
    facts: GameExplanationFacts;
    nameOf: (cardId: string) => string;
    cardOf: (cardId: string) => CollectionCatalogCard | undefined;
    manifest: HoopRushManifest | null;
  } = $props();

  const homeTeam = $derived(teamBoxViewOf({ result: result.home, starterIds: starters.home }));
  const awayTeam = $derived(teamBoxViewOf({ result: result.away, starterIds: starters.away }));
  const teams = $derived([
    { key: 'home', label: 'You', side: 'home' as const, team: homeTeam },
    { key: 'away', label: 'CPU', side: 'away' as const, team: awayTeam },
  ]);
  const comparison = $derived(teamComparisonOf(homeTeam, awayTeam));
  const comparisonColumns = $derived.by(() => {
    const half = Math.ceil(comparison.length / 2);
    return [comparison.slice(0, half), comparison.slice(half)];
  });
  const hasDeepFours = $derived(
    [...result.home.players, ...result.away.players].some(
      (player) => (player.deepFours?.attempted ?? 0) > 0,
    ),
  );
  const biggestLeadLabel = $derived(
    facts.biggestLead.side === 'tied'
      ? 'None'
      : `${facts.biggestLead.side === 'home' ? 'You' : 'CPU'} by ${String(facts.biggestLead.points)}`,
  );

  function initialsOf(cardId: string): string {
    return nameOf(cardId)
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2);
  }

  function deepFoursOf(row: PlayerBoxRow): string {
    return `${String(row.deepFours?.made ?? 0)}-${String(row.deepFours?.attempted ?? 0)}`;
  }
</script>

<div class="ur-boxscore">
  <section class="ur-team-stats" aria-label="Team stats comparison">
    <div class="ur-team-stats-head">
      <h3>Team stats</h3>
      <ul class="ur-flow">
        <li><span>Lead changes</span><strong class="ur-number">{facts.leadChanges}</strong></li>
        <li><span>Biggest lead</span><strong class="ur-number">{biggestLeadLabel}</strong></li>
        {#if facts.overtimePeriods > 0}
          <li><span>Overtime</span><strong class="ur-number">{facts.overtimePeriods}</strong></li>
        {/if}
        {#if facts.exceptions > 0}
          <li><span>Foul exceptions</span><strong class="ur-number">{facts.exceptions}</strong></li>
        {/if}
      </ul>
    </div>
    <div class="ur-compare">
      {#each comparisonColumns as column, columnIndex (columnIndex)}
        <div class="ur-compare-col">
          <div class="ur-compare-head" aria-hidden="true">
            <span class="is-home">You</span>
            <span>Team</span>
            <span class="is-away">CPU</span>
          </div>
          {#each column as row (row.key)}
            <div class="ur-compare-row" data-leader={row.leader}>
              <div class="ur-compare-cell is-home">
                <strong class="ur-number">{row.home.primary}</strong>
                {#if row.home.detail}<small>{row.home.detail}</small>{/if}
              </div>
              <div class="ur-compare-mid">
                <span class="ur-compare-label">{row.label}</span>
                <span class="ur-compare-track" aria-hidden="true">
                  <i class="is-home" style:width={`${(row.homeShare * 100).toFixed(2)}%`}></i>
                  <i class="is-away" style:width={`${((1 - row.homeShare) * 100).toFixed(2)}%`}></i>
                </span>
              </div>
              <div class="ur-compare-cell is-away">
                <strong class="ur-number">{row.away.primary}</strong>
                {#if row.away.detail}<small>{row.away.detail}</small>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </section>

  <div class="ur-box-grid">
    {#each teams as teamRow (teamRow.key)}
      <section class="ur-box-team" aria-label={`${teamRow.label} player box score`}>
        <header class="ur-box-team-head">
          <span class="ur-team-tag" data-side={teamRow.side}>{teamRow.label}</span>
          <strong class="ur-box-team-score ur-number">{teamRow.team.score}</strong>
        </header>
        <div class="ur-box-scroll">
          <table class="ur-box-table">
            <caption class="sr-only"
              >{teamRow.label} player box score · {teamRow.team.score} points</caption
            >
            <thead>
              <tr>
                <th scope="col" class="is-player">Player</th>
                <th scope="col" class="is-stat">Min</th>
                <th scope="col" class="is-stat is-strong">Pts</th>
                <th scope="col" class="is-stat">Reb</th>
                <th scope="col" class="is-stat">Ast</th>
                <th scope="col" class="is-stat">Stl</th>
                <th scope="col" class="is-stat">Blk</th>
                <th scope="col" class="is-stat">TO</th>
                <th scope="col" class="is-stat">PF</th>
                <th scope="col" class="is-stat">FG</th>
                <th scope="col" class="is-stat">3P</th>
                <th scope="col" class="is-stat">FT</th>
                {#if hasDeepFours}<th scope="col" class="is-stat">4P</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each teamRow.team.players as player (player.cardId)}
                {@const card = cardOf(player.cardId)}
                <tr data-starter={player.starter} data-dnp={player.seconds === 0}>
                  <th scope="row" class="is-player">
                    <span class="ur-box-player">
                      <span class="ur-box-avatar" aria-hidden="true">
                        {#if card && manifest}
                          <PlayerFace
                            player={{
                              playerId: card.playerId,
                              playerExternalId: card.playerExternalId,
                              altIds: null,
                            }}
                            {manifest}
                            size="sm"
                            fallbackInitials={initialsOf(player.cardId)}
                          />
                        {:else}
                          <span class="ur-box-initials">{initialsOf(player.cardId)}</span>
                        {/if}
                      </span>
                      <span class="ur-box-name">
                        <span>{nameOf(player.cardId)}</span>
                        <small
                          >{card?.rarity ?? ''}{card ? ' · ' : ''}{card?.positions[0] ?? ''}</small
                        >
                      </span>
                      {#if player.starter}<span class="sr-only">Starter</span>{/if}
                    </span>
                  </th>
                  <td class="is-stat">{player.seconds === 0 ? '—' : player.minutes.toFixed(1)}</td>
                  <td class="is-stat is-strong">{player.points}</td>
                  <td class="is-stat">{player.rebounds}</td>
                  <td class="is-stat">{player.assists}</td>
                  <td class="is-stat">{player.steals}</td>
                  <td class="is-stat">{player.blocks}</td>
                  <td class="is-stat">{player.turnovers}</td>
                  <td class="is-stat">{player.fouls}</td>
                  <td class="is-stat">{player.fieldGoals.made}-{player.fieldGoals.attempted}</td>
                  <td class="is-stat">{player.threes.made}-{player.threes.attempted}</td>
                  <td class="is-stat">{player.freeThrows.made}-{player.freeThrows.attempted}</td>
                  {#if hasDeepFours}<td class="is-stat">{deepFoursOf(player)}</td>{/if}
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" class="is-player">Team</th>
                <td class="is-stat"></td>
                <td class="is-stat is-strong">{teamRow.team.totals.points}</td>
                <td class="is-stat">{teamRow.team.totals.rebounds}</td>
                <td class="is-stat">{teamRow.team.totals.assists}</td>
                <td class="is-stat">{teamRow.team.totals.steals}</td>
                <td class="is-stat">{teamRow.team.totals.blocks}</td>
                <td class="is-stat">{teamRow.team.totals.turnovers}</td>
                <td class="is-stat">{teamRow.team.totals.fouls}</td>
                <td class="is-stat"
                  >{teamRow.team.totals.fieldGoals.made}-{teamRow.team.totals.fieldGoals
                    .attempted}</td
                >
                <td class="is-stat"
                  >{teamRow.team.totals.threes.made}-{teamRow.team.totals.threes.attempted}</td
                >
                <td class="is-stat"
                  >{teamRow.team.totals.freeThrows.made}-{teamRow.team.totals.freeThrows
                    .attempted}</td
                >
                {#if hasDeepFours}
                  <td class="is-stat"
                    >{teamRow.team.totals.deepFours?.made ?? 0}-{teamRow.team.totals.deepFours
                      ?.attempted ?? 0}</td
                  >
                {/if}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  .ur-boxscore {
    display: grid;
    gap: 0.9rem;
    margin-top: 1rem;
  }

  .ur-team-stats {
    padding: 0.85rem 1rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 34%),
      linear-gradient(165deg, #121a1f, #0c1216 78%);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%);
  }

  .ur-team-stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.35rem 1rem;
  }

  .ur-team-stats-head h3 {
    margin: 0;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 0.92rem;
    font-weight: 850;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .ur-flow {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.9rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ur-flow li {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    color: var(--ur-muted);
    font-size: 0.68rem;
  }

  .ur-flow strong {
    color: var(--ur-paper);
    font-size: 0.76rem;
  }

  .ur-compare {
    display: grid;
    gap: 0 2.5rem;
    margin-top: 0.5rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ur-compare-col {
    min-width: 0;
  }

  .ur-compare-head,
  .ur-compare-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(6.5rem, 9rem) minmax(0, 1fr);
    align-items: center;
    gap: 0.6rem;
  }

  .ur-compare-head {
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--ur-line);
    color: var(--ur-muted);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .ur-compare-head span:first-child {
    color: var(--ur-apex);
    text-align: right;
  }

  .ur-compare-head span:last-child {
    color: #8bc9e0;
  }

  .ur-compare-row {
    padding-block: 0.32rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ur-line) 50%, transparent);
  }

  .ur-compare-row:last-child {
    border-bottom: 0;
  }

  .ur-compare-cell {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.15;
  }

  .ur-compare-cell.is-home {
    align-items: flex-end;
    text-align: right;
  }

  .ur-compare-cell.is-away {
    align-items: flex-start;
    text-align: left;
  }

  .ur-compare-cell strong {
    color: var(--ur-ink);
    font-size: 0.88rem;
    font-weight: 800;
  }

  .ur-compare-cell small {
    color: var(--ur-muted);
    font-size: 0.62rem;
    font-variant-numeric: tabular-nums;
  }

  .ur-compare-row[data-leader='home'] .ur-compare-cell.is-home strong {
    color: var(--ur-apex);
  }

  .ur-compare-row[data-leader='away'] .ur-compare-cell.is-away strong {
    color: #8bc9e0;
  }

  .ur-compare-mid {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .ur-compare-label {
    color: var(--ur-muted);
    font-size: 0.68rem;
    font-weight: 700;
    text-align: center;
  }

  .ur-compare-track {
    display: flex;
    height: 0.32rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--ur-line);
  }

  .ur-compare-track i {
    display: block;
    height: 100%;
  }

  .ur-compare-track i.is-home {
    background: linear-gradient(90deg, #e9a91f, var(--ur-apex));
  }

  .ur-compare-track i.is-away {
    background: linear-gradient(90deg, #8bc9e0, #5d95ad);
  }

  .ur-box-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ur-box-team {
    min-width: 0;
    overflow: clip;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 20%, var(--ur-line));
    border-radius: 0.75rem;
    background: #10171c;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 4%);
  }

  .ur-box-team-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--ur-line);
    background: linear-gradient(180deg, rgb(255 197 61 / 7%), transparent), #121a1f;
  }

  .ur-team-tag {
    font-family: var(--font-display);
    font-size: 0.82rem;
    font-weight: 900;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .ur-team-tag[data-side='home'] {
    color: var(--ur-apex);
  }

  .ur-team-tag[data-side='away'] {
    color: #8bc9e0;
  }

  .ur-box-team-score {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 900;
    line-height: 1;
  }

  .ur-box-scroll {
    overflow-x: auto;
  }

  .ur-box-table {
    width: 100%;
    min-width: 34rem;
    border-collapse: collapse;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .ur-box-table th,
  .ur-box-table td {
    padding: 0.3rem 0.4rem;
    white-space: nowrap;
  }

  .ur-box-table thead th {
    color: var(--ur-muted);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-align: right;
    text-transform: uppercase;
    border-bottom: 1px solid var(--ur-line);
  }

  .ur-box-table .is-player {
    position: sticky;
    left: 0;
    z-index: 1;
    width: 100%;
    min-width: 9rem;
    text-align: left;
  }

  .ur-box-table thead .is-player {
    z-index: 2;
    background: #121a1f;
  }

  .ur-box-table tbody .is-player,
  .ur-box-table tfoot .is-player {
    background: #10171c;
  }

  .ur-box-table tbody tr {
    border-top: 1px solid color-mix(in srgb, var(--ur-line) 55%, transparent);
  }

  .ur-box-table tbody tr:first-child {
    border-top: 0;
  }

  .ur-box-table tbody tr:hover,
  .ur-box-table tbody tr:hover .is-player {
    background: #151e24;
  }

  .ur-box-table tbody tr[data-dnp='true'] {
    opacity: 0.45;
  }

  .ur-box-table tbody tr[data-starter='true'] .is-player {
    box-shadow: inset 2px 0 0 var(--ur-apex);
  }

  .ur-box-table .is-stat {
    text-align: right;
  }

  .ur-box-table tbody .is-strong {
    color: #fff;
    font-weight: 800;
  }

  .ur-box-table tfoot tr {
    border-top: 1px solid var(--ur-line-strong);
    background: rgb(255 255 255 / 3%);
  }

  .ur-box-table tfoot th,
  .ur-box-table tfoot td {
    padding-block: 0.42rem;
    color: var(--ur-paper);
    font-size: 0.66rem;
    font-weight: 800;
  }

  .ur-box-player {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .ur-box-avatar {
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    flex: none;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-line-strong) 65%, transparent);
    border-radius: 0.38rem;
    color: var(--ur-apex);
    background: #0c1115;
    font-size: 0.6rem;
    font-weight: 800;
  }

  .ur-box-avatar :global(> div) {
    width: 100%;
    height: 100%;
    border-radius: 0;
    background: transparent;
  }

  .ur-box-name {
    display: flex;
    min-width: 0;
    flex-direction: column;
    line-height: 1.15;
  }

  .ur-box-name > span {
    overflow: hidden;
    color: var(--ur-paper);
    font-weight: 700;
    text-overflow: ellipsis;
  }

  .ur-box-name small {
    color: var(--ur-muted);
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  @media (max-width: 1080px) {
    .ur-box-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 760px) {
    .ur-compare {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 460px) {
    .ur-compare-head,
    .ur-compare-row {
      grid-template-columns: minmax(0, 1fr) minmax(5.5rem, 7rem) minmax(0, 1fr);
      gap: 0.4rem;
    }

    .ur-team-stats {
      padding-inline: 0.7rem;
    }
  }
</style>
