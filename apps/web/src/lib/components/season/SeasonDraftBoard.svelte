<script lang="ts">
  import type { HoopRushManifest, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
  import { resolveHistoricalIdentitySpans } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    COVERAGE_TARGETS,
    coverageNeeds,
    humanizeCoverageReason,
    SOLO_PARTICIPANT_ID,
    type SeasonDraftFlowState,
  } from '$lib/season/season-draft-flow';
  import { formatPositions } from '$lib/player-positions';
  import { frontOfficeEntryOf } from '@hoop-rush/data-contracts';
  let {
    flow,
    catalog,
    manifest,
    faces,
    busy,
    error,
    onDraw,
    onPick,
    onFinalize,
  }: {
    flow: SeasonDraftFlowState;
    catalog: SeasonDraftCatalog;
    manifest: HoopRushManifest;
    faces: Map<string, SeasonFaceRef>;
    busy: boolean;
    error: string | null;
    onDraw: () => void;
    onPick: (playerVersionId: string) => void;
    onFinalize: () => void;
  } = $props();
  const draft = $derived(flow.draft);
  const participant = $derived(
    draft?.participants.find((p) => p.participantId === SOLO_PARTICIPANT_ID) ?? null,
  );
  const eraLabel = (eraId: string): string =>
    manifest.eras.find((e) => e.eraId === eraId)?.label ?? 'Unknown era';
  const franchiseLabel = (franchiseId: string): string =>
    manifest.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId)?.displayName ??
    'Unknown team';
  const teamShortLabel = (franchiseId: string, eraId: string): string => {
    try {
      const spans = resolveHistoricalIdentitySpans(manifest, franchiseId, eraId);
      const last = spans[spans.length - 1];
      if (last) return last.displayName;
    } catch {}
    return franchiseLabel(franchiseId);
  };
  const teamFullLabel = (franchiseId: string, eraId: string): string =>
    eraIdentityOf(manifest, franchiseId, eraId).displayLabel ?? franchiseLabel(franchiseId);
  const executiveLabel = (executiveId: string): string => {
    try {
      const entry = frontOfficeEntryOf(executiveId as never);
      return `${entry.displayName} · ${entry.title}`;
    } catch {
      return 'Unknown executive';
    }
  };
  const picks = $derived(
    draft ? draft.picks.filter((p) => p.participantId === SOLO_PARTICIPANT_ID) : [],
  );
  const needs = $derived(
    draft ? coverageNeeds(picks, catalog) : { guards: 0, forwards: 0, centers: 0 },
  );
  const guardsNeed = $derived(Math.max(0, COVERAGE_TARGETS.guards - needs.guards));
  const forwardsNeed = $derived(Math.max(0, COVERAGE_TARGETS.forwards - needs.forwards));
  const centersNeed = $derived(Math.max(0, COVERAGE_TARGETS.centers - needs.centers));
  const guardTone = $derived(needTone(needs.guards, COVERAGE_TARGETS.guards));
  const forwardTone = $derived(needTone(needs.forwards, COVERAGE_TARGETS.forwards));
  const centerTone = $derived(needTone(needs.centers, COVERAGE_TARGETS.centers));
  const needsSummary = $derived.by((): string | null => {
    const parts: string[] = [];
    if (guardsNeed > 0) parts.push(`${String(guardsNeed)} guard${guardsNeed === 1 ? '' : 's'}`);
    if (forwardsNeed > 0)
      parts.push(`${String(forwardsNeed)} forward${forwardsNeed === 1 ? '' : 's'}`);
    if (centersNeed > 0)
      parts.push(`${String(centersNeed)} center-eligible player${centersNeed === 1 ? '' : 's'}`);
    if (parts.length === 0) return 'Roster minimums covered — best available.';
    if (parts.length === 1) return `You still need ${parts[0] ?? ''}.`;
    const last = parts.pop();
    return `You still need ${parts.join(', ')} and ${last ?? ''}.`;
  });
  function needDisplay(have: number, target: number): string {
    if (have > target) return `${String(target)}+ of ${String(target)}`;
    return `${String(have)} of ${String(target)}`;
  }
  function needTone(have: number, target: number): 'complete' | 'need-one' | 'urgent' {
    const need = target - have;
    if (need <= 0) return 'complete';
    if (need === 1) return 'need-one';
    return 'urgent';
  }
  function needStatus(have: number, target: number): string {
    const need = target - have;
    if (need <= 0) return 'Complete';
    return need === 1 ? 'Need 1' : `Need ${String(need)}`;
  }
  const NEED_BOX_TONE: Record<'complete' | 'need-one' | 'urgent', string> = {
    complete: 'border-border bg-surface-2',
    'need-one': 'border-primary/60 bg-primary/5',
    urgent: 'border-destructive/60 bg-destructive/10',
  };
  const NEED_COUNT_TONE: Record<'complete' | 'need-one' | 'urgent', string> = {
    complete: 'text-foreground',
    'need-one': 'text-foreground',
    urgent: 'text-destructive',
  };
  const NEED_STATUS_TONE: Record<'complete' | 'need-one' | 'urgent', string> = {
    complete: 'text-muted-foreground',
    'need-one': 'font-bold text-primary',
    urgent: 'font-bold text-destructive',
  };
  function coverageOf(playable: readonly string[]): { g: boolean; f: boolean; c: boolean } {
    const set = new Set(playable);
    return {
      g: set.has('PG') || set.has('SG'),
      f: set.has('SF') || set.has('PF'),
      c: set.has('C'),
    };
  }
  function fillsAnOpenNeed(playable: readonly string[]): boolean {
    const covers = coverageOf(playable);
    return (
      (guardsNeed > 0 && covers.g) ||
      (forwardsNeed > 0 && covers.f) ||
      (centersNeed > 0 && covers.c)
    );
  }
  const offer = $derived(draft?.currentOffer ?? null);
  const canDraw = $derived(
    !busy &&
      draft !== null &&
      draft.status === 'drafting' &&
      draft.currentTurnParticipantId !== null &&
      offer === null,
  );
  const isFinalRoundDone = $derived(picks.length >= 10);
  const canFinalize = $derived(!busy && isFinalRoundDone && draft?.status === 'drafting');
  function candidateOf(playerVersionId: string) {
    return catalog.candidates.find((c) => c.playerVersionId === playerVersionId) ?? null;
  }
  function faceOf(playerVersionId: string): SeasonFaceRef | null {
    return faces.get(playerVersionId) ?? null;
  }
  function pickRoundLabel(pickOrdinal: number): string {
    return `R${String(pickOrdinal)}`;
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if draft}
    <div class="rounded-none bg-surface-1 sm:rounded-xl">
      <div class="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div class="min-w-0">
          <p
            data-season-round-heading
            class="font-display text-lg font-extrabold tracking-tight uppercase"
          >
            Round {draft.round} of 10
          </p>
          {#if draft.frontOffice}
            <p class="mt-1 text-xs text-muted-foreground">
              {executiveLabel(draft.frontOffice.executiveId)}
            </p>
          {/if}
        </div>
        <p class="shrink-0 pt-0.5 text-right text-sm font-bold tracking-tight uppercase">
          {#if participant}
            {franchiseLabel(participant.franchiseId)}
          {:else}
            Team to be set
          {/if}
        </p>
      </div>

      <section aria-labelledby="season-needs-heading" class="mt-4 px-4 pb-4 sm:px-5 sm:pb-5">
        <h2
          id="season-needs-heading"
          class="font-mono text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase"
        >
          Roster needs
        </h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          One versatile player may cover more than one group.
        </p>
        <dl class="mt-2 grid grid-cols-3 gap-2">
          <div class="rounded-lg border p-2 text-center {NEED_BOX_TONE[guardTone]}">
            <dt class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              Guards
            </dt>
            <dd class="font-display mt-0.5 text-xl font-extrabold {NEED_COUNT_TONE[guardTone]}">
              {needDisplay(needs.guards, COVERAGE_TARGETS.guards)}
            </dd>
            <dd class="mt-0.5 text-[11px] {NEED_STATUS_TONE[guardTone]}">
              {needStatus(needs.guards, COVERAGE_TARGETS.guards)}
            </dd>
          </div>
          <div class="rounded-lg border p-2 text-center {NEED_BOX_TONE[forwardTone]}">
            <dt class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              Forwards
            </dt>
            <dd class="font-display mt-0.5 text-xl font-extrabold {NEED_COUNT_TONE[forwardTone]}">
              {needDisplay(needs.forwards, COVERAGE_TARGETS.forwards)}
            </dd>
            <dd class="mt-0.5 text-[11px] {NEED_STATUS_TONE[forwardTone]}">
              {needStatus(needs.forwards, COVERAGE_TARGETS.forwards)}
            </dd>
          </div>
          <div class="rounded-lg border p-2 text-center {NEED_BOX_TONE[centerTone]}">
            <dt class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              Centers
            </dt>
            <dd class="font-display mt-0.5 text-xl font-extrabold {NEED_COUNT_TONE[centerTone]}">
              {needDisplay(needs.centers, COVERAGE_TARGETS.centers)}
            </dd>
            <dd class="mt-0.5 text-[11px] {NEED_STATUS_TONE[centerTone]}">
              {needStatus(needs.centers, COVERAGE_TARGETS.centers)}
            </dd>
          </div>
        </dl>
        {#if needsSummary}
          <p class="mt-2 text-xs font-semibold">{needsSummary}</p>
        {/if}
        {#if offer}
          <p class="mt-2 text-xs text-muted-foreground">
            Pick {offer.pickOrdinal} of 10 — choose one.
          </p>
        {:else if canDraw}
          <button
            type="button"
            onclick={onDraw}
            disabled={busy}
            class="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          >
            Draw round {draft.round} →
          </button>
        {:else if draft.status === 'drafting'}
          <p class="mt-3 text-xs text-muted-foreground">Waiting for the draw…</p>
        {/if}
      </section>
    </div>

    {#if offer}
      <section
        aria-labelledby="season-offer-heading"
        class="rounded-none bg-surface-1 p-4 sm:rounded-xl sm:p-5"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="season-offer-heading"
            class="font-display text-base font-extrabold tracking-tight uppercase"
          >
            Pick {offer.pickOrdinal} of 10
          </h2>
          <span class="text-xs text-muted-foreground">
            {offer.cards.filter((card) => card.selectable).length} of {offer.cards.length} available
          </span>
        </div>
        {#if needsSummary}
          <p class="mt-1 text-xs font-semibold">{needsSummary}</p>
        {/if}
        <ul class="mt-3 grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each offer.cards as card (card.playerVersionId)}
            {@const candidate = candidateOf(card.playerVersionId)}
            {@const identity = candidate
              ? eraIdentityOf(manifest, candidate.franchiseId, candidate.eraId)
              : { displayLabel: null, logoCandidates: [] }}
            {@const playable = candidate?.positions.playable ?? []}
            {@const covers = coverageOf(playable)}
            {@const fillsNeed = card.selectable && fillsAnOpenNeed(playable)}
            {@const shortTeam = candidate
              ? teamShortLabel(candidate.franchiseId, candidate.eraId)
              : null}
            {@const fullTeam = candidate
              ? (identity.displayLabel ??
                (candidate ? franchiseLabel(candidate.franchiseId) : 'Unknown team'))
              : 'Unknown team'}
            {@const playerName = candidate?.displayName ?? 'Unknown player'}
            {@const teamLine =
              `${shortTeam ?? (candidate ? franchiseLabel(candidate.franchiseId) : 'Unknown team')}${candidate ? ` · ${eraLabel(candidate.eraId)}` : ''}`}
            <li
              class="flex h-full min-w-0 flex-col gap-2 rounded-lg border bg-surface-2 p-3 {fillsNeed
                ? 'border-primary/60'
                : 'border-transparent'}"
              class:opacity-70={!card.selectable}
            >
              <div class="flex min-w-0 items-start justify-between gap-2">
                {#if faceOf(card.playerVersionId)}
                  <SeasonPlayerFace
                    face={faceOf(card.playerVersionId)!}
                    {manifest}
                    size="md"
                    eager={card.selectable}
                  />
                {/if}
                {#if candidate}
                  <SeasonTeamLogo
                    {manifest}
                    franchiseId={candidate.franchiseId}
                    teamExternalId={manifest.modernFranchiseSlots.find(
                      (s) => s.franchiseId === candidate.franchiseId,
                    )?.teamExternalId ?? ''}
                    logoCandidates={identity.logoCandidates}
                    alt={fullTeam}
                    size="sm"
                  />
                {/if}
              </div>
              <div class="flex min-h-0 flex-1 flex-col">
                <p
                  class="line-clamp-2 min-h-10 text-sm font-semibold leading-snug"
                  title={playerName}
                >
                  {playerName}
                </p>
                <div class="mt-1 min-h-5">
                  {#if fillsNeed}
                    <span
                      class="inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary uppercase"
                    >
                      Fills a need
                    </span>
                  {/if}
                </div>
                <p class="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {candidate?.seasonKey ?? ''} · {formatPositions(playable)}
                </p>
                <p
                  class="line-clamp-2 min-h-10 text-xs leading-snug text-muted-foreground"
                  title={teamLine}
                >
                  {teamLine}
                </p>
                <p
                  class="mt-1.5 flex gap-1"
                  aria-label={`Covers${covers.g ? ' guards' : ''}${covers.f ? ' forwards' : ''}${covers.c ? ' centers' : ''}`}
                >
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.g
                      ? 'bg-primary/15 text-primary'
                      : 'bg-surface-3 text-muted-foreground/60'}"
                    aria-hidden="true">G</span
                  >
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.f
                      ? 'bg-primary/15 text-primary'
                      : 'bg-surface-3 text-muted-foreground/60'}"
                    aria-hidden="true">F</span
                  >
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.c
                      ? 'bg-primary/15 text-primary'
                      : 'bg-surface-3 text-muted-foreground/60'}"
                    aria-hidden="true">C</span
                  >
                </p>
              </div>
              {#if card.selectable}
                <button
                  type="button"
                  onclick={() => onPick(card.playerVersionId)}
                  disabled={busy}
                  class="mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                >
                  Pick
                </button>
              {:else}
                <p
                  class="mt-auto flex min-h-11 items-center rounded-lg bg-surface-3 px-2.5 py-1.5 text-xs leading-snug text-muted-foreground"
                >
                  {humanizeCoverageReason(card.coverageReason) ?? 'Not available this round.'}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if draft.status === 'drafting' && isFinalRoundDone}
      <div>
        <button
          type="button"
          onclick={onFinalize}
          disabled={busy || !canFinalize}
          class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-xs font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          Finalize my roster
        </button>
      </div>
    {/if}

    {#if picks.length > 0}
      <section
        aria-labelledby="season-picks-heading"
        class="rounded-none bg-surface-1 sm:rounded-xl"
      >
        <div class="flex items-baseline justify-between gap-3 px-4 py-3">
          <h2
            id="season-picks-heading"
            class="font-display text-base font-extrabold tracking-tight uppercase"
          >
            Your roster
          </h2>
          <span class="text-xs font-semibold text-muted-foreground">{picks.length}/10</span>
        </div>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each picks as pick (pick.playerVersionId)}
            {@const candidate = candidateOf(pick.playerVersionId)}
            {@const playable = candidate?.positions.playable ?? []}
            {@const covers = coverageOf(playable)}
            {@const shortTeam = teamShortLabel(pick.franchiseId, pick.eraId)}
            {@const fullTeam = teamFullLabel(pick.franchiseId, pick.eraId)}
            <li class="flex items-center gap-3 px-4 py-2.5">
              <span
                class="w-8 shrink-0 font-mono text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
              >
                {pickRoundLabel(pick.pickOrdinal)}
              </span>
              {#if candidate}
                <SeasonTeamLogo
                  {manifest}
                  franchiseId={pick.franchiseId}
                  teamExternalId={manifest.modernFranchiseSlots.find(
                    (s) => s.franchiseId === pick.franchiseId,
                  )?.teamExternalId ?? ''}
                  logoCandidates={eraIdentityOf(manifest, pick.franchiseId, pick.eraId)
                    .logoCandidates}
                  size="sm"
                />
              {/if}
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">
                  {candidate?.displayName ?? 'Unknown player'}
                </p>
                <p
                  class="truncate text-xs text-muted-foreground"
                  title={`${fullTeam} · ${eraLabel(pick.eraId)}`}
                >
                  {formatPositions(playable)} · {shortTeam} · {eraLabel(pick.eraId)}
                </p>
              </div>
              <span
                class="hidden shrink-0 gap-1 sm:flex"
                aria-label={`Covers${covers.g ? ' guards' : ''}${covers.f ? ' forwards' : ''}${covers.c ? ' centers' : ''}`}
              >
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.g
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-3 text-muted-foreground/50'}"
                  aria-hidden="true">G</span
                >
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.f
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-3 text-muted-foreground/50'}"
                  aria-hidden="true">F</span
                >
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-bold {covers.c
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-3 text-muted-foreground/50'}"
                  aria-hidden="true">C</span
                >
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if error}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs">
        {error}
      </p>
    {/if}
  {:else}
    <p class="text-xs text-muted-foreground">No draft yet.</p>
  {/if}
</div>
