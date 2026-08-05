<script lang="ts">
  import type { HoopRushManifest, SeasonRoster } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';

  /**
   * Human franchise roster cards (M2.3.5): ten player-season versions with
   * faces, historical source identity, OVR, and current rotation role/minutes.
   */

  let {
    roster,
    manifest,
    shell,
    roleOf,
  }: {
    roster: SeasonRoster;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    /** Current rotation role + minutes for each playerVersionId. */
    roleOf: (playerVersionId: string) => { role: string; minutes: number | string };
  } = $props();
</script>

<ul class="flex flex-col gap-0 sm:gap-2">
  {#each roster.players as entry (entry.playerVersionId)}
    {@const face = shell.facesByVersion.get(entry.playerVersionId) ?? null}
    {@const eraIdentity = eraIdentityOf(manifest, entry.franchiseId, entry.eraId)}
    {@const modernIdentity = franchiseIdentityOf(manifest, entry.franchiseId)}
    {@const candidate =
      shell.catalog?.candidates.find((c) => c.playerVersionId === entry.playerVersionId) ?? null}
    {@const rotation = roleOf(entry.playerVersionId)}
    <li class="overflow-hidden bg-surface-1 p-3 sm:rounded-xl">
      <div class="flex min-w-0 items-start gap-3">
        {#if face !== null}
          <SeasonPlayerFace {face} {manifest} size="sm" />
        {:else}
          <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
            aria-hidden="true"
          >
            ?
          </span>
        {/if}
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="min-w-0 truncate text-sm font-semibold">{entry.displayName}</p>
            {#if candidate}
              <span
                class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
              >
                OVR {candidate.summaryRatings.overallRating}
              </span>
            {/if}
          </div>
          <p class="truncate font-mono text-[10px] text-muted-foreground">
            {entry.seasonKey}
            {#if shell.playablePositions(entry.playerVersionId).length > 0}
              · {shell.playablePositions(entry.playerVersionId).join('/')}
            {/if}
          </p>
          {#if eraIdentity?.displayLabel}
            <p class="mt-1 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70">
              {eraIdentity.displayLabel}
            </p>
          {/if}
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1">
          <SeasonTeamLogo
            {manifest}
            franchiseId={entry.franchiseId}
            teamExternalId={modernIdentity?.teamExternalId ?? ''}
            logoCandidates={eraIdentity?.logoCandidates ?? []}
            size="sm"
            alt={eraIdentity?.displayLabel ?? modernIdentity?.displayName ?? ''}
          />
          <span class="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
            {rotation.role} · {rotation.minutes} min
          </span>
        </div>
      </div>
    </li>
  {/each}
</ul>
