<script lang="ts">import { getContext } from 'svelte';
import type { HoopRushManifest, SeasonFreeAgencyCandidate, SeasonFreeAgencyRoleExpectation, } from '@hoop-rush/data-contracts';
import FreeAgencyDeclarationPanel from '$lib/components/season/free-agency/FreeAgencyDeclarationPanel.svelte';
import FreeAgencyMarketOverview, { type FreeAgencyCardView, } from '$lib/components/season/free-agency/FreeAgencyMarketOverview.svelte';
import FreeAgencyResolvedPanel from '$lib/components/season/free-agency/FreeAgencyResolvedPanel.svelte';
import FreeAgencyReviewPanel from '$lib/components/season/free-agency/FreeAgencyReviewPanel.svelte';
import { bestFitOrder, candidateFitFacts, humanDeclarationOf, humanSkipped, interestedTeamsOf, nextFreePriority, openFreeAgencyWindowOf, validateDeclaration, } from '$lib/components/season/free-agency/free-agency-view';
import { overallRatingOf } from '$lib/season/season-catalog-index';
import { mergeFreeAgencyFaces } from '$lib/season/season-branding';
import { describeCommandRejection } from '$lib/season/season-hub-state';
import { SEASON_RUN_SHELL_CONTEXT, type SeasonRunShellData, } from '$lib/season/season-shell-context';
const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
const freeAgency = $derived(shell.freeAgency);
const run = $derived(shell.run);
const humanFranchiseId = $derived(shell.humanFranchiseId);
const openWindow = $derived(openFreeAgencyWindowOf(freeAgency));
const resolvedWindows = $derived((freeAgency?.windows ?? []).filter((window) => window.status === 'resolved'));
const balance = $derived(run === null || humanFranchiseId === null ? 0 : (run.influence.balances[humanFranchiseId] ?? 0));
const seasonSpend = $derived(freeAgency === null || humanFranchiseId === null
    ? 0
    : (freeAgency.seasonSpend[humanFranchiseId] ?? 0));
const signingCount = $derived(freeAgency === null || humanFranchiseId === null
    ? 0
    : (freeAgency.signingCounts[humanFranchiseId] ?? 0));
let draft = $state<Record<string, {
    priority: 1 | 2;
    role: SeasonFreeAgencyRoleExpectation;
    influence: number;
}>>({});
let submitting = $state(false);
let resolvedThisSession = $state<number | null>(null);
const candidateById = $derived(new Map<string, SeasonFreeAgencyCandidate>((openWindow?.candidates ?? []).map((candidate) => [candidate.playerVersionId, candidate])));
function assignPriority(playerVersionId: string, priority: 0 | 1 | 2): Record<string, {
    priority: 1 | 2;
    role: SeasonFreeAgencyRoleExpectation;
    influence: number;
}> {
    const next = { ...draft };
    const candidate = candidateById.get(playerVersionId);
    if (candidate === undefined)
        return next;
    if (priority === 0) {
        delete next[playerVersionId];
        return next;
    }
    const holder = Object.entries(next).find(([id, entry]) => entry.priority === priority && id !== playerVersionId);
    if (holder !== undefined) {
        const otherPriority = priority === 1 ? 2 : 1;
        const otherHolder = Object.entries(next).find(([id, entry]) => entry.priority === otherPriority && id !== playerVersionId && id !== holder[0]);
        if (otherHolder === undefined) {
            next[holder[0]] = { ...holder[1], priority: otherPriority };
        }
        else {
            delete next[holder[0]];
        }
    }
    const previous = next[playerVersionId];
    next[playerVersionId] = {
        priority,
        role: previous?.role ?? candidate.supportedRoles[0] ?? 'depth',
        influence: previous?.influence ?? candidate.minimumInfluence,
    };
    return next;
}
function setPriority(playerVersionId: string, priority: 0 | 1 | 2) {
    if (submitting)
        return;
    draft = assignPriority(playerVersionId, priority);
}
function toggleTarget(playerVersionId: string) {
    if (submitting)
        return;
    if (draft[playerVersionId] !== undefined) {
        draft = assignPriority(playerVersionId, 0);
        return;
    }
    const next = nextFreePriority(Object.values(draft));
    if (next === null)
        return;
    draft = assignPriority(playerVersionId, next);
}
function setRole(playerVersionId: string, role: SeasonFreeAgencyRoleExpectation) {
    if (submitting)
        return;
    const entry = draft[playerVersionId];
    if (entry === undefined)
        return;
    draft = { ...draft, [playerVersionId]: { ...entry, role } };
}
function setInfluence(playerVersionId: string, influence: number) {
    if (submitting)
        return;
    const entry = draft[playerVersionId];
    if (entry === undefined)
        return;
    const candidate = candidateById.get(playerVersionId);
    if (candidate === undefined)
        return;
    const clamped = Math.max(candidate.minimumInfluence, Math.min(3, Number.isFinite(influence) ? Math.round(influence) : candidate.minimumInfluence));
    draft = { ...draft, [playerVersionId]: { ...entry, influence: clamped } };
}
const orderedTargets = $derived.by(() => Object.entries(draft)
    .map(([playerVersionId, entry]) => ({
    playerVersionId,
    priority: entry.priority,
    roleExpectation: entry.role,
    influence: entry.influence,
}))
    .sort((a, b) => a.priority - b.priority));
