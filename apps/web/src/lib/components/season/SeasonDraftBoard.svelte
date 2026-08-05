<script lang="ts">
  import type { HoopRushManifest, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import {
    COVERAGE_TARGETS,
    coverageNeeds,
    currentRevealAttempts,
    revealPoolRows,
    SOLO_PARTICIPANT_ID,
    type SeasonDraftFlowState,
  } from '$lib/season/season-draft-flow';

  /**
   * The Season Run ten-round draft board (spec/2.0/11 live draft board, M2.3):
   * seeded franchise assignment, snake order and current turn, every rolled
   * franchise-era attempt of the current reveal (deterministic invalid-roll
   * recovery shown), exact-combination claims, selections, and the remaining
   * 4G/4F/3C coverage needs. The board is presentational: every command flows
   * through the page into the engine.
   */

  let {
    flow,
    catalog,
    manifest,
    busy,
    error,
    onReveal,
    onClaim,
    onPick,
    onFinalize,
  }: {
    flow: SeasonDraftFlowState;
    catalog: SeasonDraftCatalog;
    manifest: HoopRushManifest;
    busy: boolean;
    error: string | null;
    onReveal: () => void;
    onClaim: () => void;
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
  const claims = $derived(
    draft ? draft.claims.filter((c) => c.participantId === SOLO_PARTICIPANT_ID) : [],
  );
  const needs = $derived(
    draft ? coverageNeeds(picks, catalog) : { guards: 0, forwards: 0, centers: 0 },
  );

  const reveal = $derived(draft ? currentRevealAttempts(draft) : null);
  const poolRows = $derived(draft ? revealPoolRows(draft, catalog) : []);
  const usableAttempt = $derived(
    reveal && reveal.attempts.length > 0
      ? (reveal.attempts[reveal.attempts.length - 1] ?? null)
      : null,
  );
  const canClaim = $derived.by(() => {
    const attempt = usableAttempt;
    if (busy || attempt === null || !attempt.usable) return false;
    return !claimedCurrentPair();
  });
  const canReveal = $derived(
    !busy &&
      draft !== null &&
      draft.status === 'drafting' &&
      draft.currentTurnParticipantId !== null &&
      reveal === null,
  );
  const isFinalRoundDone = $derived(picks.length >= 10);
  const canFinalize = $derived(!busy && isFinalRoundDone && draft?.status === 'drafting');

  function claimedCurrentPair(): boolean {
    if (!usableAttempt || !draft) return false;
    return draft.claims.some(
      (c) =>
        c.participantId === SOLO_PARTICIPANT_ID &&
        c.franchiseId === usableAttempt.franchiseId &&
        c.eraId === usableAttempt.eraId,
    );
  }

  function identityOf(franchiseId: string, eraId: string) {
    return resolveEraTeamIdentity(manifest, franchiseId, eraId);
  }

  function rowIdentity(playerVersionId: string) {
    const candidate = catalog.candidates.find((c) => c.playerVersionId === playerVersionId);
    return candidate ?? null;
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
        <section aria-labelledby="season-claims-heading" class="rounded-lg bg-surface-2 p-3">
          <h3
            id="season-claims-heading"
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Claimed pools
          </h3>
          {#if claims.length === 0}
            <p class="mt-2 text-sm text-muted-foreground">No franchise-era pools claimed yet.</p>
          {:else}
            <ul class="mt-2 flex flex-col gap-1.5">
              {#each claims as claim (claim.franchiseId + claim.eraId)}
                {@const identity = identityOf(claim.franchiseId, claim.eraId)}
                <li class="flex items-center gap-2 text-sm">
                  <TeamLogo
                    {manifest}
                    franchiseId={claim.franchiseId}
                    teamExternalId={manifest.modernFranchiseSlots.find(
                      (s) => s.franchiseId === claim.franchiseId,
                    )?.teamExternalId ?? ''}
                    logoCandidates={identity.logoCandidates ?? []}
                  />
                  <span class="truncate font-semibold">
                    {identity.displayLabel ?? franchiseLabel(claim.franchiseId)}
                  </span>
                  <span class="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {eraLabel(claim.eraId)}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
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
            Ten picks must stay able to complete the 4 guard / 4 forward / 3 center targets; the
            draft re-rolls deterministically when a rolled pool cannot.
          </p>
        </section>
      </div>
    </div>

    {#if reveal}
      <section aria-labelledby="season-roll-heading" class="rounded-xl bg-surface-1 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="season-roll-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            Rolled options · pick {reveal.pickOrdinal}
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {participant ? `Turn: ${franchiseAbbreviation(participant.franchiseId)}` : 'Turn: —'}
          </span>
        </div>
        <ul class="mt-3 flex flex-col gap-2">
          {#each reveal.attempts as attempt (attempt.attemptIndex)}
            {@const identity = identityOf(attempt.franchiseId, attempt.eraId)}
            <li class="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
              <span
                class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              >
                Roll {attempt.attemptIndex + 1}
              </span>
              <TeamLogo
                {manifest}
                franchiseId={attempt.franchiseId}
                teamExternalId={manifest.modernFranchiseSlots.find(
                  (s) => s.franchiseId === attempt.franchiseId,
                )?.teamExternalId ?? ''}
                logoCandidates={identity.logoCandidates ?? []}
              />
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                {identity.displayLabel ?? franchiseLabel(attempt.franchiseId)}
                <span class="text-muted-foreground"> · {eraLabel(attempt.eraId)}</span>
              </span>
              {#if attempt.usable}
                <span
                  class="rounded-full bg-primary/15 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                >
                  Playable
                </span>
              {:else}
                <span
                  class="rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Unusable · auto re-rolled
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          {#if canClaim}
            <button
              type="button"
              onclick={onClaim}
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Claim this pool
            </button>
          {:else if claimedCurrentPair()}
            <span
              class="rounded-full bg-surface-2 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Claimed
            </span>
          {/if}
        </div>
      </section>
    {:else if draft.status === 'drafting'}
      <div>
        {#if canReveal}
          <button
            type="button"
            onclick={onReveal}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Roll round {draft.round}
          </button>
        {:else}
          <p class="font-mono text-xs text-muted-foreground">Waiting for the roll…</p>
        {/if}
      </div>
    {/if}

    {#if poolRows.length > 0}
      <section aria-labelledby="season-pool-heading" class="rounded-xl bg-surface-1">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h2
            id="season-pool-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            {usableAttempt
              ? `${franchiseLabel(usableAttempt.franchiseId)} · ${eraLabel(usableAttempt.eraId)}`
              : 'Revealed pool'}
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {poolRows.length} eligible versions
          </span>
        </div>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each poolRows as candidate (candidate.playerVersionId)}
            <li class="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-xs font-bold uppercase"
                aria-hidden="true"
              >
                {candidate.displayName
                  .split(' ')
                  .slice(0, 2)
                  .map((part) => part[0] ?? '')
                  .join('')}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-bold">{candidate.displayName}</span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {candidate.seasonKey} · {candidate.positions.playable.join('/')}
                </span>
              </span>
              <button
                type="button"
                onclick={() => onPick(candidate.playerVersionId)}
                disabled={busy}
                class="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Pick
              </button>
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
            {@const candidate = rowIdentity(pick.playerVersionId)}
            {@const identity = identityOf(pick.franchiseId, pick.eraId)}
            <li class="flex items-center gap-3 px-4 py-3">
              <span
                class="w-20 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                R{pick.round}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-bold">
                {candidate?.displayName ?? pick.playerVersionId}
              </span>
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                {candidate?.positions.playable.join('/') ?? ''} ·
                {identity.abbreviationLabel ?? franchiseAbbreviation(pick.franchiseId)} ·
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
