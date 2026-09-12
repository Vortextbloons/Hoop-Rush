<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonAwards,
    SeasonPlayerAggregate,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import { Info, ShieldCheck, Trophy, Zap } from '@lucide/svelte';
  import { awardsViewModel } from '$lib/season/season-postseason-presentation';
  import {
    eraIdentityOf,
    franchiseIdentityOf,
    type SeasonFaceRef,
  } from '$lib/season/season-branding';
  import { awardStatLine, honorsLineOf } from '$lib/season/season-honors-view';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  let {
    awards,
    playerName,
    franchiseName,
    manifest = null,
    faces = null,
    aggregates = null,
    rosterByVersion = null,
    franchiseAbbrev = null,
  }: {
    awards: SeasonAwards;
    playerName: (playerVersionId: string) => string;
    franchiseName: (franchiseId: string) => string;
    manifest?: HoopRushManifest | null;
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
    aggregates?:
      readonly SeasonPlayerAggregate[] | ReadonlyMap<string, SeasonPlayerAggregate> | null;
    rosterByVersion?: ReadonlyMap<string, SeasonRosterEntry> | null;
    franchiseAbbrev?: ((franchiseId: string) => string) | null;
  } = $props();
  function isAggregateMap(
    value: readonly SeasonPlayerAggregate[] | ReadonlyMap<string, SeasonPlayerAggregate>,
  ): value is ReadonlyMap<string, SeasonPlayerAggregate> {
    return value instanceof Map;
  }
  const view = $derived(awardsViewModel(awards, playerName, franchiseName));
  const mvp = $derived(view.awards[0] ?? null);
  const dpoy = $derived(view.awards[1] ?? null);
  const sixth = $derived(view.awards[2] ?? null);
  const aggregateMap = $derived.by(() => {
    if (aggregates === null) return new Map<string, SeasonPlayerAggregate>();
    if (isAggregateMap(aggregates)) return aggregates;
    const map = new Map<string, SeasonPlayerAggregate>();
    for (const row of aggregates) map.set(row.playerVersionId, row);
    return map;
  });
  const faceOf = (playerVersionId: string): SeasonFaceRef | null => {
    const face = faces?.get(playerVersionId);
    return face ?? null;
  };
  function teamOf(playerVersionId: string) {
    const roster = rosterByVersion?.get(playerVersionId);
    if (roster === undefined || manifest === null) return null;
    const modern = franchiseIdentityOf(manifest, roster.franchiseId);
    if (modern === null) return null;
    const era = eraIdentityOf(manifest, roster.franchiseId, roster.eraId);
    return {
      franchiseId: roster.franchiseId,
      teamExternalId: modern.teamExternalId,
      logoCandidates: era.logoCandidates,
    };
  }
  function shortTeam(franchiseId: string, fallback: string): string {
    try {
      return franchiseAbbrev?.(franchiseId) ?? fallback;
    } catch {
      return fallback;
    }
  }
  const mvpLine = $derived(
    mvp ? honorsLineOf(aggregateMap.get(mvp.playerVersionId) ?? null) : null,
  );
  const mvpStats = $derived(
    mvp ? (awardStatLine(aggregateMap.get(mvp.playerVersionId) ?? null, 'mvp') ?? null) : null,
  );
  const dpoyStats = $derived(
    dpoy ? (awardStatLine(aggregateMap.get(dpoy.playerVersionId) ?? null, 'dpoy') ?? null) : null,
  );
  const sixthStats = $derived(
    sixth
      ? (awardStatLine(aggregateMap.get(sixth.playerVersionId) ?? null, 'sixth-man') ?? null)
      : null,
  );
  const mvpTeam = $derived(mvp ? teamOf(mvp.playerVersionId) : null);
</script>

