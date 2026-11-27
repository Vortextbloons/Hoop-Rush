<script lang="ts">
  import type {
    CapRushSourcePlayer,
    FullCourtDraftState,
    HoopRushManifest,
    PlayersIndexEntry,
    Position,
    FullCourtReportTarget,
  } from '@hoop-rush/data-contracts';
  import {
    FULL_COURT_MAX_ROSTER_SIZE,
    FULL_COURT_MIN_ROSTER_SIZE,
    POSITIONS,
    fullCourtReportPriceDollars,
    fullCourtReportScope,
    fullCourtReportTargetKey,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtAssessPurchase,
    fullCourtSalaryDollarsOf,
    type FullCourtCatalogIndex,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import { Check, Eye, FileSearch, Lock, Users, X } from '@lucide/svelte';
  import DraftPoolFilters from '#lib/components/draft/DraftPoolFilters.svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import type { ProfileTab } from '#lib/components/PlayerProfileSheet.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { franchiseIdentityOf, initialsOf, teamLabelFor } from '#lib/branding.js';
  import { getManifest, getPlayersIndex } from '#lib/data.js';
  import { formatPositions } from '#lib/player-positions.js';
  import { buildPlayerProfile } from '#lib/players/player-profile.js';
  import { capRushProfileInput } from '#lib/features/cap-rush/cap-rush-player-profile.js';
  import {
    capStatusClass,
    capStatusLabel,
    capStatusShortLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import {
    FULL_COURT_CATALOG_PAGE_SIZE,
    formatWarChestCr,
    fullCourtCatalogPage,
    fullCourtDraftSummary,
    fullCourtFaceIndex,
    fullCourtFaceKey,
    fullCourtLockCopy,
    fullCourtPickReasonLabel,
    fullCourtProfileReferences,
    fullCourtSigningImpact,
    fullCourtVariantLabel,
    type FullCourtCatalogRow,
  } from './full-court-draft-presentation.js';
  import FullCourtScoutDialog from './FullCourtScoutDialog.svelte';

  let {
    draft,
    index,
    busy,
    onPick,
    onRemove,
    onFinish,
    onPurchaseReport,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    busy: boolean;
    onPick: (versionId: string) => void;
    onRemove: (versionId: string) => void;
    onFinish: () => void;
    onPurchaseReport?: (target: FullCourtReportTarget) => void;
  } = $props();

  const ROSTER_TICKS = Array.from({ length: FULL_COURT_MAX_ROSTER_SIZE }, (_, slot) => slot);

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let faces = $state.raw<ReadonlyMap<string, PlayersIndexEntry>>(new Map());
  let search = $state('');
  let position = $state<Position | null>(null);
  let pageIndex = $state(0);
  let profileVersionId = $state<string | null>(null);
  let profileTab = $state<ProfileTab>('details');
  let scoutVersionId = $state<string | null>(null);

  onMount(() => {
    let mounted = true;
    void Promise.allSettled([getManifest(), getPlayersIndex()]).then(([branding, players]) => {
      if (!mounted) return;
      if (branding.status === 'fulfilled') manifest = branding.value;
      if (players.status === 'fulfilled') faces = fullCourtFaceIndex(players.value);
    });
    return () => {
      mounted = false;
    };
  });

  const summary = $derived(fullCourtDraftSummary(draft, index));
  const catalogPage = $derived(
    fullCourtCatalogPage(index, draft, {
      search,
      position,
      limit: FULL_COURT_CATALOG_PAGE_SIZE,
      offset: pageIndex * FULL_COURT_CATALOG_PAGE_SIZE,
    }),
  );
  const rosterPicks = $derived([...draft.picks].reverse());
  const complete = $derived(draft.stage === 'complete');
  const pageCount = $derived(
    Math.max(1, Math.ceil(catalogPage.total / FULL_COURT_CATALOG_PAGE_SIZE)),
  );
  const pageStart = $derived(
    catalogPage.total === 0 ? 0 : pageIndex * FULL_COURT_CATALOG_PAGE_SIZE + 1,
  );
  const pageEnd = $derived(pageIndex * FULL_COURT_CATALOG_PAGE_SIZE + catalogPage.rows.length);
  const capPct = $derived(
    Math.min(100, (draft.money.capLineDollars / draft.money.hardLimitDollars) * 100),
  );
  const firstApronPct = $derived(
    Math.min(100, (draft.money.firstApronDollars / draft.money.hardLimitDollars) * 100),
  );
  const payrollPct = $derived(
    Math.min(100, (summary.payrollDollars / draft.money.hardLimitDollars) * 100),
  );
  const catalogCountLabel = $derived.by(() => {
    const filtered = search.trim() !== '' || position !== null;
    const noun = catalogPage.total === 1 ? 'player' : 'players';
    return `${String(catalogPage.total)} ${filtered ? 'matching' : 'available'} ${noun}`;
  });
  const depthLabel = $derived.by(() => {
    if (complete) return 'Roster confirmed for the run.';
    if (summary.rosterCount >= FULL_COURT_MAX_ROSTER_SIZE) {
      return 'Twelve players. Lock the roster.';
    }
    const cost = summary.depthForecastDollars;
    if (cost === null) return 'No legal completion remains in the catalog.';
    if (summary.rosterCount < FULL_COURT_MIN_ROSTER_SIZE) {
      return `Cheapest legal finish ${formatMillions(cost)}.`;
    }
    return `Next depth player from ${formatMillions(cost)}.`;
  });
  const absenceLabel = $derived.by(() => {
    const count = summary.rosterCount;
    if (count < FULL_COURT_MIN_ROSTER_SIZE) {
      const open = FULL_COURT_MIN_ROSTER_SIZE - count;
      return `${String(open)} more ${open === 1 ? 'player' : 'players'} to reach the six-player minimum.`;
    }
    if (count >= FULL_COURT_MAX_ROSTER_SIZE) {
      return 'A full twelve-player roster absorbs seven simultaneous absences.';
    }
    const tolerance = summary.absenceTolerance;
    return `Absorbs ${String(tolerance)} simultaneous ${tolerance === 1 ? 'absence' : 'absences'} before dropping below five.`;
  });
  const lock = $derived(fullCourtLockCopy(draft, summary));
  const scoutPrice = fullCourtReportPriceDollars('player-scouting');
  const scoutScopeLabel = $derived(
    fullCourtReportScope('player-scouting') === 'run' ? 'Lifetime of this run' : 'This game only',
  );
  const scoutAssessment = $derived(
    fullCourtAssessPurchase({ index, state: draft, priceDollars: scoutPrice }),
  );
  const scoutRecords = $derived(
    new Map(
      (draft.reports ?? [])
        .filter((report) => report.target.kind === 'player-scouting')
        .map((report) => [fullCourtReportTargetKey(report.target), report]),
    ),
  );
  const selectedScout = $derived.by(() => {
    if (scoutVersionId === null) return null;
    const player = index.byVersionId.get(scoutVersionId);
    if (player === undefined) return null;
    const record = scoutRecordFor(player.playerVersionId) ?? null;
    return record === null ? null : { player, record };
  });
  const selectedProfile = $derived.by(() => {
    if (profileVersionId === null) return null;
    const player = index.byVersionId.get(profileVersionId);
    if (player === undefined) return null;
    return {
      player,
      view: profileFor(player),
      face: faceFor(player),
      salaryDollars: fullCourtSalaryDollarsOf(player),
      signed: draft.picks.some((pick) => pick.player.playerVersionId === player.playerVersionId),
    };
  });
  const catalogRoles = $derived(
    new Map(
      catalogPage.rows.map(({ player }) => [player.playerVersionId, profileFor(player).archetype]),
    ),
  );

  function profileFor(player: CapRushSourcePlayer) {
    const reference = fullCourtProfileReferences(index).forSlot(player.positions[0] ?? '') ?? null;
    return buildPlayerProfile(capRushProfileInput(player, teamLabel(player)), reference);
  }

  function updateSearch(value: string): void {
    search = value;
    pageIndex = 0;
  }

  function selectPosition(index: number | null): void {
    position = index === null ? null : (POSITIONS[index] ?? null);
    pageIndex = 0;
  }

  function previousPage(): void {
    pageIndex = Math.max(0, pageIndex - 1);
  }

  function nextPage(): void {
    pageIndex = Math.min(pageCount - 1, pageIndex + 1);
  }

  function faceFor(player: CapRushSourcePlayer): PlayersIndexEntry | null {
    return faces.get(fullCourtFaceKey(player)) ?? null;
  }

  function teamFor(player: CapRushSourcePlayer) {
    return manifest === null ? null : franchiseIdentityOf(manifest, player.franchiseId);
  }

  function teamLabel(player: CapRushSourcePlayer): string {
    return manifest === null
      ? player.franchiseId
      : teamLabelFor(manifest, player.franchiseId, player.eraId);
  }

  function openProfile(versionId: string): void {
    profileVersionId = versionId;
    profileTab = 'details';
  }

  function scoutRecordFor(versionId: CapRushSourcePlayer['playerVersionId']) {
    return (
      scoutRecords.get(
        fullCourtReportTargetKey({ kind: 'player-scouting', playerVersionId: versionId }),
      ) ?? null
    );
  }

  function scoutBlocker(assessment: ReturnType<typeof fullCourtAssessPurchase>): string | null {
    if (assessment.legal) return null;
    if (assessment.reason === 'completion') return 'No legal roster finish remains';
    if (assessment.minimumCompletionDollars !== null) {
      return `Needs ${formatWarChestCr(assessment.minimumCompletionDollars)} to finish`;
    }
    return 'War Chest short';
  }

  function buyScout(player: CapRushSourcePlayer): void {
    if (onPurchaseReport === undefined || busy || !scoutAssessment.legal) return;
    if (scoutRecordFor(player.playerVersionId) !== null) return;
    onPurchaseReport({ kind: 'player-scouting', playerVersionId: player.playerVersionId });
  }

  function openScoutReport(player: CapRushSourcePlayer): void {
    if (scoutRecordFor(player.playerVersionId) === null) return;
    scoutVersionId = player.playerVersionId;
  }

  function statusTone(
    status: ReturnType<typeof fullCourtDraftSummary>['status'],
  ): 'default' | 'muted' | 'primary' | 'accent' | 'negative' {
    switch (status) {
      case 'under-cap':
        return 'default';
      case 'first-apron':
        return 'accent';
      case 'second-apron':
        return 'primary';
      case 'illegal':
        return 'negative';
    }
  }

  function rowActionLabel(row: FullCourtCatalogRow): string {
    if (row.onRoster) return 'Signed';
    if (row.playerRostered) return 'Rostered';
    return 'Sign';
  }
</script>

<PageShell
  width="full"
  padding="none"
  class="px-3 pt-4 pb-[calc(9rem_+_env(safe-area-inset-bottom))] sm:px-6 min-[1100px]:pb-10"
  aria-busy={busy ? 'true' : undefined}
>
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p class="ui-label">{fullCourtVariantLabel(draft)} · Draft night</p>
      <h1
        class="font-display mt-2 text-3xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-4xl"
      >
        {complete ? 'Your roster is locked.' : 'Build your roster'}
      </h1>
      <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {#if complete}
          Every salary is fixed. Here is the depth, the payroll bill, and the War Chest left behind.
        {:else}
          Six to twelve players. Positions shape matchups, never eligibility.
        {/if}
      </p>
    </div>

    <div class="w-full max-w-56">
      <div class="flex items-baseline justify-between gap-3">
        <span class="ui-label text-muted-foreground">Roster</span>
        <span class="font-mono text-sm font-bold tabular-nums"
          >{summary.rosterCount} / {FULL_COURT_MAX_ROSTER_SIZE}</span
        >
      </div>
      <div
        class="mt-1.5 flex h-2.5 items-stretch gap-0.5"
        role="img"
        aria-label={`${String(summary.rosterCount)} of ${String(FULL_COURT_MAX_ROSTER_SIZE)} roster places filled; six are needed to lock`}
      >
        {#each ROSTER_TICKS as tick (tick)}
          <span
            class="flex-1 rounded-[2px] {tick < summary.rosterCount
              ? 'bg-primary'
              : 'bg-surface-3'} {tick === FULL_COURT_MIN_ROSTER_SIZE - 1 ? 'mr-1.5' : ''}"
          ></span>
        {/each}
      </div>
      <p class="ui-micro mt-1.5">Six needed to lock</p>
    </div>
  </header>

  <div class="mt-4 space-y-3">
    <Panel as="section" class="px-4 py-3 sm:px-5" aria-label="Draft payroll and War Chest">
      <StatGrid columns={3} mobile={3}>
        <StatTile
          label="Player payroll"
          size="lg"
          surface="tile"
          value={formatMillions(summary.payrollDollars)}
          note={`${formatMillions(summary.payrollRoomDollars)} under the hard limit`}
          tone={summary.status === 'illegal' ? 'negative' : 'default'}
        />
        <StatTile
          label="Apron"
          size="md"
          surface="tile"
          value={capStatusLabel(summary.status)}
          note={`${formatMillions(draft.money.hardLimitDollars)} hard limit`}
          tone={statusTone(summary.status)}
        />
        <StatTile
          label="War Chest"
          size="lg"
          surface="tile"
          value={formatWarChestCr(summary.warChestDollars)}
          note={`${formatWarChestCr(summary.spentDollars)} spent`}
          tone={summary.warChestDollars === 0 ? 'negative' : 'default'}
        />
      </StatGrid>

      <div class="mt-3 min-w-0">
        <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
          <span class="absolute inset-y-0 left-0 bg-positive/70" style:width={`${capPct}%`}></span>
          <span
            class="absolute inset-y-0 bg-accent/70"
            style:left={`${capPct}%`}
            style:width={`${firstApronPct - capPct}%`}
          ></span>
          <span
            class="absolute inset-y-0 bg-primary/70"
            style:left={`${firstApronPct}%`}
            style:width={`${100 - firstApronPct}%`}
          ></span>
          {#if payrollPct > 0}
            <span
              class="absolute inset-y-0 w-0.5 bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.65)]"
              style:left={`calc(${payrollPct}% - 1px)`}
            ></span>
          {/if}
        </div>
        <div class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p class="font-mono text-[9px] text-muted-foreground">
            Cap {formatMillions(draft.money.capLineDollars)} · First apron
            {formatMillions(draft.money.firstApronDollars)} · Hard limit
            {formatMillions(draft.money.hardLimitDollars)}
          </p>
          <span
            class="inline-flex rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em] uppercase {capStatusClass(
              summary.status,
            )}">{capStatusShortLabel(summary.status)}</span
          >
        </div>
      </div>

      <div
        class="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-soft pt-2.5"
      >
        <p class="text-[11px] font-semibold">{depthLabel}</p>
        <p class="ui-micro">{FULL_COURT_MIN_ROSTER_SIZE}–{FULL_COURT_MAX_ROSTER_SIZE} players</p>
      </div>
    </Panel>

    <div class="draft-layout">
      <div class="draft-main">
        <Panel
          as="section"
          padding="none"
          aria-label={draft.pool === undefined ? 'Open player catalog' : 'Draft player pool'}
        >
          <div class="border-b border-line-soft p-3 sm:p-4">
            <SectionHeading
              level={2}
              size="sm"
              title={draft.pool === undefined ? 'Open catalog' : 'Draft pool'}
              description={draft.pool === undefined
                ? 'Search every eligible historical season. Every position is legal.'
                : `Curated ${String(draft.pool.playerVersionIds.length)}-player pool for this run. Every position is legal.`}
            >
              {#snippet actions()}
                <span class="ui-micro">{catalogCountLabel}</span>
              {/snippet}
            </SectionHeading>

            <div class="mt-3">
              <DraftPoolFilters
                {search}
                position={position === null ? null : POSITIONS.indexOf(position)}
                onsearch={updateSearch}
                onposition={selectPosition}
              />
            </div>
          </div>

          {#if catalogPage.rows.length === 0}
            <div class="p-8 text-center">
              <p class="text-sm font-semibold">No players match this view.</p>
              <p class="mt-1 text-xs text-muted-foreground">
                Clear the search or choose a different position.
              </p>
            </div>
          {:else}
            <ul class="grid gap-1.5 p-2 sm:grid-cols-2 sm:p-2.5 xl:grid-cols-3">
              {#each catalogPage.rows as row (row.player.playerVersionId)}
                {@const face = faceFor(row.player)}
                {@const team = teamFor(row.player)}
                {@const impact = fullCourtSigningImpact(row, draft.money)}
                {@const blocker = fullCourtPickReasonLabel(row.assessment, draft.money)}
                {@const signable = row.assessment.legal && !row.onRoster && !complete}
                {@const scoutRecord = scoutRecordFor(row.player.playerVersionId)}
                {@const scoutBlocked = scoutBlocker(scoutAssessment)}
                <li class="min-w-0">
                  <article
                    class="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card {row.onRoster
                      ? 'border-primary/50 bg-primary/5'
                      : row.assessment.legal
                        ? 'border-border hover:border-line-strong'
                        : 'border-border/70 opacity-80'}"
                  >
                    <div class="flex min-w-0 items-start gap-2 p-2.5">
                      {#if face !== null && manifest !== null}
                        <button
                          type="button"
                          class="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`${row.player.displayName} details`}
                          onclick={() => openProfile(row.player.playerVersionId)}
                        >
                          <PlayerFace
                            player={face}
                            {manifest}
                            size="md"
                            fallbackInitials={initialsOf(row.player.displayName)}
                          />
                        </button>
                      {:else}
                        <span
                          class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-3 font-display text-sm font-extrabold text-muted-foreground"
                          aria-hidden="true">{initialsOf(row.player.displayName)}</span
                        >
                      {/if}
                      <div class="min-w-0 flex-1">
                        <div class="flex items-baseline justify-between gap-2">
                          <button
                            type="button"
                            class="min-w-0 truncate rounded text-left font-display text-sm font-extrabold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`${row.player.displayName} details`}
                            onclick={() => openProfile(row.player.playerVersionId)}
                          >
                            {row.player.displayName}
                          </button>
                          <span
                            class="shrink-0 font-mono text-[11px] font-bold text-muted-foreground tabular-nums"
                            aria-label={`Overall ${String(row.player.originalOverall)}`}
                            >{row.player.originalOverall}</span
                          >
                        </div>
                        <p
                          class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground"
                        >
                          {#if team !== null && manifest !== null}
                            <TeamLogo
                              {manifest}
                              franchiseId={team.franchiseId}
                              teamExternalId={team.teamExternalId}
                              className="h-3.5 w-3.5"
                            />
                          {/if}
                          <span class="truncate uppercase"
                            >{row.player.seasonKey} · {teamLabel(row.player)}</span
                          >
                        </p>
                        <p class="mt-1 text-xs font-semibold text-foreground">
                          {catalogRoles.get(row.player.playerVersionId)}
                        </p>
                        <div class="mt-1 flex flex-wrap gap-1">
                          {#each row.player.positions as slot (slot)}
                            <span
                              class="rounded border border-line-soft bg-surface-1 px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
                              >{slot}</span
                            >
                          {/each}
                        </div>
                      </div>
                    </div>

                    <div
                      class="mx-2.5 flex items-baseline justify-between gap-2 border-t border-line-soft py-1.5"
                    >
                      <p class="font-display text-lg leading-none font-extrabold tabular-nums">
                        {formatMillions(row.salaryDollars)}
                      </p>
                      <span
                        class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {capStatusClass(
                          row.statusAfterPick,
                        )}">{capStatusShortLabel(row.statusAfterPick)}</span
                      >
                    </div>

                    {#if onPurchaseReport !== undefined}
                      <div
                        class="mx-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line-soft py-1.5"
                      >
                        <p class="min-w-0 flex-1 font-mono text-[9px] text-muted-foreground">
                          {#if scoutRecord !== null}
                            Scouting report · {scoutScopeLabel}
                          {:else}
                            Scout {formatWarChestCr(scoutPrice)} · {scoutScopeLabel}
                            {#if scoutBlocked !== null}
                              <span class="font-bold text-negative"> · {scoutBlocked}</span>
                            {/if}
                          {/if}
                        </p>
                        {#if scoutRecord !== null}
                          <Button
                            size="sm"
                            tone="secondary"
                            disabled={busy}
                            aria-label={`Open scouting report for ${row.player.displayName}`}
                            onclick={() => openScoutReport(row.player)}
                          >
                            <Eye size={13} aria-hidden="true" />
                            Report
                          </Button>
                        {:else}
                          <Button
                            size="sm"
                            tone="secondary"
                            disabled={busy || !scoutAssessment.legal}
                            aria-label={`Scout ${row.player.displayName} for ${formatWarChestCr(scoutPrice)}`}
                            onclick={() => buyScout(row.player)}
                          >
                            <FileSearch size={13} aria-hidden="true" />
                            Scout
                          </Button>
                        {/if}
                      </div>
                    {/if}

                    {#if signable}
                      <dl class="mx-2.5 grid gap-0.5 pb-2 font-mono text-[9px] leading-snug">
                        <div class="flex items-baseline justify-between gap-2">
                          <dt class="text-muted-foreground">Payroll after</dt>
                          <dd class="font-bold tabular-nums">{impact.payrollAfter}</dd>
                        </div>
                        <div class="flex items-baseline justify-between gap-2">
                          <dt class="text-muted-foreground">Room left</dt>
                          <dd class="font-bold tabular-nums">{impact.roomAfter}</dd>
                        </div>
                        <div class="flex items-baseline justify-between gap-2">
                          <dt class="text-muted-foreground">War Chest after</dt>
                          <dd class="font-bold tabular-nums">{impact.warChestAfter}</dd>
                        </div>
                        {#if impact.apronShift !== null}
                          <div class="flex items-baseline justify-between gap-2 text-accent">
                            <dt class="font-bold uppercase">Apron</dt>
                            <dd class="font-bold">{impact.apronShift}</dd>
                          </div>
                        {/if}
                        {#if row.assessment.projectedPayroll !== null}
                          <div class="flex items-baseline justify-between gap-2">
                            <dt class="text-muted-foreground">Cheapest finish</dt>
                            <dd class="font-bold tabular-nums">
                              {formatMillions(row.assessment.projectedPayroll)}
                            </dd>
                          </div>
                        {/if}
                      </dl>
                    {/if}

                    <div class="mt-auto flex items-end gap-2 p-2.5 pt-1">
                      <p
                        class="min-w-0 flex-1 text-[10px] leading-snug {blocker === null
                          ? 'text-muted-foreground'
                          : 'font-semibold text-negative'}"
                      >
                        {#if blocker !== null}
                          {blocker}
                        {:else if row.onRoster}
                          On the roster.
                        {:else if complete}
                          Roster is locked.
                        {:else}
                          Fits payroll and the War Chest.
                        {/if}
                      </p>
                      <Button
                        size="sm"
                        tone={signable ? 'primary' : 'default'}
                        disabled={busy || !signable}
                        aria-label={`${rowActionLabel(row)} ${row.player.displayName}`}
                        onclick={() => onPick(row.player.playerVersionId)}
                      >
                        {#if row.onRoster}
                          <Check size={13} aria-hidden="true" />
                        {/if}
                        {rowActionLabel(row)}
                      </Button>
                    </div>
                  </article>
                </li>
              {/each}
            </ul>

            <div
              class="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft p-2.5"
            >
              <p class="ui-micro">
                {#if catalogPage.total === 0}
                  No players on this page
                {:else}
                  Showing {pageStart}–{pageEnd} of {catalogPage.total}
                {/if}
              </p>
              <div class="flex items-center gap-2">
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={pageIndex === 0}
                  onclick={previousPage}
                >
                  Previous
                </Button>
                <span class="font-mono text-[10px] text-muted-foreground tabular-nums"
                  >Page {pageIndex + 1} of {pageCount}</span
                >
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={pageIndex >= pageCount - 1}
                  onclick={nextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          {/if}
        </Panel>

        <div
          class="finish-bar mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-card/95 p-3 shadow-lg backdrop-blur"
          role="group"
          aria-label="Draft actions"
        >
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span class="font-display text-sm font-extrabold uppercase">{lock.headline}</span>
              {#if lock.stamp !== null}
                <span class="lock-stamp">{lock.stamp}</span>
              {/if}
            </p>
            <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">{lock.detail}</p>
          </div>
          <a
            href="#draft-roster"
            class="roster-jump items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-bold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Users size={14} aria-hidden="true" />
            <span>Roster {summary.rosterCount}</span>
          </a>
          {#if complete}
            <Badge tone="positive"><Check size={13} aria-hidden="true" /> Locked</Badge>
          {:else}
            <Button tone="primary" disabled={busy || !summary.canFinish} onclick={onFinish}>
              <Lock size={15} aria-hidden="true" />
              Lock the roster
            </Button>
          {/if}
        </div>
      </div>

      <aside id="draft-roster" class="roster-panel" aria-label="Draft roster">
        <Panel as="section" padding="none">
          <div class="border-b border-line-soft p-3">
            <SectionHeading level={2} size="sm" title="Roster" align="center">
              {#snippet actions()}
                <span class="ui-micro">{summary.rosterCount} / {FULL_COURT_MAX_ROSTER_SIZE}</span>
              {/snippet}
            </SectionHeading>
            <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
              Six to twelve players. Locking skips every unused place; remove anyone before
              confirming.
            </p>
          </div>

          {#if rosterPicks.length === 0}
            <p class="p-4 text-center text-xs leading-relaxed text-muted-foreground">
              No players yet. Search the catalog and sign the first piece of the rotation.
            </p>
          {:else}
            <ul class="roster-list divide-y divide-line-soft">
              {#each rosterPicks as pick (pick.player.playerVersionId)}
                {@const face = faceFor(pick.player)}
                {@const team = teamFor(pick.player)}
                <li class="flex min-w-0 items-center gap-2 p-2.5">
                  {#if face !== null && manifest !== null}
                    <PlayerFace
                      player={face}
                      {manifest}
                      size="sm"
                      fallbackInitials={initialsOf(pick.player.displayName)}
                    />
                  {:else}
                    <span
                      class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                      aria-hidden="true">{initialsOf(pick.player.displayName)}</span
                    >
                  {/if}
                  <div class="min-w-0 flex-1">
                    <button
                      type="button"
                      class="block max-w-full truncate rounded text-left font-display text-xs font-extrabold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${pick.player.displayName} details`}
                      onclick={() => openProfile(pick.player.playerVersionId)}
                    >
                      {pick.player.displayName}
                    </button>
                    <p
                      class="flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground"
                    >
                      {#if team !== null && manifest !== null}
                        <TeamLogo
                          {manifest}
                          franchiseId={team.franchiseId}
                          teamExternalId={team.teamExternalId}
                          className="h-3 w-3"
                        />
                      {/if}
                      <span class="truncate uppercase"
                        >{pick.player.seasonKey} · {formatPositions(pick.player.positions)}</span
                      >
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="font-mono text-xs font-bold tabular-nums">
                      {formatMillions(pick.salaryDollars)}
                    </p>
                    <p class="ui-micro">Pick {pick.pickOrdinal + 1}</p>
                  </div>
                  {#if !complete}
                    <button
                      type="button"
                      class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-soft text-muted-foreground outline-none transition-colors hover:border-negative/50 hover:text-negative focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                      disabled={busy}
                      aria-label={`Remove ${pick.player.displayName} from the roster`}
                      onclick={() => onRemove(pick.player.playerVersionId)}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          <div class="space-y-1.5 border-t border-line-soft p-3">
            <p class="text-[11px] leading-snug font-semibold">{absenceLabel}</p>
          </div>
        </Panel>
      </aside>
    </div>
  </div>
</PageShell>

{#if selectedProfile !== null}
  <!-- No apron tab: Cap Rush's apron view keys off its fixed cap constants, not this draft's pinned money. -->
  <PlayerProfileSheet
    profile={selectedProfile.view}
    face={selectedProfile.face}
    {manifest}
    money={{
      salaryLabel: formatMillions(selectedProfile.salaryDollars),
      statusLabel: selectedProfile.signed ? 'Signed' : 'Projected',
      note: null,
    }}
    tabs={['details', 'tendencies', 'ratings']}
    bind:tab={profileTab}
    open
    onOpenChange={(open) => {
      if (!open) profileVersionId = null;
    }}
  />
{/if}

{#if selectedScout !== null}
  <FullCourtScoutDialog
    player={selectedScout.player}
    priceDollars={selectedScout.record.priceDollars}
    purchasedRevision={selectedScout.record.purchasedRevision}
    onclose={() => {
      scoutVersionId = null;
    }}
  />
{/if}

<style>
  .draft-layout {
    display: grid;
    gap: 1rem;
  }
  .draft-main {
    min-width: 0;
    order: -1;
  }
  .roster-panel {
    min-width: 0;
    scroll-margin-top: 1rem;
    scroll-margin-bottom: 8rem;
  }
  .roster-list {
    max-height: 48vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .roster-jump {
    display: inline-flex;
    min-height: 2.25rem;
  }
  .lock-stamp {
    padding: 0.05rem 0.4rem;
    border: 1px solid color-mix(in srgb, var(--color-positive) 55%, transparent);
    border-radius: 0.25rem;
    color: var(--color-positive);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    line-height: 1.5;
    text-transform: uppercase;
  }
  /* Pinned below the single-column layout so the roster jump and the lock stay
     reachable wherever the reader is in the draft. */
  .finish-bar {
    position: fixed;
    right: 0.75rem;
    bottom: max(0.75rem, env(safe-area-inset-bottom));
    left: 0.75rem;
    z-index: 30;
  }
  @media (min-width: 1100px) {
    .draft-layout {
      grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
      align-items: start;
    }
    .draft-main {
      order: 0;
    }
    .roster-panel {
      order: -1;
      position: sticky;
      top: 1rem;
    }
    .roster-jump {
      display: none;
    }
    .finish-bar {
      position: sticky;
      right: auto;
      bottom: 0.75rem;
      left: auto;
    }
  }
  @media (max-width: 639px) {
    .roster-list {
      max-height: none;
      overflow: visible;
    }
  }
</style>
