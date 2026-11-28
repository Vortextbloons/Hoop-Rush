<script lang="ts">
  import type {
    CapRushSourcePlayer,
    FullCourtDraftState,
    FullCourtReportKind,
    Position,
  } from '@hoop-rush/data-contracts';
  import {
    FULL_COURT_MAX_ROSTER_SIZE,
    FULL_COURT_MIN_ROSTER_SIZE,
    POSITIONS,
    franchiseAbbreviation,
  } from '@hoop-rush/data-contracts';
  import {
    fullCourtAbsenceTolerance,
    fullCourtSalaryDollarsOf,
    type FullCourtCatalogIndex,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import { Lock, Users, X } from '@lucide/svelte';
  import DraftPoolFilters from '#lib/components/draft/DraftPoolFilters.svelte';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import type { ProfileTab } from '#lib/components/PlayerProfileSheet.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Disclosure from '#lib/components/ui/Disclosure.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import IconButton from '#lib/components/ui/IconButton.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { teamLabelFor } from '#lib/branding.js';
  import { formatPositions } from '#lib/player-positions.js';
  import { buildPlayerProfile, defaultSlotForPositions } from '#lib/players/player-profile.js';
  import { capRushProfileInput } from '#lib/features/cap-rush/cap-rush-player-profile.js';
  import {
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import { loadFullCourtArt, type FullCourtArt } from './full-court-art.js';
  import {
    FULL_COURT_CATALOG_PAGE_SIZE,
    fullCourtCatalogPage,
    fullCourtCatalogRowForPlayer,
    fullCourtDraftSummary,
    fullCourtLockCopy,
    fullCourtPickReasonLabel,
    fullCourtProfileReferences,
    fullCourtSigningImpact,
    fullCourtVariantLabel,
    type FullCourtCatalogRow,
    type FullCourtCatalogSort,
  } from './full-court-draft-presentation.js';
  import FullCourtAbandonRun from './FullCourtAbandonRun.svelte';
  import FullCourtDraftCard from './FullCourtDraftCard.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';
  import FullCourtRosterFitPanel from './FullCourtRosterFitPanel.svelte';

  let {
    draft,
    index,
    busy,
    onPick,
    onRemove,
    onFinish,
    onAbandon,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    busy: boolean;
    onPick: (versionId: string) => void;
    onRemove: (versionId: string) => void;
    onFinish: () => void;
    onAbandon?: () => void;
  } = $props();

  const ROSTER_TICKS = Array.from({ length: FULL_COURT_MAX_ROSTER_SIZE }, (_, slot) => slot);
  const SORT_OPTIONS: readonly { value: FullCourtCatalogSort; label: string }[] = [
    { value: 'default', label: 'Pool' },
    { value: 'overall-desc', label: 'OVR' },
    { value: 'salary-asc', label: '$ Low' },
    { value: 'salary-desc', label: '$ High' },
  ];

  let art = $state.raw<FullCourtArt | null>(null);
  let search = $state('');
  let position = $state<Position | null>(null);
  let sort = $state<FullCourtCatalogSort>('default');
  let signableOnly = $state(false);
  let pageIndex = $state(0);
  let selectedVersionId = $state<string | null>(null);
  let inspectorPanel = $state<HTMLDivElement>();
  let profileVersionId = $state<string | null>(null);
  let profileTab = $state<ProfileTab>('details');

  onMount(() => {
    let mounted = true;
    void loadFullCourtArt()
      .then((loaded) => {
        if (mounted) art = loaded;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  });

  const summary = $derived(fullCourtDraftSummary(draft, index));
  const roundOffer = $derived(draft.offer ?? null);
  const catalogPage = $derived(
    roundOffer !== null
      ? { rows: [], total: 0 }
      : fullCourtCatalogPage(index, draft, {
          search,
          position,
          sort,
          signableOnly,
          limit: FULL_COURT_CATALOG_PAGE_SIZE,
          offset: pageIndex * FULL_COURT_CATALOG_PAGE_SIZE,
        }),
  );
  const candidateRows = $derived(
    roundOffer === null
      ? catalogPage.rows.map((row) => ({ row, bucket: undefined }))
      : roundOffer.cards.map(({ player, bucket }) => ({
          row: fullCourtCatalogRowForPlayer(index, draft, player),
          bucket,
        })),
  );
  const DRAFT_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const positionCounts = $derived(
    DRAFT_POSITIONS.map((position) => ({
      position,
      count: draft.picks.filter((pick) => pick.player.positions.includes(position)).length,
    })),
  );
  let rosterDetails = $state<HTMLDetailsElement>();
  const rosterPicks = $derived([...draft.picks].reverse());
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
    const filtered = search.trim() !== '' || position !== null || signableOnly;
    const noun = catalogPage.total === 1 ? 'player' : 'players';
    return `${String(catalogPage.total)} ${filtered ? 'matching' : 'available'} ${noun}`;
  });
  const depthLabel = $derived.by(() => {
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
  /**
   * One scouting report covers the whole draft. Owning it unlocks Show playstyle
   * on every card and in the inspector; the price is run-wide.
   */
  const PERK_LABELS: readonly { kind: FullCourtReportKind; label: string }[] = [
    { kind: 'player-scouting', label: 'Scouting' },
    { kind: 'lineup-fit', label: 'Roster fit' },
    { kind: 'opponent-film', label: 'Opponent film' },
    { kind: 'training-camp', label: 'Training camp' },
  ];
  const ownedPerks = $derived.by(() => {
    const owned = new Set((draft.reports ?? []).map((report) => report.kind));
    return PERK_LABELS.filter((perk) => owned.has(perk.kind));
  });
  const scoutingOwned = $derived(ownedPerks.some((perk) => perk.kind === 'player-scouting'));
  const selectedProfile = $derived.by(() => {
    if (profileVersionId === null) return null;
    const player = index.byVersionId.get(profileVersionId);
    if (player === undefined) return null;
    return {
      player,
      view: profileFor(player),
      face: art?.faceFor(player) ?? null,
      salaryDollars: fullCourtSalaryDollarsOf(player),
      signed: draft.picks.some((pick) => pick.player.playerVersionId === player.playerVersionId),
    };
  });
  const inspectedRow = $derived(
    (
      candidateRows.find(({ row }) => row.player.playerVersionId === selectedVersionId) ??
      candidateRows[0]
    )?.row ?? null,
  );
  const inspectedProfile = $derived(
    !scoutingOwned || inspectedRow === null ? null : profileFor(inspectedRow.player),
  );
  const inspectedChips = $derived(inspectedProfile === null ? [] : traitChips(inspectedProfile));

  function traitChips(profile: ReturnType<typeof buildPlayerProfile>) {
    return [
      ...profile.strengths
        .slice(0, 3)
        .map((trait) => ({ label: trait.label, tone: 'good' as const })),
      ...profile.weaknesses
        .slice(0, 3)
        .map((trait) => ({ label: trait.label, tone: 'bad' as const })),
    ];
  }

  function profileFor(player: CapRushSourcePlayer) {
    const slot = defaultSlotForPositions(player.positions);
    const reference = fullCourtProfileReferences(index).forSlot(slot) ?? null;
    return buildPlayerProfile(capRushProfileInput(player, teamLabel(player), slot), reference);
  }

  function updateSearch(value: string): void {
    search = value;
    pageIndex = 0;
  }

  function selectPosition(index: number | null): void {
    position = index === null ? null : (POSITIONS[index] ?? null);
    pageIndex = 0;
  }

  function updateSort(next: FullCourtCatalogSort): void {
    sort = next;
    pageIndex = 0;
  }

  function toggleSignableOnly(): void {
    signableOnly = !signableOnly;
    pageIndex = 0;
  }

  function previousPage(): void {
    pageIndex = Math.max(0, pageIndex - 1);
  }

  function nextPage(): void {
    pageIndex = Math.min(pageCount - 1, pageIndex + 1);
  }

  function selectPlayer(versionId: string): void {
    selectedVersionId = versionId;
    if (!window.matchMedia('(min-width: 64rem)').matches) inspectorPanel?.focus();
  }

  function teamFor(player: CapRushSourcePlayer) {
    return art === null ? null : art.teamFor(player.franchiseId);
  }

  function teamLabel(player: CapRushSourcePlayer): string {
    return art === null
      ? franchiseAbbreviation(player.franchiseId)
      : teamLabelFor(art.manifest, player.franchiseId, player.eraId);
  }

  function teamShortLabel(player: CapRushSourcePlayer): string {
    const team = teamFor(player);
    return team?.abbreviation ?? franchiseAbbreviation(player.franchiseId);
  }

  function openProfile(versionId: string, tab: ProfileTab = 'details'): void {
    profileVersionId = versionId;
    profileTab = tab;
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
  class="px-3 pt-4 pb-[calc(7.5rem_+_env(safe-area-inset-bottom))] sm:px-6 lg:pb-10"
  aria-busy={busy ? 'true' : undefined}
>
  <header class="flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p class="ui-label">
        {fullCourtVariantLabel(draft)} · {roundOffer !== null
          ? `Round ${String(roundOffer.round + 1)}`
          : 'Draft night'}
      </p>
      <h1
        class="font-display mt-2 text-3xl leading-[0.95] font-extrabold tracking-tight uppercase sm:text-4xl"
      >
        {#if roundOffer !== null}
          Pick your next player.
        {:else}
          Build your roster
        {/if}
      </h1>
      <p class="mt-1.5 max-w-2xl text-sm text-muted-foreground">
        {#if roundOffer !== null}
          Sign 6–12 players under the {formatMillions(draft.money.hardLimitDollars)} hard limit.
        {:else}
          Sign 6–12 up to the second apron.
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
      <dl class="mt-2 grid grid-cols-5 gap-1 text-center" aria-label="Roster position coverage">
        {#each positionCounts as { position, count } (position)}
          <div class="rounded-md bg-surface-2 py-1">
            <dt class="ui-micro">{position}</dt>
            <dd class="font-mono text-sm font-semibold tabular-nums">{count}</dd>
          </div>
        {/each}
      </dl>
      <p class="mt-1 text-xs text-muted-foreground">Players count at every listed position.</p>
      <p class="ui-micro mt-1.5">Six needed to lock</p>
    </div>
  </header>

  <div class="mt-4 space-y-3">
    <Panel as="section" class="px-4 py-3 sm:px-5 sm:py-3.5" aria-label="Draft payroll and budget">
      <div
        class="grid gap-3 lg:grid-cols-[minmax(170px,210px)_minmax(0,1fr)_minmax(260px,auto)] lg:items-center lg:gap-5"
      >
        <div class="flex items-center justify-between gap-3 lg:block">
          <div>
            <p class="ui-label text-muted-foreground">Player payroll</p>
            <p
              class="font-display mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums {summary.status ===
              'illegal'
                ? 'text-negative'
                : ''}"
            >
              {formatMillions(summary.payrollDollars)}
            </p>
          </div>
          <span
            class="inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.1em] uppercase lg:mt-1 {capStatusClass(
              summary.status,
            )}">{capStatusLabel(summary.status)}</span
          >
        </div>

        <div class="min-w-0">
          <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
            <span class="absolute inset-y-0 left-0 bg-positive/70" style:width={`${capPct}%`}
            ></span>
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
          <div
            class="mt-1.5 flex font-mono text-[8px] tracking-[0.04em] text-muted-foreground uppercase sm:text-[9px]"
          >
            <span class="flex justify-between" style:width={`${capPct}%`}>
              <span>$0</span><span>{formatMillions(draft.money.capLineDollars)}</span>
            </span>
            <span
              class="invisible text-center sm:visible"
              style:width={`${firstApronPct - capPct}%`}
            >
              {formatMillions(draft.money.firstApronDollars)}
            </span>
            <span class="text-right" style:width={`${100 - firstApronPct}%`}>
              {formatMillions(draft.money.hardLimitDollars)}
            </span>
          </div>
        </div>

        <StatGrid columns={3} mobile={3}>
          <StatTile
            label="Room"
            size="sm"
            surface="tile"
            valueClass="font-sans text-[11px] font-extrabold sm:text-xs"
            tone={summary.payrollRoomDollars < 0 ? 'negative' : 'default'}
            value={formatMillions(summary.payrollRoomDollars)}
          />
          <StatTile
            label="Budget"
            size="sm"
            surface="tile"
            valueClass="font-sans text-[11px] font-extrabold sm:text-xs"
            tone={summary.warChestDollars === 0 ? 'negative' : 'default'}
            value={formatMillions(summary.warChestDollars)}
          />
          <StatTile
            label="Spent"
            size="sm"
            surface="tile"
            valueClass="font-sans text-[11px] font-extrabold sm:text-xs"
            value={formatMillions(summary.spentDollars)}
          />
        </StatGrid>
      </div>

      <div
        class="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-soft pt-2.5"
      >
        <p class="text-[11px] font-bold">{depthLabel}</p>
        <p class="ui-micro">
          {FULL_COURT_MIN_ROSTER_SIZE}–{FULL_COURT_MAX_ROSTER_SIZE} players
        </p>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span class="ui-micro">
          Run perks
          {summary.perkSpendDollars > 0
            ? `· ${formatMillions(summary.perkSpendDollars)} spent`
            : '· none purchased'}
        </span>
        {#each ownedPerks as perk (perk.kind)}
          <Badge tone="neutral">{perk.label}</Badge>
        {/each}
      </div>
    </Panel>

    <div
      class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,370px)] xl:grid-cols-[minmax(0,1fr)_400px]"
    >
      <Panel
        as="section"
        padding="none"
        aria-label={roundOffer !== null
          ? 'Current round offer'
          : draft.pool === undefined
            ? 'Open player catalog'
            : 'Draft player pool'}
      >
        {#if roundOffer === null}
          <div class="border-b border-line-soft p-3 sm:p-4">
            <SectionHeading
              level={2}
              size="sm"
              title={draft.pool === undefined ? 'Open catalog' : 'Draft pool'}
              description={draft.pool === undefined
                ? 'Search all eligible historical seasons.'
                : `${String(draft.pool.playerVersionIds.length)}-player pool for this run.`}
            >
              {#snippet actions()}
                <span class="ui-micro">{catalogCountLabel}</span>
              {/snippet}
            </SectionHeading>

            <div class="mt-3 space-y-2.5">
              <DraftPoolFilters
                {search}
                position={position === null ? null : POSITIONS.indexOf(position)}
                onsearch={updateSearch}
                onposition={selectPosition}
              />

              <div class="flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl
                  label="Sort players"
                  value={sort}
                  onchange={updateSort}
                  options={SORT_OPTIONS}
                />
                <Button
                  size="sm"
                  tone={signableOnly ? 'primary' : 'secondary'}
                  aria-pressed={signableOnly}
                  onclick={toggleSignableOnly}
                >
                  Signable only
                </Button>
              </div>
            </div>
          </div>
        {:else}
          <div class="border-b border-line-soft p-3 sm:p-4">
            <SectionHeading
              level={2}
              size="sm"
              title="Round offer"
              description="Select a player to see the cost and sign them."
            />
          </div>
        {/if}
        {#if candidateRows.length === 0}
          <EmptyState
            surface="none"
            title="No players match this view"
            message="Clear the search, position filter, or signable toggle."
          />
        {:else}
          <ul
            class="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 p-2.5 sm:gap-2.5 sm:p-3"
          >
            {#each candidateRows as { row, bucket } (row.player.playerVersionId)}
              <li class="min-w-0">
                <FullCourtDraftCard
                  {row}
                  {bucket}
                  {art}
                  selected={inspectedRow?.player.playerVersionId === row.player.playerVersionId}
                  onSelect={() => selectPlayer(row.player.playerVersionId)}
                />
              </li>
            {/each}
          </ul>
        {/if}
        {#if roundOffer === null && candidateRows.length > 0}
          <div
            class="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft p-2.5 sm:px-4"
          >
            <p class="ui-micro">
              {#if catalogPage.total === 0}
                No players on this page
              {:else}
                Showing {pageStart}–{pageEnd} of {catalogPage.total}
              {/if}
            </p>
            <div class="flex items-center gap-2">
              <Button size="sm" tone="secondary" disabled={pageIndex === 0} onclick={previousPage}>
                Previous
              </Button>
              <span class="ui-micro tabular-nums">Page {pageIndex + 1} of {pageCount}</span>
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

      <div class="space-y-3 lg:sticky lg:top-4">
        <div
          bind:this={inspectorPanel}
          tabindex="-1"
          class="scroll-mt-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Panel as="section" padding="md" aria-label="Selected player">
            {#if inspectedRow === null}
              <EmptyState
                surface="none"
                title="No player selected"
                message="Choose a player to see the signing cost."
              />
            {:else}
              {@const row = inspectedRow}
              {@const team = teamFor(row.player)}
              {@const impact = fullCourtSigningImpact(row, draft.money)}
              {@const blocker = fullCourtPickReasonLabel(row.assessment, draft.money)}
              {@const signable = row.assessment.legal && !row.onRoster}
              {@const rosterSizeAfter = summary.rosterCount + 1}

              <div class="flex items-start gap-2.5">
                <FullCourtPortrait player={row.player} {art} size="md" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <h3 class="font-display min-w-0 truncate text-lg font-extrabold tracking-tight">
                      {row.player.displayName}
                    </h3>
                    <FullCourtRating
                      value={row.player.originalOverall}
                      size="sm"
                      layout="stacked"
                    />
                  </div>
                  <p
                    class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground uppercase"
                  >
                    {#if team !== null && art !== null}
                      <TeamLogo
                        manifest={art.manifest}
                        franchiseId={team.franchiseId}
                        teamExternalId={team.teamExternalId}
                        className="h-3.5 w-3.5"
                      />
                    {/if}
                    <span class="truncate"
                      >{teamShortLabel(row.player)} · {row.player.seasonKey}</span
                    >
                  </p>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      class="rounded border border-line-soft bg-surface-1 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
                    >
                      {row.player.positions.join('/')}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-3 border-t border-line-soft pt-2.5">
                <div class="flex items-baseline justify-between gap-2">
                  <div class="min-w-0">
                    <span class="ui-micro">Salary</span>
                    <p
                      class="font-display text-2xl leading-none font-extrabold tracking-tight tabular-nums"
                    >
                      {formatMillions(row.salaryDollars)}
                    </p>
                  </div>
                  <span
                    class="inline-flex shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {capStatusClass(
                      row.statusAfterPick,
                    )}"
                  >
                    {capStatusLabel(row.statusAfterPick)}
                  </span>
                </div>
                <StatGrid class="mt-3" columns={2} mobile={2}>
                  <StatTile
                    label="Budget after signing"
                    size="sm"
                    surface="tile"
                    value={impact.warChestAfter}
                  />
                  <StatTile
                    label="Payroll room after"
                    size="sm"
                    surface="tile"
                    value={impact.roomAfter}
                  />
                  {#if signable && row.assessment.projectedPayroll !== null}
                    <StatTile
                      label="Payroll at legal finish"
                      size="sm"
                      surface="tile"
                      value={formatMillions(row.assessment.projectedPayroll)}
                    />
                  {/if}
                  {#if signable && rosterSizeAfter >= FULL_COURT_MIN_ROSTER_SIZE}
                    <StatTile
                      label="Absences covered after"
                      size="sm"
                      surface="tile"
                      value={fullCourtAbsenceTolerance(rosterSizeAfter)}
                    />
                  {/if}
                </StatGrid>
              </div>

              {#if impact.apronShift !== null}
                <p
                  class="mt-2 rounded border border-accent/35 bg-accent/[0.08] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.04em] text-accent uppercase"
                >
                  {impact.apronShift}
                </p>
              {/if}

              {#if blocker !== null && !row.onRoster}
                <p
                  class="mt-2 rounded border border-negative/40 bg-negative/10 px-2 py-1 text-[11px] font-semibold text-negative"
                >
                  {blocker}
                </p>
              {/if}

              <div class="mt-3 flex items-center gap-2">
                {#if row.onRoster}
                  <Button
                    tone="secondary"
                    class="flex-1"
                    disabled={busy}
                    onclick={() => onRemove(row.player.playerVersionId)}
                  >
                    <X size={14} aria-hidden="true" />
                    Remove
                  </Button>
                {:else}
                  <Button
                    tone={signable ? 'primary' : 'secondary'}
                    class="flex-1"
                    disabled={busy || !signable}
                    aria-label={rowActionLabel(row) + ' ' + row.player.displayName}
                    onclick={() => onPick(row.player.playerVersionId)}
                  >
                    {rowActionLabel(row)}
                  </Button>
                {/if}
                <Button
                  tone="secondary"
                  size="sm"
                  onclick={() => openProfile(row.player.playerVersionId, 'ratings')}
                >
                  All attributes
                </Button>
              </div>
              <div class="mt-3">
                {#if scoutingOwned && inspectedProfile !== null}
                  <Disclosure summary="Show playstyle" meta="Scouting report active">
                    <div class="mt-2 grid gap-2">
                      <p
                        class="truncate font-mono text-[9px] font-bold tracking-[0.08em] text-accent uppercase"
                      >
                        {inspectedProfile.archetype}
                      </p>
                      {#if inspectedChips.length > 0}
                        <div class="flex flex-wrap items-start gap-1">
                          {#each inspectedChips as chip (chip.label)}
                            <span
                              class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] leading-tight font-bold tracking-[0.04em] uppercase {chip.tone ===
                              'good'
                                ? 'border-positive/40 bg-positive/10 text-positive'
                                : 'border-negative/45 bg-negative/10 text-negative'}"
                              >{chip.label}</span
                            >
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </Disclosure>
                {:else}
                  <p class="text-xs text-muted-foreground">
                    Scouting was not purchased at run setup.
                  </p>
                {/if}
              </div>
            {/if}
          </Panel>
        </div>
        <aside id="draft-roster" class="scroll-mt-4" aria-label="Draft roster">
          <Panel as="section" padding="none">
            <div class="border-b border-line-soft p-3">
              <SectionHeading level={2} size="sm" title="Roster">
                {#snippet actions()}
                  <span class="ui-micro">{summary.rosterCount} / {FULL_COURT_MAX_ROSTER_SIZE}</span>
                {/snippet}
              </SectionHeading>
              <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
                Six to twelve players. Lock the roster once you have six.
              </p>
            </div>

            <details bind:this={rosterDetails}>
              <summary class="cursor-pointer px-3 py-3 text-sm font-semibold"
                >View signed players</summary
              >
              {#if rosterPicks.length === 0}
                <EmptyState
                  surface="none"
                  title="No players signed yet"
                  message="Sign 6 to 12 players to start your rotation."
                />
              {:else}
                <ul
                  class="max-h-[38vh] divide-y divide-line-soft overflow-y-auto overscroll-contain"
                >
                  {#each rosterPicks as pick (pick.player.playerVersionId)}
                    {@const team = teamFor(pick.player)}
                    <li class="flex min-w-0 items-center gap-2 p-2.5">
                      <FullCourtPortrait player={pick.player} {art} size="sm" />
                      <div class="min-w-0 flex-1">
                        <button
                          type="button"
                          class="font-display block max-w-full truncate rounded text-left text-xs font-extrabold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          onclick={() => openProfile(pick.player.playerVersionId)}
                        >
                          {pick.player.displayName}
                        </button>
                        <p class="ui-micro flex min-w-0 items-center gap-1">
                          {#if team !== null && art !== null}
                            <TeamLogo
                              manifest={art.manifest}
                              franchiseId={team.franchiseId}
                              teamExternalId={team.teamExternalId}
                              className="h-3 w-3"
                            />
                          {/if}
                          <span class="truncate"
                            >{teamShortLabel(pick.player)} · {pick.player.seasonKey} ·
                            {formatPositions(pick.player.positions)}</span
                          >
                        </p>
                      </div>
                      <div class="shrink-0 text-right">
                        <FullCourtRating
                          value={pick.player.originalOverall}
                          size="sm"
                          layout="inline"
                          align="right"
                        />
                        <p
                          class="mt-0.5 font-mono text-[10px] font-bold tabular-nums text-muted-foreground"
                        >
                          {formatMillions(pick.salaryDollars)}
                        </p>
                      </div>
                      <IconButton
                        label={`Remove ${pick.player.displayName} from the roster`}
                        size="sm"
                        disabled={busy}
                        onclick={() => onRemove(pick.player.playerVersionId)}
                      >
                        <X size={14} aria-hidden="true" />
                      </IconButton>
                    </li>
                  {/each}
                </ul>
              {/if}
            </details>

            <div class="space-y-2.5 border-t border-line-soft p-3">
              <p class="text-[11px] leading-snug font-semibold">{absenceLabel}</p>
              <div class="rounded-lg border border-line-soft bg-surface-1 p-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-display text-sm font-extrabold uppercase">{lock.headline}</span>
                  {#if lock.stamp !== null}
                    <Badge tone="positive">{lock.stamp}</Badge>
                  {/if}
                </div>
                <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">{lock.detail}</p>
                <Button
                  tone="primary"
                  class="mt-2.5 w-full"
                  disabled={busy || !summary.canFinish}
                  onclick={onFinish}
                >
                  <Lock size={15} aria-hidden="true" />
                  Lock the roster
                </Button>
              </div>
            </div>
          </Panel>
        </aside>

        {#if (draft.reports ?? []).some((report) => report.kind === 'lineup-fit')}
          <FullCourtRosterFitPanel {draft} {art} />
        {/if}
      </div>
    </div>

    {#if onAbandon !== undefined}
      <div class="border-t border-line-soft pt-3">
        <FullCourtAbandonRun {busy} {onAbandon} />
      </div>
    {/if}

    <div
      class="fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-30 flex items-center gap-2 rounded-xl border border-line-strong bg-card/95 p-2.5 shadow-lg backdrop-blur lg:hidden"
      role="group"
      aria-label="Draft actions"
    >
      <a
        href="#draft-roster"
        onclick={() => {
          if (rosterDetails) rosterDetails.open = true;
        }}
        class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-bold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Users size={14} aria-hidden="true" />
        <span>Roster {summary.rosterCount}</span>
      </a>
      <div class="min-w-0 flex-1">
        <p class="font-display truncate text-xs font-extrabold uppercase">{lock.headline}</p>
      </div>
      <Button size="sm" tone="primary" disabled={busy || !summary.canFinish} onclick={onFinish}>
        <Lock size={14} aria-hidden="true" />
        Lock
      </Button>
    </div>
  </div>
</PageShell>

{#if selectedProfile !== null}
  <!-- No apron tab: Cap Rush's apron view keys off its fixed cap constants, not this draft's pinned money. -->
  <PlayerProfileSheet
    profile={selectedProfile.view}
    face={selectedProfile.face}
    manifest={art?.manifest ?? null}
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
