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
  import { oneDecimal } from '$lib/format';
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
  const rest = $derived(entries.slice(1));
  const valueText = (value: number): string =>
    Number.isInteger(value) ? value.toLocaleString('en-US') : oneDecimal(value);
  function winnerSource(entry: SeasonLeaderEntry): {
    teamExternalId: string;
    logoCandidates: readonly string[];
  } | null {
    const rosterEntry = rosterByVersion.get(entry.playerVersionId);
    if (rosterEntry === undefined || manifest === null) return null;
    const modern = franchiseIdentityOf(manifest, rosterEntry.franchiseId);
    if (modern === null) return null;
    const era = eraIdentityOf(manifest, rosterEntry.franchiseId, rosterEntry.eraId);
    return {
      teamExternalId: modern.teamExternalId,
      logoCandidates: era.logoCandidates,
    };
  }
  const firstSource = $derived(first !== null ? winnerSource(first) : null);
</script>

<section
  data-season-leaders-category={category}
  aria-labelledby={`leaders-${category}-heading`}
  class="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-1"
>
  <h3
    id={`leaders-${category}-heading`}
    class="border-b border-border/70 px-5 py-3.5 font-display text-base font-extrabold uppercase tracking-tight"
  >
    {LEADER_CATEGORY_LABELS[category]}
  </h3>

  {#if entries.length === 0}
    <p class="px-5 py-4 text-sm text-muted-foreground">No qualified players yet.</p>
  {:else if first}
    <div class="border-b border-border/50 px-5 py-5">
      <div class="flex items-center gap-4">
        {#if faces.get(first.playerVersionId)}
          <SeasonPlayerFace
            face={faces.get(first.playerVersionId)!}
            {manifest}
            size="xl"
            eager={false}
          />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="truncate text-2xl font-extrabold tracking-tight">
            {playerName(first.playerVersionId)}
          </p>
          <p class="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {#if firstSource}
              <SeasonTeamLogo
                {manifest}
                franchiseId={first.franchiseId}
                teamExternalId={firstSource.teamExternalId}
                logoCandidates={firstSource.logoCandidates}
                alt=""
                size="sm"
              />
            {/if}
            {franchiseAbbrev(first.franchiseId)}
          </p>
        </div>
        <p class="shrink-0 text-right">
          <span class="font-display block text-4xl leading-none font-extrabold tabular-nums">
            {valueText(first.value)}
          </span>
          <span class="mt-1 block font-mono text-xs text-muted-foreground">
            {oneDecimal(first.perGame)}/g
          </span>
        </p>
      </div>
    </div>

    <ol class="flex flex-col divide-y divide-border/50">
      {#each rest as entry, index (entry.playerVersionId)}
        <li
          class="flex items-center gap-3 px-5 py-3"
          aria-label={`Rank ${String(index + 2)}: ${playerName(entry.playerVersionId)}, ${oneDecimal(entry.perGame)} per game`}
        >
          <span class="w-6 shrink-0 font-mono text-sm font-bold text-muted-foreground">
            {index + 2}
          </span>
          {#if faces.get(entry.playerVersionId)}
            <SeasonPlayerFace face={faces.get(entry.playerVersionId)!} {manifest} size="sm" />
          {/if}
          <span class="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {playerName(entry.playerVersionId)}
          </span>
          <span class="shrink-0 text-right">
            <span class="font-display block text-lg leading-none font-extrabold tabular-nums">
              {valueText(entry.value)}
            </span>
            <span class="mt-0.5 block font-mono text-xs text-muted-foreground">
              {oneDecimal(entry.perGame)}/g
            </span>
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
