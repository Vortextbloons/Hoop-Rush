<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { BoxScore } from '$lib/season/season-presentation';
  import { formatClock } from '$lib/season/season-presentation';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  let {
    box,
    opponentName,
    resultLabel,
    note = null,
    manifest = null,
    teamFranchiseId = null,
    opponentFranchiseId = null,
  }: {
    box: BoxScore;
    opponentName: string;
    resultLabel: string;
    note?: string | null;
    manifest?: HoopRushManifest | null;
    teamFranchiseId?: string | null;
    opponentFranchiseId?: string | null;
  } = $props();
  const teamTotal = $derived(
    box.players.reduce(
      (acc, p) => {
        acc.rebounds += p.offensiveRebounds + p.defensiveRebounds;
        acc.assists += p.assists;
        acc.turnovers += p.turnovers;
        acc.steals += p.steals;
        acc.blocks += p.blocks;
        acc.fouls += p.fouls;
        return acc;
      },
      { rebounds: 0, assists: 0, turnovers: 0, steals: 0, blocks: 0, fouls: 0 },
    ),
  );
  const teamIdentity = $derived(
    manifest && teamFranchiseId ? franchiseIdentityOf(manifest, teamFranchiseId) : null,
  );
  const opponentIdentity = $derived(
    manifest && opponentFranchiseId ? franchiseIdentityOf(manifest, opponentFranchiseId) : null,
  );
  const hasDeep = $derived(
    (box.team.fourPointersAttempted ?? 0) > 0 ||
      box.players.some((player) => player.fourPointersAttempted > 0),
  );
</script>

