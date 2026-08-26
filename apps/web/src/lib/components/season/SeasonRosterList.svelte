<script lang="ts">import type { HoopRushManifest, SeasonRoster } from '@hoop-rush/data-contracts';
import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { FATIGUE_BAND_BADGE, FATIGUE_BAND_LABEL, fatigueBand, fatiguePercent, loadStateOf, } from '$lib/season/season-effects-view';
import type { SeasonEffectsState, SeasonGameSummary } from '@hoop-rush/data-contracts';
import { formatPositions } from '$lib/player-positions';
import { candidateOf } from '$lib/season/season-catalog-index';
let { roster, manifest, shell, roleOf, effects, summaries, embedded = false, }: {
    roster: SeasonRoster;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    roleOf: (playerVersionId: string) => {
        role: string;
        minutes: number | string;
    };
    effects: SeasonEffectsState | null;
    summaries: SeasonGameSummary[];
    embedded?: boolean;
} = $props();
const lastGame = $derived(summaries.length > 0 ? summaries[summaries.length - 1] : null);
const lastGameMinutes = $derived(new Map<string, number>(lastGame === null || lastGame === undefined
    ? []
    : [...lastGame.homePlayers, ...lastGame.awayPlayers].map((line) => [
        line.playerVersionId,
        line.seconds / 60,
    ])));
</script>

<section
  aria-labelledby={embedded ? undefined : 'roster-heading'}
  class="flex flex-col gap-2"
  data-season-roster-list
>
  {#if !embedded}
    <h3
      id="roster-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Roster
    </h3>
  {/if}
  <ul class="flex flex-col gap-0 sm:gap-2">
    {#each roster.players as entry (entry.playerVersionId)}
      {@const face = shell.facesByVersion.get(entry.playerVersionId) ?? null}
      {@const eraIdentity = eraIdentityOf(manifest, entry.franchiseId, entry.eraId)}
      {@const modernIdentity = franchiseIdentityOf(manifest, entry.franchiseId)}
      {@const candidate = candidateOf(shell.catalog, entry.playerVersionId)}
      {@const playable = shell.playablePositions(entry.playerVersionId)}
      {@const rotation = roleOf(entry.playerVersionId)}
      {@const active = rotation.role !== 'Inactive'}
      {@const load =
        active && effects !== null ? loadStateOf(effects, entry.playerVersionId) : null}
      {@const band = load === null ? null : fatigueBand(load.fatigueBasisPoints)}
      {@const lastMinutes = lastGameMinutes.get(entry.playerVersionId) ?? null}
      <li
        data-season-roster-status={active ? 'active' : 'inactive'}
        class="overflow-hidden bg-surface-1 p-3 sm:rounded-xl"
      >
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div class="flex min-w-0 items-start gap-2 sm:gap-3">
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
              <p class="text-sm font-semibold leading-snug">{entry.displayName}</p>
              <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                {#if candidate}
                  <span
                    class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                  >
                    OVR {candidate.summaryRatings.overallRating}
                  </span>
                {/if}
                {#if !active}
                  <span
                    class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
                  >
                    Inactive
                  </span>
                {/if}
                {#if band !== null && load !== null}
                  <span
                    class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${FATIGUE_BAND_BADGE[band]}`}
                  >
                    {FATIGUE_BAND_LABEL[band]}
                    {fatiguePercent(load.fatigueBasisPoints)}%
                  </span>
                {/if}
              </div>
              <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
                {entry.seasonKey}
                {#if playable.length > 0}
                  · {formatPositions(playable)}
                {/if}
              </p>
              {#if eraIdentity?.displayLabel}
                <p
                  class="mt-0.5 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70"
                >
                  {eraIdentity.displayLabel}
                </p>
              {/if}
              {#if load !== null}
                <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
                  Recent load {(load.recentLoadBasisPoints / 100).toFixed(0)}%
                  {#if lastMinutes !== null}
                    · last game {Math.round(lastMinutes)} min
                  {/if}
                </p>
              {/if}
            </div>
          </div>
          <div
            class="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2 sm:flex-col sm:items-end sm:justify-start sm:border-t-0 sm:pt-0"
          >
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
</section>
