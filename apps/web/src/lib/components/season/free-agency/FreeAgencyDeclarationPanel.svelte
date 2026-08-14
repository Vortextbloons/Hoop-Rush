<script lang="ts">
  import type { SeasonFreeAgencyCandidate } from '@hoop-rush/data-contracts';
  import type { DeclarationDraftTarget } from './free-agency-view';
  import {
    FREE_AGENCY_SIGNING_CAP,
    FREE_AGENCY_SPEND_CAP,
    ROLE_EXPECTATION_LABEL,
  } from './free-agency-view';

  /**
   * Declaration step (spec/2.0/15): up to TWO ordered targets with a
   * supported role expectation and an Influence commitment per target
   * (candidate minimum through 3). Shows the season caps (3 signings,
   * 6 Influence) and the available balance; local edits stay pending until
   * an explicit submit. Submission is a typed command; the engine's
   * authoritative rejection copy surfaces on the route.
   */

  let {
    candidates,
    targets,
    balance,
    seasonSpend,
    signingCount,
    failures = [],
    busy = false,
    onSubmit,
    onSkip,
  }: {
    candidates: readonly SeasonFreeAgencyCandidate[];
    /** Ordered draft targets (0-2), first priority first. */
    targets: readonly DeclarationDraftTarget[];
    balance: number;
    seasonSpend: number;
    signingCount: number;
    failures?: readonly string[];
    busy?: boolean;
    onSubmit: () => void;
    onSkip: () => void;
  } = $props();

  const names = $derived(
    new Map(
      candidates.map((candidate) => [candidate.playerVersionId, candidate.displayName] as const),
    ),
  );
  const committed = $derived(targets.reduce((sum, target) => sum + target.influence, 0));
  const remainingBudget = $derived(FREE_AGENCY_SPEND_CAP - seasonSpend);
  const atSigningCap = $derived(signingCount >= FREE_AGENCY_SIGNING_CAP);
</script>

<section
  aria-labelledby="free-agency-declaration-heading"
  class="rounded-none border border-border bg-surface-1 p-4 sm:rounded-xl sm:p-5"
  data-fa-declaration
>
  <h2
    id="free-agency-declaration-heading"
    class="font-display text-lg font-extrabold uppercase tracking-tight"
  >
    Your declaration
  </h2>
  <p class="mt-1 text-sm text-muted-foreground">
    Pick up to two targets and commit Influence to each. First priority is compared first; if it
    wins, the second priority is never considered. Nothing is paid unless a target wins.
  </p>

  <dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" data-fa-budget>
    <div class="rounded-lg bg-surface-2 px-3 py-2">
      <dt class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Balance
      </dt>
      <dd class="font-display text-xl leading-none font-extrabold tabular-nums" data-fa-balance>
        {balance}
      </dd>
    </div>
    <div class="rounded-lg bg-surface-2 px-3 py-2">
      <dt class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Committed
      </dt>
      <dd
        class="font-display text-xl leading-none font-extrabold tabular-nums {committed > balance ||
        committed > remainingBudget
          ? 'text-destructive'
          : ''}"
        data-fa-committed
      >
        {committed}
      </dd>
    </div>
    <div class="rounded-lg bg-surface-2 px-3 py-2">
      <dt class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Season spend
      </dt>
      <dd class="font-display text-xl leading-none font-extrabold tabular-nums">
        {seasonSpend}
        <span class="font-mono text-xs font-semibold text-muted-foreground">
          / {FREE_AGENCY_SPEND_CAP}
        </span>
      </dd>
    </div>
    <div class="rounded-lg bg-surface-2 px-3 py-2">
      <dt class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Signings
      </dt>
      <dd class="font-display text-xl leading-none font-extrabold tabular-nums">
        {signingCount}
        <span class="font-mono text-xs font-semibold text-muted-foreground">
          / {FREE_AGENCY_SIGNING_CAP}
        </span>
      </dd>
    </div>
  </dl>

  {#if targets.length > 0}
    <ol class="mt-3 flex flex-col gap-1.5" data-fa-draft-targets>
      {#each targets as target, index (target.playerVersionId)}
        <li
          class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-sm"
        >
          <span class="font-mono text-[10px] font-bold text-primary uppercase">
            {index === 0 ? 'First priority' : 'Second priority'}
          </span>
          <span class="min-w-0 truncate font-semibold">
            {names.get(target.playerVersionId) ?? target.playerVersionId}
          </span>
          <span class="font-mono text-[10px] text-muted-foreground">
            {ROLE_EXPECTATION_LABEL[target.roleExpectation]}
          </span>
          <span class="ml-auto font-mono text-xs font-bold tabular-nums">
            {target.influence} Influence
          </span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="mt-3 text-sm text-muted-foreground">
      No targets yet — use the priority pickers on the candidate cards, or skip the market below.
    </p>
  {/if}

  {#if atSigningCap}
    <p
      class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      You have already signed {FREE_AGENCY_SIGNING_CAP} free agents this season — a declaration stays
      recorded, but a win cannot be applied.
    </p>
  {/if}

  {#if failures.length > 0}
    <ul role="alert" class="mt-3 flex flex-col gap-1" data-fa-local-failures>
      {#each failures as failure (failure)}
        <li
          class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {failure}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
    <button
      type="button"
      data-fa-declare-submit
      onclick={onSubmit}
      disabled={busy || targets.length === 0 || failures.length > 0}
      class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Submitting…' : 'Submit declaration'}
    </button>
    <button
      type="button"
      data-fa-skip
      onclick={onSkip}
      disabled={busy}
      class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      Skip this market
    </button>
  </div>
  <p class="mt-2 font-mono text-[9px] text-muted-foreground/70">
    Skipping records that your team will not bid — free, no Influence, and the market can still be
    resolved.
  </p>
</section>