<div class="sr-panel-quiet overflow-hidden" data-season-box-score>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
  >
    <div class="flex min-w-0 items-center gap-2">
      {#if manifest && teamIdentity}
        <SeasonTeamLogo
          {manifest}
          franchiseId={teamIdentity.franchiseId}
          teamExternalId={teamIdentity.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
      <h3 class="sr-section-label">
        {resultLabel}
      </h3>
      {#if note}
        <span class="font-mono text-[10px] text-muted-foreground">{note}</span>
      {/if}
    </div>
    <p class="flex items-center gap-2 text-sm text-muted-foreground">
      <span class="sr-number text-lg text-foreground">
        {box.team.points} – {box.opponent.points}
      </span>
      <span>vs {opponentName}</span>
      {#if manifest && opponentIdentity}
        <SeasonTeamLogo
          {manifest}
          franchiseId={opponentIdentity.franchiseId}
          teamExternalId={opponentIdentity.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
    </p>
  </div>

  <div class="md:hidden">
    <table class="sr-table w-full">
      <thead>
        <tr>
          <th scope="col" class="text-left">Player</th>
          <th scope="col" class="text-right!">Min</th>
          <th scope="col" class="text-right!">Pts</th>
          <th scope="col" class="text-right!">Reb</th>
          <th scope="col" class="text-right!">Ast</th>
        </tr>
      </thead>
      <tbody>
        {#each box.players as player (player.playerVersionId)}
          <tr>
            <th scope="row" class="max-w-36 truncate px-3 py-1.5 text-left font-semibold">
              {player.displayName}
            </th>
            <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
              {formatClock(player.seconds)}
            </td>
            <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
            <td class="px-3 py-1.5 text-right font-mono">
              {player.offensiveRebounds + player.defensiveRebounds}
            </td>
            <td class="px-3 py-1.5 text-right font-mono">{player.assists}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="border-t-2 border-line-strong bg-surface-2">
          <th scope="row" class="px-3 py-2 text-left">
            <span class="sr-section-label">Team</span>
          </th>
          <td class="px-3 py-2"></td>
          <td class="sr-number px-3 py-2 text-right font-extrabold">{box.team.points}</td>
          <td class="px-3 py-2 text-right font-mono">
            {box.team.offensiveRebounds + box.team.defensiveRebounds}
          </td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.assists}</td>
        </tr>
      </tfoot>
    </table>

    <details class="group border-t border-border">
      <summary
        class="sr-section-label cursor-pointer px-4 py-2.5 outline-none [&::-webkit-details-marker]:hidden"
      >
        Full stats
      </summary>
      <div class="overflow-x-auto border-t border-border/60">
        <table class="sr-table min-w-[42rem]">
          <thead>
            <tr>
              <th scope="col" class="text-left">Player</th>
              <th scope="col" class="text-right!">Pos</th>
              <th scope="col" class="text-right!">Min</th>
              <th scope="col" class="text-right!">Pts</th>
              <th scope="col" class="text-right!">FG</th>
              <th scope="col" class="text-right!">3PT</th>
              {#if hasDeep}
                <th scope="col" class="text-right!">4PT</th>
              {/if}
              <th scope="col" class="text-right!">FT</th>
              <th scope="col" class="text-right!">Reb</th>
              <th scope="col" class="text-right!">Ast</th>
              <th scope="col" class="text-right!">Stl</th>
              <th scope="col" class="text-right!">Blk</th>
              <th scope="col" class="text-right!">TO</th>
              <th scope="col" class="text-right!">PF</th>
            </tr>
          </thead>
          <tbody>
            {#each box.players as player (player.playerVersionId)}
              <tr>
                <th scope="row" class="max-w-44 truncate px-3 py-1.5 text-left font-semibold">
                  {player.displayName}
                </th>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {player.position}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {formatClock(player.seconds)}
                </td>
                <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
                <td class="px-3 py-1.5 text-right font-mono">
                  {player.fieldGoalsMade}/{player.fieldGoalsAttempted}
                </td>
                <td class="px-3 py-1.5 text-right font-mono">
                  {player.threePointersMade}/{player.threePointersAttempted}
                </td>
                {#if hasDeep}
                  <td class="px-3 py-1.5 text-right font-mono">
                    {player.fourPointersMade}/{player.fourPointersAttempted}
                  </td>
                {/if}
                <td class="px-3 py-1.5 text-right font-mono">
                  {player.freeThrowsMade}/{player.freeThrowsAttempted}
                </td>
                <td class="px-3 py-1.5 text-right font-mono">
                  {player.offensiveRebounds + player.defensiveRebounds}
                </td>
                <td class="px-3 py-1.5 text-right font-mono">{player.assists}</td>
                <td class="px-3 py-1.5 text-right font-mono">{player.steals}</td>
                <td class="px-3 py-1.5 text-right font-mono">{player.blocks}</td>
                <td class="px-3 py-1.5 text-right font-mono">{player.turnovers}</td>
                <td class="px-3 py-1.5 text-right font-mono">{player.fouls}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-line-strong bg-surface-2">
              <th scope="row" class="px-3 py-2 text-left">
                <span class="sr-section-label">Team</span>
              </th>
              <td class="px-3 py-2"></td>
              <td class="px-3 py-2"></td>
              <td class="sr-number px-3 py-2 text-right font-extrabold">{box.team.points}</td>
              <td class="px-3 py-2 text-right font-mono">
                {box.team.fieldGoalsMade}/{box.team.fieldGoalsAttempted}
              </td>
              <td class="px-3 py-2 text-right font-mono">
                {box.team.threePointersMade}/{box.team.threePointersAttempted}
              </td>
              {#if hasDeep}
                <td class="px-3 py-2 text-right font-mono"
                  >{box.team.fourPointersMade ?? 0}/{box.team.fourPointersAttempted ?? 0}</td
                >
              {/if}
              <td class="px-3 py-2 text-right font-mono">
                {box.team.freeThrowsMade}/{box.team.freeThrowsAttempted}
              </td>
              <td class="px-3 py-2 text-right font-mono">
                {box.team.offensiveRebounds + box.team.defensiveRebounds}
              </td>
              <td class="px-3 py-2 text-right font-mono">{teamTotal.assists}</td>
              <td class="px-3 py-2 text-right font-mono">{teamTotal.steals}</td>
              <td class="px-3 py-2 text-right font-mono">{teamTotal.blocks}</td>
              <td class="px-3 py-2 text-right font-mono">{teamTotal.turnovers}</td>
              <td class="px-3 py-2 text-right font-mono">{teamTotal.fouls}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  </div>

  <div class="hidden overflow-x-auto md:block">
    <table class="sr-table min-w-[42rem]">
      <thead>
        <tr>
          <th scope="col" class="text-left">Player</th>
          <th scope="col" class="text-right!">Pos</th>
          <th scope="col" class="text-right!">Min</th>
          <th scope="col" class="text-right!">Pts</th>
          <th scope="col" class="text-right!">FG</th>
          <th scope="col" class="text-right!">3PT</th>
          {#if hasDeep}
            <th scope="col" class="text-right!">4PT</th>
          {/if}
          <th scope="col" class="text-right!">FT</th>
          <th scope="col" class="text-right!">Reb</th>
          <th scope="col" class="text-right!">Ast</th>
          <th scope="col" class="text-right!">Stl</th>
          <th scope="col" class="text-right!">Blk</th>
          <th scope="col" class="text-right!">TO</th>
          <th scope="col" class="text-right!">PF</th>
        </tr>
      </thead>
      <tbody>
        {#each box.players as player (player.playerVersionId)}
          <tr>
            <th scope="row" class="max-w-44 truncate px-3 py-1.5 text-left font-semibold">
              {player.displayName}
            </th>
            <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
              {player.position}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-muted-foreground">
              {formatClock(player.seconds)}
            </td>
            <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
            <td class="px-3 py-1.5 text-right font-mono">
              {player.fieldGoalsMade}/{player.fieldGoalsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono">
              {player.threePointersMade}/{player.threePointersAttempted}
            </td>
            {#if hasDeep}
              <td class="px-3 py-1.5 text-right font-mono">
                {player.fourPointersMade}/{player.fourPointersAttempted}
              </td>
            {/if}
            <td class="px-3 py-1.5 text-right font-mono">
              {player.freeThrowsMade}/{player.freeThrowsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono">
              {player.offensiveRebounds + player.defensiveRebounds}
            </td>
            <td class="px-3 py-1.5 text-right font-mono">{player.assists}</td>
            <td class="px-3 py-1.5 text-right font-mono">{player.steals}</td>
            <td class="px-3 py-1.5 text-right font-mono">{player.blocks}</td>
            <td class="px-3 py-1.5 text-right font-mono">{player.turnovers}</td>
            <td class="px-3 py-1.5 text-right font-mono">{player.fouls}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="border-t-2 border-line-strong bg-surface-2">
          <th scope="row" class="px-3 py-2 text-left">
            <span class="sr-section-label">Team</span>
          </th>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2"></td>
          <td class="sr-number px-3 py-2 text-right font-extrabold">{box.team.points}</td>
          <td class="px-3 py-2 text-right font-mono">
            {box.team.fieldGoalsMade}/{box.team.fieldGoalsAttempted}
          </td>
          <td class="px-3 py-2 text-right font-mono">
            {box.team.threePointersMade}/{box.team.threePointersAttempted}
          </td>
          {#if hasDeep}
            <td class="px-3 py-2 text-right font-mono"
              >{box.team.fourPointersMade ?? 0}/{box.team.fourPointersAttempted ?? 0}</td
            >
          {/if}
          <td class="px-3 py-2 text-right font-mono">
            {box.team.freeThrowsMade}/{box.team.freeThrowsAttempted}
          </td>
          <td class="px-3 py-2 text-right font-mono">
            {box.team.offensiveRebounds + box.team.defensiveRebounds}
          </td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.assists}</td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.steals}</td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.blocks}</td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.turnovers}</td>
          <td class="px-3 py-2 text-right font-mono">{teamTotal.fouls}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>