<section aria-labelledby="awards-heading" data-season-awards class="min-w-0">
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div class="min-w-0">
      <h2 id="awards-heading" class="font-display text-xl font-extrabold uppercase tracking-tight">
        Season awards
      </h2>
      <p class="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        Regular-season awards · Players must appear in at least 70% of games.
        <span
          tabindex="0"
          role="note"
          aria-label="Rate-stat leaders and awards require 70 percent of team games. If nobody qualifies, the top available players are shown."
          title="Rate-stat leaders and awards require 70% of team games. If nobody qualifies, the top available players are shown."
          class="inline-flex items-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <Info class="h-3.5 w-3.5" />
        </span>
      </p>
    </div>
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-[1.9fr_1fr]">
    {#if mvp}
      <article
        data-season-award={mvp.key}
        aria-label="Most Valuable Player: {mvp.playerName}"
        class="relative overflow-hidden rounded-2xl border border-accent/40 bg-surface-1"
      >
        <div class="absolute inset-x-0 top-0 h-1 bg-accent" aria-hidden="true"></div>
        {#if mvpLine}
          <span
            aria-hidden="true"
            class="font-display pointer-events-none absolute -right-2 -bottom-6 hidden text-[7.5rem] leading-none font-extrabold tabular-nums opacity-[0.08] select-none sm:block"
          >
            {mvpLine.ppg.toFixed(1)}
          </span>
        {/if}
        <div class="relative p-5 sm:p-6">
          <p class="flex items-center gap-2">
            <span
              class="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground"
              aria-hidden="true"
            >
              <Trophy class="h-4.5 w-4.5" />
            </span>
            <span class="font-mono text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              Most Valuable Player
            </span>
          </p>
          <div class="mt-4 flex items-start gap-4">
            {#if manifest !== null && faceOf(mvp.playerVersionId) !== null}
              <SeasonPlayerFace face={faceOf(mvp.playerVersionId)!} {manifest} size="xl" eager />
            {/if}
            <div class="min-w-0 flex-1">
              <h3
                class="font-display text-4xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-5xl"
              >
                {mvp.playerName}
              </h3>
              <p
                class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
              >
                {#if mvpTeam && manifest !== null}
                  <SeasonTeamLogo
                    {manifest}
                    franchiseId={mvpTeam.franchiseId}
                    teamExternalId={mvpTeam.teamExternalId}
                    logoCandidates={mvpTeam.logoCandidates}
                    alt=""
                    size="sm"
                  />
                {/if}
                <span class="font-semibold text-foreground">
                  {shortTeam(mvp.franchiseId, mvp.franchiseLabel)}
                </span>
                {#if mvpLine}
                  <span aria-hidden="true">·</span>
                  <span>{mvpLine.gamesPlayed} GP</span>
                {/if}
              </p>
            </div>
          </div>
          {#if mvpStats && mvpLine}
            <p class="mt-4 text-base font-bold tracking-tight sm:text-lg">
              {mvpStats}
            </p>
            <p class="mt-1 font-mono text-xs text-muted-foreground">
              {mvpLine.points.toLocaleString('en-US')} PTS · {mvpLine.gamesPlayed} games
            </p>
          {/if}
        </div>
      </article>
    {/if}

    <div class="grid gap-4">
      {#if dpoy}
        <article
          data-season-award={dpoy.key}
          aria-label="Defensive Player of the Year: {dpoy.playerName}"
          class="rounded-2xl border border-border bg-surface-1 p-5"
        >
          <p
            class="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase"
          >
            <ShieldCheck class="h-4 w-4 shrink-0" aria-hidden="true" />
            Defensive Player of the Year
          </p>
          <div class="mt-3 flex items-center gap-3">
            {#if manifest !== null && faceOf(dpoy.playerVersionId) !== null}
              <SeasonPlayerFace face={faceOf(dpoy.playerVersionId)!} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <h3 class="truncate text-2xl font-extrabold tracking-tight">{dpoy.playerName}</h3>
              <p class="mt-0.5 truncate text-[13px] text-muted-foreground">
                {shortTeam(dpoy.franchiseId, dpoy.franchiseLabel)}
              </p>
            </div>
          </div>
          {#if dpoyStats}
            <p class="mt-3 text-[15px] font-bold tracking-tight">{dpoyStats}</p>
          {/if}
        </article>
      {/if}
      {#if sixth}
        <article
          data-season-award={sixth.key}
          aria-label="Sixth Man of the Year: {sixth.playerName}"
          class="rounded-2xl border border-border bg-surface-1 p-5"
        >
          <p
            class="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.16em] text-primary uppercase"
          >
            <Zap class="h-4 w-4 shrink-0" aria-hidden="true" />
            Sixth Man of the Year
          </p>
          <div class="mt-3 flex items-center gap-3">
            {#if manifest !== null && faceOf(sixth.playerVersionId) !== null}
              <SeasonPlayerFace face={faceOf(sixth.playerVersionId)!} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <h3 class="truncate text-2xl font-extrabold tracking-tight">{sixth.playerName}</h3>
              <p class="mt-0.5 truncate text-[13px] text-muted-foreground">
                {shortTeam(sixth.franchiseId, sixth.franchiseLabel)}
              </p>
            </div>
          </div>
          {#if sixthStats}
            <p class="mt-3 text-[15px] font-bold tracking-tight">{sixthStats}</p>
          {/if}
        </article>
      {/if}
    </div>
  </div>

  <div class="mt-4 rounded-2xl border border-border bg-surface-1 p-5 sm:p-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="font-display text-lg font-extrabold uppercase tracking-tight">
        All-League First Team
      </h3>
      <p class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        First Team · Best five players
      </p>
    </div>
    <ol class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {#each view.firstTeam as member (member.playerVersionId)}
        {@const line = honorsLineOf(aggregateMap.get(member.playerVersionId) ?? null)}
        {@const stats = awardStatLine(
          aggregateMap.get(member.playerVersionId) ?? null,
          'first-team',
        )}
        {@const team = teamOf(member.playerVersionId)}
        <li
          data-season-award="first-team"
          class="min-w-0 rounded-xl border border-border/70 bg-surface-2 p-4"
        >
          <div class="flex items-center gap-3">
            {#if manifest !== null && faceOf(member.playerVersionId) !== null}
              <SeasonPlayerFace face={faceOf(member.playerVersionId)!} {manifest} size="md" />
            {/if}
            {#if team && manifest !== null}
              <span class="ml-auto">
                <SeasonTeamLogo
                  {manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  logoCandidates={team.logoCandidates}
                  alt=""
                  size="sm"
                />
              </span>
            {/if}
          </div>
          <p class="mt-3 truncate text-base font-bold tracking-tight">{member.playerName}</p>
          <p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {shortTeam(member.franchiseId, member.franchiseLabel)}{#if line}
              · {line.gamesPlayed} GP{/if}
          </p>
          {#if stats}
            <p class="mt-2 text-[13px] font-semibold tracking-tight text-foreground/90">{stats}</p>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
</section>
