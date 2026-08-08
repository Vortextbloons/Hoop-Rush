<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { BoxScore } from '$lib/season/season-presentation';
  import { formatClock } from '$lib/season/season-presentation';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';

  /**
   * Box score view for one completed human-team game (M2.3, M2.3.5): team
   * totals and the ten compact player lines from the summary, joined with
   * roster names and positions. Exact integers only — no derived
   * efficiencies beyond what the compact contract carries.
   *
   * Responsive: below `md` a compact primary-stat view (Player, Min, Pts,
   * Reb, Ast) with no horizontal scroll sits above an expandable full-stat
   * table; at `md+` the full 13-column table renders directly. When a
   * manifest plus both franchise ids are provided, the header shows the
   * team logos.
   */

  let {
    box,
    opponentName,
    resultLabel,
    manifest = null,
    teamFranchiseId = null,
    opponentFranchiseId = null,
  }: {
    box: BoxScore;
    opponentName: string;
    resultLabel: string;
    /** Packaged manifest; when present the header renders team logos. */
    manifest?: HoopRushManifest | null;
    /** Owning franchise of the boxed team (header logo). */
    teamFranchiseId?: string | null;
    /** Opponent franchise (header logo). */
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
</script>

<div class="rounded-xl bg-surface-1" data-season-box-score>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3"
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
      <h3 class="font-display text-base font-extrabold uppercase tracking-tight">
        {resultLabel}
      </h3>
    </div>
    <p class="flex items-center gap-2 text-sm text-muted-foreground">
      <span class="font-mono text-sm text-foreground">
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
    <table class="w-full text-sm">
      <thead>
        <tr
          class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          <th scope="col" class="px-3 py-2 text-left font-medium">Player</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Min</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Pts</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Reb</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Ast</th>
        </tr>
      </thead>
      <tbody>
        {#each box.players as player (player.playerVersionId)}
          <tr class="border-b border-border/40">
            <th scope="row" class="max-w-36 truncate px-3 py-1.5 text-left font-semibold">
              {player.displayName}
            </th>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {formatClock(player.seconds)}
            </td>
            <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.offensiveRebounds + player.defensiveRebounds}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.assists}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <th scope="row" class="px-3 py-2 text-left font-medium">Team</th>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2 text-right font-bold text-foreground">{box.team.points}</td>
          <td class="px-3 py-2 text-right">
            {box.team.offensiveRebounds + box.team.defensiveRebounds}
          </td>
          <td class="px-3 py-2 text-right">{teamTotal.assists}</td>
        </tr>
      </tfoot>
    </table>

    <details class="group border-t border-border/60">
      <summary
        class="cursor-pointer px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        Full stats
      </summary>
      <div class="overflow-x-auto border-t border-border/40">
        <table class="w-full min-w-[42rem] text-sm">
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
            >
              <th scope="col" class="px-3 py-2 text-left font-medium">Player</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Pos</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Min</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Pts</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">FG</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">3PT</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">FT</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Reb</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Ast</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Stl</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Blk</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">TO</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">PF</th>
            </tr>
          </thead>
          <tbody>
            {#each box.players as player (player.playerVersionId)}
              <tr class="border-b border-border/40">
                <th scope="row" class="max-w-44 truncate px-3 py-1.5 text-left font-semibold">
                  {player.displayName}
                </th>
                <td class="px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
                  {player.position}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {formatClock(player.seconds)}
                </td>
                <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {player.fieldGoalsMade}/{player.fieldGoalsAttempted}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {player.threePointersMade}/{player.threePointersAttempted}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {player.freeThrowsMade}/{player.freeThrowsAttempted}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">
                  {player.offensiveRebounds + player.defensiveRebounds}
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.assists}</td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.steals}</td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.blocks}</td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.turnovers}</td>
                <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.fouls}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <th scope="row" class="px-3 py-2 text-left font-medium">Team</th>
              <td class="px-3 py-2"></td>
              <td class="px-3 py-2"></td>
              <td class="px-3 py-2 text-right font-bold text-foreground">{box.team.points}</td>
              <td class="px-3 py-2 text-right">
                {box.team.fieldGoalsMade}/{box.team.fieldGoalsAttempted}
              </td>
              <td class="px-3 py-2 text-right">
                {box.team.threePointersMade}/{box.team.threePointersAttempted}
              </td>
              <td class="px-3 py-2 text-right">
                {box.team.freeThrowsMade}/{box.team.freeThrowsAttempted}
              </td>
              <td class="px-3 py-2 text-right">
                {box.team.offensiveRebounds + box.team.defensiveRebounds}
              </td>
              <td class="px-3 py-2 text-right">{teamTotal.assists}</td>
              <td class="px-3 py-2 text-right">{teamTotal.steals}</td>
              <td class="px-3 py-2 text-right">{teamTotal.blocks}</td>
              <td class="px-3 py-2 text-right">{teamTotal.turnovers}</td>
              <td class="px-3 py-2 text-right">{teamTotal.fouls}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  </div>

  <div class="hidden overflow-x-auto md:block">
    <table class="w-full min-w-[42rem] text-sm">
      <thead>
        <tr
          class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          <th scope="col" class="px-3 py-2 text-left font-medium">Player</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Pos</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Min</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Pts</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">FG</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">3PT</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">FT</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Reb</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Ast</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Stl</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Blk</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">TO</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">PF</th>
        </tr>
      </thead>
      <tbody>
        {#each box.players as player (player.playerVersionId)}
          <tr class="border-b border-border/40">
            <th scope="row" class="max-w-44 truncate px-3 py-1.5 text-left font-semibold">
              {player.displayName}
            </th>
            <td class="px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
              {player.position}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {formatClock(player.seconds)}
            </td>
            <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.fieldGoalsMade}/{player.fieldGoalsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.threePointersMade}/{player.threePointersAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.freeThrowsMade}/{player.freeThrowsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.offensiveRebounds + player.defensiveRebounds}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.assists}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.steals}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.blocks}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.turnovers}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.fouls}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <th scope="row" class="px-3 py-2 text-left font-medium">Team</th>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2 text-right font-bold text-foreground">{box.team.points}</td>
          <td class="px-3 py-2 text-right">
            {box.team.fieldGoalsMade}/{box.team.fieldGoalsAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.threePointersMade}/{box.team.threePointersAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.freeThrowsMade}/{box.team.freeThrowsAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.offensiveRebounds + box.team.defensiveRebounds}
          </td>
          <td class="px-3 py-2 text-right">{teamTotal.assists}</td>
          <td class="px-3 py-2 text-right">{teamTotal.steals}</td>
          <td class="px-3 py-2 text-right">{teamTotal.blocks}</td>
          <td class="px-3 py-2 text-right">{teamTotal.turnovers}</td>
          <td class="px-3 py-2 text-right">{teamTotal.fouls}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>