const localFailures = $derived.by(() => {
    if (openWindow === null)
        return [];
    return validateDeclaration({
        candidates: openWindow.candidates,
        targets: orderedTargets,
        balance,
        seasonSpend,
    });
});
const activeRotationIds = $derived(shell.editor?.activeMemberIds() ?? []);
const manifest = $derived(shell.manifest);
const marketFaces = $derived.by(() => mergeFreeAgencyFaces(shell.playersIndex, shell.catalog, shell.freeAgency, shell.facesByVersion));
const faceOf = (playerVersionId: string) => marketFaces.get(playerVersionId) ?? null;
const cards: FreeAgencyCardView[] = $derived.by(() => {
    const window = openWindow;
    if (window === null)
        return [];
    const fitOf = (candidate: SeasonFreeAgencyCandidate) => {
        const others = interestedTeamsOf(window, candidate.playerVersionId, humanFranchiseId).filter((team) => !team.human).length;
        return candidateFitFacts(candidate, activeRotationIds, (playerVersionId) => shell.playablePositions(playerVersionId), others);
    };
    const best = new Set(bestFitOrder(window.candidates, fitOf));
    return window.candidates.map((candidate) => {
        const entry = draft[candidate.playerVersionId];
        return {
            candidate,
            fit: fitOf(candidate),
            isBestFit: best.has(candidate.playerVersionId),
            interested: interestedTeamsOf(window, candidate.playerVersionId, humanFranchiseId),
            priority: (entry?.priority ?? 0) as 0 | 1 | 2,
            role: entry?.role ?? null,
            influence: entry?.influence ?? null,
            face: faceOf(candidate.playerVersionId),
            overallRating: overallRatingOf(shell.catalog, candidate.playerVersionId),
        };
    });
});
const declaration = $derived(openWindow === null ? null : humanDeclarationOf(openWindow, humanFranchiseId));
const skipped = $derived(declaration !== null && humanSkipped(openWindow!, humanFranchiseId));
const editable = $derived(openWindow !== null && declaration === null && humanFranchiseId !== null);
const freeAgencyCommandError = $derived.by(() => {
    const error = shell.commandError;
    if (error === null)
        return null;
    const commands = new Set([
        'declare-free-agent-interest',
        'skip-free-agent-market',
        'resolve-free-agent-market',
    ]);
    if (!commands.has(error.command))
        return null;
    return error.rejection !== null
        ? describeCommandRejection(error.command, error.rejection)
        : error.message;
});
async function submitDeclaration() {
    if (openWindow === null ||
        submitting ||
        orderedTargets.length === 0 ||
        localFailures.length > 0)
        return;
    submitting = true;
    try {
        await shell.declareFreeAgentInterest({
            windowIndex: openWindow.windowIndex,
            targets: orderedTargets.map(({ playerVersionId, roleExpectation, influence }) => ({
                playerVersionId,
                roleExpectation,
                influence,
            })),
        });
        draft = {};
    }
    finally {
        submitting = false;
    }
}
async function skipMarket() {
    if (openWindow === null || submitting)
        return;
    submitting = true;
    try {
        await shell.skipFreeAgentMarket({ windowIndex: openWindow.windowIndex });
        draft = {};
    }
    finally {
        submitting = false;
    }
}
async function resolveMarket() {
    if (openWindow === null || submitting)
        return;
    submitting = true;
    try {
        resolvedThisSession = openWindow.windowIndex;
        await shell.resolveFreeAgentMarket({ windowIndex: openWindow.windowIndex });
    }
    finally {
        submitting = false;
    }
}
</script>

<svelte:head>
  <title>Season Run — Free Agency — Hoop Rush</title>
