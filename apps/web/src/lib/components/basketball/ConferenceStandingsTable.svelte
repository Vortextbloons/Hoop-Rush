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
  }: {
    conferenceLabel: string;
    rows: readonly StandingsRow[];
    caption?: string | null;
    userTeamId?: string | null;
    onTeamSelect?: ((teamId: string) => void) | null;
    manifest?: HoopRushManifest | null;
  } = $props();

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }
</script>

<div class="min-w-0">
  <p class="ui-label mb-2" data-tone="muted">{conferenceLabel}</p>
  <div class="max-h-[24rem] overflow-y-auto">
    <table class="w-full border-collapse text-left">
      <caption class="sr-only">{caption ?? `${conferenceLabel} standings`}</caption>
      <thead class="sticky top-0 z-10 bg-surface-2">
        <tr class="ui-micro">
          <th scope="col" class="w-9 px-1 py-2 text-center font-bold">#</th>
          <th scope="col" class="px-2 py-2 font-bold">Team</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">W–L</th>
          <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">Diff</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.teamId)}
          {#if row.seed === CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS + 1}
            <tr aria-hidden="true">
              <td colspan="4" class="px-2 pt-3 pb-1">
                <span class="flex items-center gap-2">
                  <span class="h-px flex-1 bg-line-strong"></span>
                  <span class="ui-micro font-bold text-muted-foreground">Playoff cutoff</span>
                  <span class="h-px flex-1 bg-line-strong"></span>
                </span>
              </td>
            </tr>
          {/if}
          {@const identity = identityOf(row.teamId)}
          <tr
            class="border-b border-line-soft/50 last:border-0 {row.teamId === userTeamId
              ? 'bg-primary/5'
              : ''}"
          >
            <td class="px-1 py-2 text-center">
              <span
                class="font-mono text-[10px] tabular-nums {row.qualified
                  ? 'text-foreground'
                  : 'text-muted-foreground/70'}">{row.seed}</span
              >
            </td>
            <td class="w-full max-w-0 px-2 py-2">
              <span class="flex min-w-0 items-center gap-2">
                {#if manifest !== null && identity}
                  <TeamLogo
                    {manifest}
                    franchiseId={identity.franchiseId}
                    teamExternalId={identity.teamExternalId}
                    alt=""
                    className="h-5 w-5"
                  />
                {/if}
                {#if onTeamSelect}
                  <button
                    type="button"
                    class="min-w-0 truncate text-[13px] leading-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring {row.teamId ===
                    userTeamId
                      ? 'font-bold text-primary'
                      : row.qualified
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-muted-foreground'}"
                    title={row.displayName}
                    onclick={() => onTeamSelect(row.teamId)}
                  >
                    {row.displayName}
                  </button>
                {:else}
                  <span
                    class="min-w-0 truncate text-[13px] leading-tight {row.teamId === userTeamId
                      ? 'font-bold text-primary'
                      : row.qualified
                        ? 'font-semibold text-foreground'
                        : 'font-medium text-muted-foreground'}"
                    title={row.displayName}>{row.displayName}</span
                  >
                {/if}
                {#if row.teamId === userTeamId}
                  <span class="shrink-0 font-mono text-[8px] font-bold tracking-[0.1em] uppercase"
                    >You</span
                  >
                {/if}
              </span>
            </td>
            <td class="px-2 py-2 text-right whitespace-nowrap">
              <span class="font-display text-base font-extrabold tabular-nums">{row.wins}</span
              ><span class="mx-0.5 text-muted-foreground">–</span><span
                class="font-display text-base font-medium text-muted-foreground tabular-nums"
                >{row.losses}</span
              >
            </td>
            <td
              class="hidden px-2 py-2 text-right font-mono text-[11px] tabular-nums sm:table-cell {row.pointDifferential >
              0
                ? 'text-positive'
                : row.pointDifferential < 0
                  ? 'text-negative/80'
                  : 'text-muted-foreground'}"
            >
              {row.pointDifferential > 0 ? '+' : ''}{row.pointDifferential}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
