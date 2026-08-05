<script lang="ts">
  import type { HoopRushManifest, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    COVERAGE_TARGETS,
    coverageNeeds,
    SOLO_PARTICIPANT_ID,
    type SeasonDraftFlowState,
  } from '$lib/season/season-draft-flow';

  /**
   * The Season Run ten-round draft board (spec/2.0/11 live draft board,
   * M2.3.5, season-draft-v2): seeded franchise assignment, snake order and
   * current turn, the current turn's deterministic global eight-card offer,
   * every previously drawn offer, every selected player-season version, and
   * the remaining 4G/4F/3C coverage needs. Feasibility-safe cards are
   * distinguishable from disabled cards, and every disabled card states its
   * coverage reason. The board is presentational: every command flows through
   * the page into the engine.
   */

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
    /** playerVersionId -> branded face refs for every card and pick. */
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
    manifest.eras.find((e) => e.eraId === eraId)?.label ?? eraId;

  const franchiseLabel = (franchiseId: string): string =>
    manifest.modernFranchiseSlots.find((s) => s.franchiseId === franchiseId)?.displayName ??
    franchiseId;

  const picks = $derived(
    draft ? draft.picks.filter((p) => p.participantId === SOLO_PARTICIPANT_ID) : [],
  );
  const needs = $derived(
    draft ? coverageNeeds(picks, catalog) : { guards: 0, forwards: 0, centers: 0 },
  );

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

<div class="flex flex-col gap-6">
  {#if draft}
    <div class="rounded-xl bg-surface-1">
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span
          data-season-round-heading
          class="font-display text-lg font-extrabold tracking-tight uppercase"
        >
          Round {draft.round} of 10
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]"
          >
            {#if participant}
              {franchiseAbbreviation(participant.franchiseId)} · your franchise
            {:else}
              Franchise TBD
            {/if}
          </span>
          <span
            class="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]"
          >
            {picks.length} of 10 picked
          </span>
        </div>
      </div>

      <div class="grid gap-4 p-4 sm:grid-cols-2">
        <section aria-labelledby="season-turn-heading" class="rounded-lg bg-surface-2 p-3">
          <h3
            id="season-turn-heading"
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Your turn
          </h3>
          <p class="mt-2 text-sm text-muted-foreground">
            {#if offer}
              Pick {offer.pickOrdinal} of 10 — draw {offer.cards.length} cards, choose one.
            {:else}
              Draw the eight-card offer to see this round's candidates.
            {/if}
          </p>
        </section>

        <section aria-labelledby="season-coverage-heading" class="rounded-lg bg-surface-2 p-3">
          <h3
            id="season-coverage-heading"
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Coverage needs
          </h3>
          <dl class="mt-2 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-surface-3 p-2">
              <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Guards
              </dt>
              <dd
                class="font-display text-xl font-extrabold"
                class:incomplete={needs.guards < COVERAGE_TARGETS.guards}
              >
                {needs.guards}<span class="text-muted-foreground">/{COVERAGE_TARGETS.guards}</span>
              </dd>
            </div>
            <div class="rounded-lg bg-surface-3 p-2">
              <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Forwards
              </dt>
              <dd
                class="font-display text-xl font-extrabold"
                class:incomplete={needs.forwards < COVERAGE_TARGETS.forwards}
              >
                {needs.forwards}<span class="text-muted-foreground"
                  >/{COVERAGE_TARGETS.forwards}</span
                >
              </dd>
            </div>
            <div class="rounded-lg bg-surface-3 p-2">
              <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Centers
              </dt>
              <dd
                class="font-display text-xl font-extrabold"
                class:incomplete={needs.centers < COVERAGE_TARGETS.centers}
              >
                {needs.centers}<span class="text-muted-foreground">/{COVERAGE_TARGETS.centers}</span
                >
              </dd>
            </div>
          </dl>
          <p class="mt-2 text-xs text-muted-foreground">
            Ten picks must stay able to complete the 4 guard / 4 forward / 3 center targets; cards
            that would make completion impossible stay visible but are disabled.
          </p>
        </section>
      </div>
    </div>

    {#if offer}
      <section aria-labelledby="season-offer-heading" class="rounded-xl bg-surface-1 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="season-offer-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            Offer · pick {offer.pickOrdinal}
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {offer.cards.filter((card) => card.selectable).length} of {offer.cards.length} safe picks
          </span>
        </div>
        <ul class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each offer.cards as card (card.playerVersionId)}
            {@const candidate = candidateOf(card.playerVersionId)}
            {@const identity = candidate
              ? eraIdentityOf(manifest, candidate.franchiseId, candidate.eraId)
              : { displayLabel: null, logoCandidates: [] }}
            <li
              class="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
              class:opacity-70={!card.selectable}
            >
              <div class="flex items-start justify-between gap-2">
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
                    alt={identity.displayLabel ?? ''}
                    size="sm"
                  />
                {/if}
              </div>
              <div class="min-w-0">
                <p class="truncate text-sm font-bold">
                  {candidate?.displayName ?? card.playerVersionId}
                </p>
                <p class="font-mono text-[10px] text-muted-foreground">
                  {candidate?.seasonKey ?? ''} · {candidate?.positions.playable.join('/') ?? ''}
                </p>
                <p class="truncate font-mono text-[10px] text-muted-foreground">
                  {identity.displayLabel ??
                    (candidate ? franchiseLabel(candidate.franchiseId) : '')}
                  {candidate ? ` · ${eraLabel(candidate.eraId)}` : ''}
                </p>
              </div>
              {#if card.selectable}
                <button
                  type="button"
                  onclick={() => onPick(card.playerVersionId)}
                  disabled={busy}
                  class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Pick
                </button>
              {:else}
                <p
                  class="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground"
                >
                  Disabled · {card.coverageReason}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {:else if draft.status === 'drafting'}
      <div>
        {#if canDraw}
          <button
            type="button"
            onclick={onDraw}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Draw round {draft.round} offer
          </button>
        {:else}
          <p class="font-mono text-xs text-muted-foreground">Waiting for the draw…</p>
        {/if}
      </div>
    {/if}

    {#if draft.status === 'drafting' && isFinalRoundDone}
      <div>
        <button
          type="button"
          onclick={onFinalize}
          disabled={busy || !canFinalize}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Finalize my roster
        </button>
      </div>
    {/if}

    {#if picks.length > 0}
      <section aria-labelledby="season-picks-heading" class="rounded-xl bg-surface-1">
        <div class="px-4 py-3">
          <h2
            id="season-picks-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            Your ten
          </h2>
        </div>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each picks as pick (pick.playerVersionId)}
            {@const candidate = candidateOf(pick.playerVersionId)}
            {@const identity = candidate
              ? eraIdentityOf(manifest, pick.franchiseId, pick.eraId)
              : { displayLabel: null, logoCandidates: [] }}
            <li class="flex items-center gap-3 px-4 py-3">
              <span
                class="w-20 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
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
                  logoCandidates={identity.logoCandidates}
                  size="sm"
                />
              {/if}
              <span class="min-w-0 flex-1 truncate text-sm font-bold">
                {candidate?.displayName ?? pick.playerVersionId}
              </span>
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                {candidate?.positions.playable.join('/') ?? ''} ·
                {identity.displayLabel ?? franchiseAbbreviation(pick.franchiseId)} ·
                {eraLabel(pick.eraId)}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if error}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        {error}
      </p>
    {/if}
  {:else}
    <p class="font-mono text-sm text-muted-foreground">No draft yet.</p>
  {/if}
</div>

<style>
  .incomplete {
    color: var(--destructive);
  }
</style>
