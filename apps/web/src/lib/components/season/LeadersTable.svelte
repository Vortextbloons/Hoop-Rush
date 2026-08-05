<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonLeaderCategory,
    SeasonLeaderEntry,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import { LEADER_CATEGORY_LABELS } from '$lib/season/season-presentation';
  import {
    eraIdentityOf,
    franchiseIdentityOf,
    type SeasonFaceRef,
  } from '$lib/season/season-branding';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';

  /**
   * League leaders board for one category (spec/2.0/02 leaders,
   * M2.3.5 Leaders tab). Entries arrive in the ENGINE's authoritative order
   * (per-game desc, value desc, playerVersionId asc). Identity =
   * playerVersionId: every row is a distinct player-season version and shows
   * its historical source logo and season, so versions of the same person
   * stay identifiable. The first place renders as a headshot-led card; the
   * rest as compact ranked rows. Works as a single column (mobile) and as
   * one board among several in the desktop grid.
   */

  let {
    category,
    entries,
    rosterByVersion,
    faces,
    manifest,
    playerName,
    franchiseAbbrev,
  }: {
    category: SeasonLeaderCategory;
    entries: readonly SeasonLeaderEntry[];
    rosterByVersion: ReadonlyMap<string, SeasonRosterEntry>;
    faces: ReadonlyMap<string, SeasonFaceRef>;
    manifest: HoopRushManifest;
    playerName: (playerVersionId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
  } = $props();

  const first = $derived(entries[0] ?? null);

  const valueText = (value: number): string =>
    Number.isInteger(value) ? String(value) : value.toFixed(1);

  /** Historical source identity for one version (logo candidates + label). */
  function versionSource(entry: SeasonLeaderEntry): {
    teamExternalId: string;
    logoCandidates: readonly string[];
    seasonKey: string;
    seasonLabel: string;
  } | null {
    const rosterEntry = rosterByVersion.get(entry.playerVersionId);
    if (rosterEntry === undefined || manifest === null) return null;
    const modern = franchiseIdentityOf(manifest, rosterEntry.franchiseId);
    if (modern === null) return null;
    const era = eraIdentityOf(manifest, rosterEntry.franchiseId, rosterEntry.eraId);
    return {
      teamExternalId: modern.teamExternalId,
      logoCandidates: era.logoCandidates,
      seasonKey: rosterEntry.seasonKey,
      seasonLabel: era.displayLabel === null ? '' : ` · ${era.displayLabel}`,
    };
  }

  /** "ABBR · 1995-96 · 10 gp" plus the era identity label when it differs. */
  function sourceMeta(entry: SeasonLeaderEntry): string {
    const source = versionSource(entry);
    if (source === null)
      return `${franchiseAbbrev(entry.franchiseId)} · ${String(entry.gamesPlayed)} gp`;
    return `${franchiseAbbrev(entry.franchiseId)} · ${source.seasonKey} · ${String(entry.gamesPlayed)} gp${source.seasonLabel}`;
  }
</script>

<section
  data-season-leaders-category={category}
  aria-labelledby={`leaders-${category}-heading`}
  class="flex flex-col rounded-xl bg-surface-1"
>
  <h3
    id={`leaders-${category}-heading`}
    class="border-b border-border/70 px-4 py-3 font-display text-sm font-extrabold uppercase tracking-tight"
  >
    {LEADER_CATEGORY_LABELS[category]}
  </h3>

  {#if entries.length === 0}
    <p class="px-4 py-3 text-sm text-muted-foreground">No qualified players yet.</p>
  {:else if first}
    <!-- First place: headshot-led card with the historical source logo -->
    <div class="flex items-center gap-4 border-b border-border/50 px-4 py-4">
      {#if faces.get(first.playerVersionId)}
        <SeasonPlayerFace face={faces.get(first.playerVersionId)!} {manifest} size="md" />
      {/if}
      <div class="min-w-0 flex-1">
        <p class="truncate font-display text-xl font-extrabold tracking-tight">
          {playerName(first.playerVersionId)}
        </p>
        <p class="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {#if versionSource(first)}
            <SeasonTeamLogo
              {manifest}
              franchiseId={first.franchiseId}
              teamExternalId={versionSource(first)!.teamExternalId}
              logoCandidates={versionSource(first)!.logoCandidates}
              alt=""
              size="sm"
            />
          {/if}
          {franchiseAbbrev(first.franchiseId)} · {first.gamesPlayed} gp
          {#if versionSource(first)}
            <span class="hidden min-w-0 truncate sm:inline">
              {versionSource(first)!.seasonKey}{versionSource(first)!.seasonLabel}
            </span>
          {/if}
        </p>
      </div>
      <p class="shrink-0 text-right">
        <span class="block font-display text-3xl font-extrabold tabular-nums">
          {valueText(first.value)}
        </span>
        <span class="block font-mono text-[10px] text-muted-foreground">
          {first.perGame.toFixed(1)}/g
        </span>
      </p>
    </div>

    <!-- Ranks 2-5: compact rows -->
    <ol class="flex flex-col divide-y divide-border/50">
      {#each entries.slice(1) as entry, index (entry.playerVersionId)}
        <li
          class="flex items-center gap-3 px-4 py-2.5 text-sm"
          aria-label={`Rank ${String(index + 2)}: ${playerName(entry.playerVersionId)}`}
        >
          <span class="w-5 shrink-0 font-mono text-[10px] font-bold text-muted-foreground">
            {index + 2}
          </span>
          {#if faces.get(entry.playerVersionId)}
            <SeasonPlayerFace face={faces.get(entry.playerVersionId)!} {manifest} size="sm" />
          {/if}
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">
              {playerName(entry.playerVersionId)}
            </span>
            <span class="block truncate font-mono text-[10px] text-muted-foreground">
              {sourceMeta(entry)}
            </span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block font-display text-base font-extrabold tabular-nums">
              {valueText(entry.value)}
            </span>
            <span class="block font-mono text-[10px] text-muted-foreground">
              {entry.perGame.toFixed(1)}/g
            </span>
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