</svelte:head>

<div class="flex min-w-0 flex-col gap-6 pt-6">
  <header class="px-3 sm:px-0">
    <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
      Season Run · free agency
    </p>
    <h1 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
      Free Agency
    </h1>
    <p class="mt-1 font-mono text-[10px] text-muted-foreground">
      Markets open after Blocks 2, 4, and 6 · up to two ordered targets · resolve before the next
      block can submit
    </p>
  </header>

  {#if freeAgency === null || freeAgency.windows.length === 0}
    <section
      aria-labelledby="free-agency-empty-heading"
      class="rounded-none border border-border bg-surface-1 p-5 sm:rounded-xl"
      data-fa-empty-state
    >
      <h2
        id="free-agency-empty-heading"
        class="font-display text-xl font-extrabold uppercase tracking-tight"
      >
        No market open yet
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        The first free-agency window opens after Block 2 is accepted. When it does, this screen
        becomes your market: candidate cards, a declaration of up to two targets (or a skip), and
        the resolution results.
      </p>
    </section>
  {:else}
    {#if openWindow !== null}
      <section
        aria-labelledby="free-agency-window-heading"
        class="px-3 sm:px-0"
        data-fa-window-open
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="free-agency-window-heading"
            class="font-display text-xl font-extrabold uppercase tracking-tight"
          >
            Window {openWindow.windowIndex + 1}
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {#if declaration === null}
              open · declare or skip
            {:else if skipped}
              open · skipped · resolve to finish
            {:else}
              open · declaration recorded · resolve to finish
            {/if}
          </span>
        </div>

        {#if declaration === null}
          <p
            role="alert"
            class="mt-3 rounded-none border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 sm:rounded-xl dark:text-amber-300"
            data-fa-unresolved-notice
          >
            The next block cannot submit until you declare or skip this market — nothing here is
            saved until you submit.
          </p>
        {:else}
          <p
            role="status"
            class="mt-3 rounded-none border border-positive/30 bg-positive/10 px-4 py-2.5 text-sm text-positive sm:rounded-xl"
            data-fa-resolve-notice
          >
            {skipped
              ? 'Your skip is recorded. Resolve the market to finish this window.'
              : 'Your declaration is recorded and immutable. Resolve the market to finish this window.'}
          </p>
        {/if}

        {#if freeAgencyCommandError !== null}
          <p
            role="alert"
            class="mt-3 rounded-none border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive sm:rounded-xl"
            data-fa-rejection
          >
            {freeAgencyCommandError}
          </p>
        {/if}

        <div class="mt-4">
          <FreeAgencyMarketOverview
            {cards}
            {manifest}
            franchiseName={shell.franchiseName}
            editable={editable && !submitting}
            disabled={submitting}
            onToggleTarget={toggleTarget}
            onPriorityChange={setPriority}
            onRoleChange={setRole}
            onInfluenceChange={setInfluence}
          />
        </div>

        <div class="mt-4">
          {#if declaration === null}
            <FreeAgencyDeclarationPanel
              candidates={openWindow.candidates}
              targets={orderedTargets}
              {balance}
              {seasonSpend}
              {signingCount}
              failures={localFailures}
              busy={submitting}
              onSubmit={() => void submitDeclaration()}
              onSkip={() => void skipMarket()}
            />
          {:else}
            <FreeAgencyReviewPanel
              windowIndex={openWindow.windowIndex}
              {declaration}
              candidates={openWindow.candidates}
              {manifest}
              {faceOf}
              overallOf={(playerVersionId) => overallRatingOf(shell.catalog, playerVersionId)}
              busy={submitting}
              onSubmit={() => void resolveMarket()}
            />
          {/if}
        </div>
      </section>
    {/if}

    {#if resolvedWindows.length > 0}
      <section
        aria-labelledby="free-agency-history-heading"
        class="flex flex-col gap-3 px-3 sm:px-0"
      >
        <h2
          id="free-agency-history-heading"
          class="font-display text-base font-extrabold uppercase tracking-tight"
        >
          Resolved markets
        </h2>
        {#each resolvedWindows as window (window.windowIndex)}
          <FreeAgencyResolvedPanel
            {window}
            {humanFranchiseId}
            {manifest}
            franchiseName={shell.franchiseName}
            playerName={shell.playerName}
            {faceOf}
            {signingCount}
            {seasonSpend}
            resolvedInThisSession={resolvedThisSession === window.windowIndex}
          />
        {/each}
      </section>
    {/if}
  {/if}
</div>
