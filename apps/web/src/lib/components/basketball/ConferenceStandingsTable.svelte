<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import TeamLogo from '#lib/components/TeamLogo.svelte';

  interface StandingsRow {
    readonly teamId: string;
    readonly displayName: string;
    readonly wins: number;
    readonly losses: number;
    readonly pointDifferential: number;
    readonly seed: number;
    readonly qualified: boolean;
  }

  let {
    conferenceLabel,
    rows,
    caption = null,
    userTeamId = null,
    onTeamSelect = null,
    manifest = null,
    cutoffNote = null,
  }: {
    conferenceLabel: string;
    rows: readonly StandingsRow[];
    caption?: string | null;
    userTeamId?: string | null;
    onTeamSelect?: ((teamId: string) => void) | null;
    manifest?: HoopRushManifest | null;
    cutoffNote?: string | null;
  } = $props();

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }
</script>

<div class="min-w-0">
  <p class="ui-label mb-2" data-tone="muted">{conferenceLabel}</p>
  <div class="max-h-[24rem] overflow-y-auto rounded-xl border border-line-soft">
    <table class="w-full border-collapse text-left">
      <caption class="sr-only">{caption ?? `${conferenceLabel} standings`}</caption>
      <thead class="sticky top-0 z-10 bg-surface-2">
        <tr class="ui-micro">
          <th scope="col" class="px-2 py-2 text-center font-bold">Seed</th>
          <th scope="col" class="px-2 py-2 font-bold">Team</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">W</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">L</th>
          <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">Diff</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.teamId)}
          {#if row.seed === CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS + 1}
            <tr aria-hidden="true">
              <td colspan="5" class="border-y border-line-strong bg-surface-2 px-2 py-1">
                <span class="ui-micro font-bold">Qualification cutoff</span>
              </td>
            </tr>
          {/if}
          <tr
            class="border-b border-line-soft/60 last:border-0 {row.teamId === userTeamId
              ? 'bg-primary/10'
              : ''}"
          >
            <td
              class="px-2 py-1.5 text-center font-mono text-[10px] tabular-nums {row.qualified
                ? 'text-foreground'
                : 'text-muted-foreground'}">{row.seed}</td
            >
            <td class="w-full max-w-0 px-2 py-1.5">
              <span class="flex min-w-0 items-center gap-1.5">
                {#if manifest !== null && identityOf(row.teamId)}
                  {@const identity = identityOf(row.teamId)}
                  <TeamLogo
                    {manifest}
                    franchiseId={identity?.franchiseId ?? row.teamId}
                    teamExternalId={identity?.teamExternalId ?? ''}
                    alt=""
                    className="h-4 w-4"
                  />
                {/if}
                {#if onTeamSelect}
                  <button
                    type="button"
                    class="min-w-0 truncate text-[11px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring {row.teamId ===
                    userTeamId
                      ? 'font-bold text-foreground'
                      : row.qualified
                        ? 'text-foreground'
                        : 'text-muted-foreground'}"
                    title={row.displayName}
                    onclick={() => onTeamSelect(row.teamId)}
                  >
                    {row.displayName}
                  </button>
                {:else}
                  <span
                    class="min-w-0 truncate text-[11px] {row.teamId === userTeamId
                      ? 'font-bold text-foreground'
                      : row.qualified
                        ? 'text-foreground'
                        : 'text-muted-foreground'}"
                    title={row.displayName}>{row.displayName}</span
                  >
                {/if}
                {#if row.teamId === userTeamId}
                  <span class="shrink-0 font-mono text-[8px] font-bold text-primary uppercase"
                    >You</span
                  >
                {/if}
              </span>
            </td>
            <td class="px-2 py-1.5 text-right font-mono text-[10px] font-bold tabular-nums"
              >{row.wins}</td
            >
            <td
              class="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground"
              >{row.losses}</td
            >
            <td
              class="hidden px-2 py-1.5 text-right font-mono text-[10px] tabular-nums sm:table-cell {row.pointDifferential >
              0
                ? 'text-positive'
                : 'text-muted-foreground'}"
              >{row.pointDifferential > 0 ? '+' : ''}{row.pointDifferential}</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if cutoffNote !== null}
    <p class="mt-2 text-[11px] text-muted-foreground">{cutoffNote}</p>
  {/if}
</div>
