<script lang="ts">
  import {
    SEASON_ROSTER_MAX_SIZE,
    SEASON_ROSTER_MIN_SIZE,
    SEASON_TRADE_PACKAGE_MAX,
    type HoopRushManifest,
    type SeasonDraftCatalog,
    type SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import { tradeAssetEligibilityOf } from '@hoop-rush/engine';
  import {
    chemistryFootnote,
    humanizeTradeRejection,
    packageConsequenceFacts,
  } from '$lib/season/season-presentation';
  import { ChevronRight } from '@lucide/svelte';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import TradePlayerDetailDialog from './TradePlayerDetailDialog.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import { candidateOf, overallRatingOf } from '$lib/season/season-catalog-index';
  import {
    playerSeasonStatsRow,
    type SeasonPlayerStatsRow,
  } from '$lib/season/season-player-stats-view';
  import type { TradePlayerViewModel } from '$lib/season/season-trade-view';

  interface PlayerLite {
    playerVersionId: string;
    displayName: string;
    playable: readonly string[];
    available: boolean;
    rotationMinutes?: number | null;
    projectedMinutes?: number | null;
    overallRating?: number | null;
    franchiseId?: string;
    eraId?: string;
    seasonKey?: string;
  }
  let {
    yourPlayers,
    theirPlayers,
    yourRosterSize,
    theirRosterSize,
    yourBalance,
    theirBalance,
    humanFranchiseId,
    targetFranchiseId,
    targetFranchiseName,
    yourProtectedIds = [],
    theirProtectedIds = [],
    inquiryAllowance = 3,
    inquiriesUsed = 0,
    allowanceLabel = '',
    exchangeCount = 0,
    exchangeMax = 3,
    busy = false,
    commandError = null,
    initialOutgoing = [],
    initialIncoming = [],
    initialInfluenceAmount = 0,
    initialInfluenceFrom = null,
    prefillKey = null,
    playerNameOf = (id: string) => id,
    franchiseNameOf = (id: string) => id,
    manifest = null,
    catalog = null,
    faceOf = null,
    summaries = [],
    onSubmit,
    onDraftChange = null,
  }: {
    yourPlayers: PlayerLite[];
    theirPlayers: PlayerLite[];
    yourRosterSize: number;
    theirRosterSize: number;
    yourBalance: number;
    theirBalance: number;
    humanFranchiseId: string;
    targetFranchiseId: string;
    targetFranchiseName: string;
    yourProtectedIds?: readonly string[];
    theirProtectedIds?: readonly string[];
    inquiryAllowance?: number;
    inquiriesUsed?: number;
    allowanceLabel?: string;
    exchangeCount?: number;
    exchangeMax?: number;
    busy?: boolean;
    commandError?: string | null;
    initialOutgoing?: readonly string[];
    initialIncoming?: readonly string[];
    initialInfluenceAmount?: number;
    initialInfluenceFrom?: string | null;
    prefillKey?: string | null;
    playerNameOf?: (playerVersionId: string) => string;
    franchiseNameOf?: (franchiseId: string) => string;
    manifest?: HoopRushManifest | null;
    catalog?: SeasonDraftCatalog | null;
    faceOf?: ((playerVersionId: string) => SeasonFaceRef | null) | null;
    summaries?: readonly SeasonGameSummary[];
    onSubmit: (payload: {
      outgoing: string[];
      incoming: string[];
      influenceAmount: number;
      influenceFromSender: string | null;
    }) => void;
    onDraftChange?:
      | ((draft: {
          partner: string;
          outgoing: string[];
          incoming: string[];
          influence: { amount: number; from: string | null };
        }) => void)
      | null;
  } = $props();

  let outgoing: string[] = $state([]);
  let incoming: string[] = $state([]);
  let influenceAmount: number = $state(0);
  let influenceFrom: string | null = $state(null);
  let lastPrefill: string | null = $state(null);
  let initialized = $state(false);

  $effect(() => {
    if (!initialized) {
      initialized = true;
      outgoing = [...initialOutgoing];
      incoming = [...initialIncoming];
      influenceAmount = initialInfluenceAmount;
      influenceFrom = initialInfluenceFrom;
      lastPrefill = prefillKey;
    } else if (prefillKey !== null && prefillKey !== lastPrefill) {
      lastPrefill = prefillKey;
      outgoing = [...initialOutgoing];
      incoming = [...initialIncoming];
      influenceAmount = initialInfluenceAmount;
      influenceFrom = initialInfluenceFrom;
    }
  });

  $effect(() => {
    onDraftChange?.({
      partner: targetFranchiseId,
      outgoing: [...outgoing],
      incoming: [...incoming],
      influence: { amount: influenceAmount, from: influenceFrom },
    });
  });

  const outgoingSet = $derived(new Set(outgoing));
  const incomingSet = $derived(new Set(incoming));

  function eligibilityOf(
    playerVersionId: string,
    side: 'you' | 'them',
    available: boolean,
  ): { status: 'eligible' | 'protected' | 'availability-risk'; reason: string | null } {
    const protectedIds = side === 'you' ? yourProtectedIds : theirProtectedIds;
    return tradeAssetEligibilityOf({
      playerVersionId,
      fromFranchiseId: side === 'you' ? humanFranchiseId : targetFranchiseId,
      protectedIds,
      available,
    });
  }

  const hasOnePlusOne = $derived(outgoing.length >= 1 && incoming.length >= 1);

  const PACKAGE_WEIGHTS = [1, 0.4, 0.3, 0.2, 0.15];
  function packageEstimate(ids: readonly string[]): number {
    const overalls = ids
      .map((id) => {
        const lite = allLites.find((p) => p.playerVersionId === id);
        const ovr = lite === undefined ? null : overallOfLite(lite);
        return ovr ?? 70;
      })
      .sort((a, b) => b - a);
    return overalls.reduce((sum, v, i) => sum + v * (PACKAGE_WEIGHTS[i] ?? 0.15), 0);
  }
  const rawEstimate = $derived.by((): number | null => {
    if (outgoing.length < 1 || incoming.length < 1) return null;
    const outPkg = packageEstimate(outgoing);
    const inPkg = packageEstimate(incoming);
    if (outPkg <= 0) return null;
    return Math.round((1000 * inPkg) / outPkg);
  });
  const influencePct = $derived(influenceAmount === 0 ? 0 : Math.min(influenceAmount * 8, 16));
  const adjustedEstimate = $derived.by((): number | null => {
    if (rawEstimate === null) return null;
    if (influenceAmount === 0) return rawEstimate;
    if (influenceFrom === humanFranchiseId)
      return Math.round(rawEstimate * (1 + influencePct / 100));
    if (influenceFrom === targetFranchiseId)
      return Math.round(rawEstimate * (1 - influencePct / 100));
    return rawEstimate;
  });
  const isLikelyGift = $derived(
    adjustedEstimate !== null && adjustedEstimate < 850 && hasOnePlusOne,
  );
  const isLikelySteal = $derived(
    adjustedEstimate !== null && adjustedEstimate > 1150 && hasOnePlusOne,
  );
  const isConsolidatingTrash = $derived(outgoing.length > incoming.length && hasOnePlusOne);
  let confirmGift = $state(false);
  $effect(() => {
    if (!isLikelyGift) confirmGift = false;
  });

  const consequence = $derived(
    packageConsequenceFacts({
      fromRosterSize: yourRosterSize,
      toRosterSize: theirRosterSize,
      outgoingIds: outgoing,
      incomingIds: incoming,
      outgoingAvailable: outgoing.map(
        (id) => yourPlayers.find((p) => p.playerVersionId === id)?.available ?? true,
      ),
      incomingAvailable: incoming.map(
        (id) => theirPlayers.find((p) => p.playerVersionId === id)?.available ?? true,
      ),
      influenceAmount,
      influenceFromSender: influenceFrom,
      humanFranchiseId,
      toFranchiseId: targetFranchiseId,
    }),
  );

  const rosterLegal = $derived(consequence.legal);

  const influenceDisabledReason = $derived.by((): string | null => {
    if (influenceAmount === 0) return null;
    if (influenceFrom === null) return 'Pick who sends Influence';
    const balance = influenceFrom === humanFranchiseId ? yourBalance : theirBalance;
    if (balance - influenceAmount < 0) return 'Not enough Influence';
    return null;
  });

  const submitDisabledReason = $derived.by((): string | null => {
    if (busy) return 'Sending…';
    if (outgoing.length < 1 || incoming.length < 1) return 'Pick at least 1 from each side';
    if (outgoing.length > SEASON_TRADE_PACKAGE_MAX || incoming.length > SEASON_TRADE_PACKAGE_MAX)
      return `Max ${String(SEASON_TRADE_PACKAGE_MAX)} per side`;
    for (const id of outgoing) {
      const p = yourPlayers.find((x) => x.playerVersionId === id);
      if (p && eligibilityOf(id, 'you', p.available).status === 'protected')
        return 'Remove off-limits players';
    }
    for (const id of incoming) {
      const p = theirPlayers.find((x) => x.playerVersionId === id);
      if (p && eligibilityOf(id, 'them', p.available).status === 'protected')
        return 'Remove off-limits players';
    }
    if (!rosterLegal)
      return `Roster would be illegal — must stay ${String(SEASON_ROSTER_MIN_SIZE)}–${String(SEASON_ROSTER_MAX_SIZE)}`;
    if (influenceDisabledReason !== null) return influenceDisabledReason;
    if (isLikelyGift && !confirmGift) return 'Confirm the overpay gift below to send';
    return null;
  });
  const canSubmit = $derived(submitDisabledReason === null);
  const humanizedError = $derived(
    humanizeTradeRejection(commandError, {
      playerNameOf,
      franchiseNameOf,
      tradeFit: {
        outgoingCount: outgoing.length,
        incomingCount: incoming.length,
        toFranchiseName: targetFranchiseName,
        attemptNumber: exchangeCount,
      },
    }),
  );
  const nextOfferNumber = $derived(Math.min(exchangeMax, exchangeCount + 1));

  function toggle(set: 'outgoing' | 'incoming', id: string): void {
    if (set === 'outgoing') {
      if (outgoingSet.has(id)) outgoing = outgoing.filter((x) => x !== id);
      else if (outgoing.length < SEASON_TRADE_PACKAGE_MAX) outgoing = [...outgoing, id];
    } else {
      if (incomingSet.has(id)) incoming = incoming.filter((x) => x !== id);
      else if (incoming.length < SEASON_TRADE_PACKAGE_MAX) incoming = [...incoming, id];
    }
  }

  function setInfluence(amount: number, from: string | null): void {
    influenceAmount = amount;
    influenceFrom = from;
  }

  function submit(): void {
    if (!canSubmit) return;
    if (isLikelyGift && !confirmGift) return;
    onSubmit({
      outgoing: [...outgoing],
      incoming: [...incoming],
      influenceAmount,
      influenceFromSender: influenceFrom,
    });
  }

  function initialsOf(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  let detailId: string | null = $state(null);
  const allLites = $derived([...yourPlayers, ...theirPlayers]);
  const liteById = $derived(new Map(allLites.map((p) => [p.playerVersionId, p])));
  function overallOfLite(player: PlayerLite): number | null {
    if (player.overallRating !== null && player.overallRating !== undefined)
      return player.overallRating;
    return overallRatingOf(catalog, player.playerVersionId);
  }
  function faceFor(playerVersionId: string): SeasonFaceRef | null {
    return faceOf?.(playerVersionId) ?? null;
  }
  const detailPlayer: TradePlayerViewModel | null = $derived.by(() => {
    if (detailId === null) return null;
    const lite = liteById.get(detailId);
    if (lite === undefined) return null;
    const candidate = candidateOf(catalog, lite.playerVersionId);
    const side: 'you' | 'them' = yourPlayers.some((p) => p.playerVersionId === lite.playerVersionId)
      ? 'you'
      : 'them';
    return {
      playerVersionId: lite.playerVersionId,
      displayName: lite.displayName,
      playable: lite.playable,
      available: lite.available,
      activeInjuryIds: [],
      franchiseId: lite.franchiseId ?? (side === 'you' ? humanFranchiseId : targetFranchiseId),
      eraId: lite.eraId ?? '',
      seasonKey: lite.seasonKey ?? '',
      overallRating: candidate?.summaryRatings.overallRating ?? overallOfLite(lite),
      offenseRating: candidate?.summaryRatings.offenseRating ?? null,
      defenseRating: candidate?.summaryRatings.defenseRating ?? null,
      rotationMinutes: lite.rotationMinutes ?? null,
      projectedMinutes: lite.projectedMinutes ?? null,
    };
  });
  const detailFace = $derived(
    detailPlayer === null ? null : (faceFor(detailPlayer.playerVersionId) ?? null),
  );
  const detailRunStats: SeasonPlayerStatsRow | null = $derived.by(() => {
    if (detailPlayer === null) return null;
    return playerSeasonStatsRow({
      playerVersionId: detailPlayer.playerVersionId,
      displayName: detailPlayer.displayName,
      seasonKey: detailPlayer.seasonKey,
      eraId: detailPlayer.eraId,
      franchiseId: detailPlayer.franchiseId,
      summaries,
      overallRatingOf: (id) => liteById.get(id)?.overallRating ?? overallRatingOf(catalog, id),
      playablePositions: (id) => liteById.get(id)?.playable ?? [],
    });
  });
</script>

<div
  class="flex flex-col gap-4 rounded-xl border border-border bg-card"
  data-testid="package-builder"
>
  <div class="border-b border-border px-4 py-3">
    <h3 class="text-sm font-bold uppercase tracking-tight">Build package</h3>
    <p class="mt-1 text-xs text-muted-foreground">
      Pick 1–{SEASON_TRADE_PACKAGE_MAX} from each side. You {yourRosterSize} → {consequence.fromAfterFilled}
      · {targetFranchiseName}
      {theirRosterSize} → {consequence.toAfterFilled} · must stay {SEASON_ROSTER_MIN_SIZE}–{SEASON_ROSTER_MAX_SIZE}.
      {#if consequence.backfillFrom > 0 || consequence.backfillTo > 0}
        A side dealt below {SEASON_ROSTER_MIN_SIZE} auto-signs replacement-level depth to reach
        {SEASON_ROSTER_MIN_SIZE}.
      {/if}
    </p>
  </div>

  {#if humanizedError !== null}
    <p
      role="alert"
      class="mx-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm"
    >
      {humanizedError}
    </p>
  {/if}

  <div class="grid gap-4 px-4 lg:grid-cols-2">
    <fieldset>
      <legend class="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        You send
      </legend>
      <ul class="mt-2 flex flex-col gap-2">
        {#each yourPlayers as player (player.playerVersionId)}
          {@const elig = eligibilityOf(player.playerVersionId, 'you', player.available)}
          {@const selected = outgoingSet.has(player.playerVersionId)}
          {@const blockedThird = !selected && outgoing.length >= SEASON_TRADE_PACKAGE_MAX}
          {@const blockedProtected = elig.status === 'protected'}
          {@const disabled = busy || blockedThird || blockedProtected}
          {@const face = faceFor(player.playerVersionId)}
          {@const ovr = overallOfLite(player)}
          <li>
            <div
              class="flex min-h-11 items-center gap-1 rounded-lg border transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring {selected
                ? 'border-primary bg-primary/10'
                : 'border-border bg-surface-1'} {disabled ? 'opacity-60' : ''}"
            >
              <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected}
                  {disabled}
                  onchange={() => toggle('outgoing', player.playerVersionId)}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${player.displayName}`}
                  class="h-5 w-5 shrink-0 accent-primary"
                />
                {#if manifest !== null && face !== null}
                  <SeasonPlayerFace {face} {manifest} size="sm" />
                {:else}
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold"
                    aria-hidden="true">{initialsOf(player.displayName)}</span
                  >
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-semibold">{player.displayName}</span>
                    {#if ovr !== null}
                      <span
                        class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
                      >
                        OVR {ovr}
                      </span>
                    {/if}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">
                    {player.playable.join(' · ') || '—'}{player.rotationMinutes !== null &&
                    player.rotationMinutes !== undefined
                      ? ` · ${String(player.rotationMinutes)} min`
                      : ''}
                  </span>
                  {#if blockedProtected}
                    <span class="block text-xs font-semibold text-destructive">Off limits</span>
                  {:else if elig.status === 'availability-risk'}
                    <span class="block text-xs text-muted-foreground">{elig.reason}</span>
                  {:else if blockedThird}
                    <span class="block text-xs text-muted-foreground"
                      >Max {SEASON_TRADE_PACKAGE_MAX} per side</span
                    >
                  {/if}
                </span>
              </label>
              {#if manifest !== null}
                <button
                  type="button"
                  onclick={() => (detailId = player.playerVersionId)}
                  aria-label={`View ${player.displayName} stats`}
                  data-testid={`player-info-${player.playerVersionId}`}
                  class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight class="h-4 w-4" aria-hidden="true" />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      <p class="mt-2 text-xs text-muted-foreground">
        Selected {outgoing.length}/{SEASON_TRADE_PACKAGE_MAX}
      </p>
    </fieldset>

    <fieldset>
      <legend class="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        You receive
      </legend>
      <ul class="mt-2 flex flex-col gap-2">
        {#each theirPlayers as player (player.playerVersionId)}
          {@const elig = eligibilityOf(player.playerVersionId, 'them', player.available)}
          {@const selected = incomingSet.has(player.playerVersionId)}
          {@const blockedThird = !selected && incoming.length >= SEASON_TRADE_PACKAGE_MAX}
          {@const blockedProtected = elig.status === 'protected'}
          {@const disabled = busy || blockedThird || blockedProtected}
          {@const face = faceFor(player.playerVersionId)}
          {@const ovr = overallOfLite(player)}
          <li>
            <div
              class="flex min-h-11 items-center gap-1 rounded-lg border transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring {selected
                ? 'border-primary bg-primary/10'
                : 'border-border bg-surface-1'} {disabled ? 'opacity-60' : ''}"
            >
              <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected}
                  {disabled}
                  onchange={() => toggle('incoming', player.playerVersionId)}
                  aria-label={`${selected ? 'Remove' : 'Add'} ${player.displayName}`}
                  class="h-5 w-5 shrink-0 accent-primary"
                />
                {#if manifest !== null && face !== null}
                  <SeasonPlayerFace {face} {manifest} size="sm" />
                {:else}
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-bold"
                    aria-hidden="true">{initialsOf(player.displayName)}</span
                  >
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-semibold">{player.displayName}</span>
                    {#if ovr !== null}
                      <span
                        class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold"
                      >
                        OVR {ovr}
                      </span>
                    {/if}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">
                    {player.playable.join(' · ') || '—'}{player.projectedMinutes !== null &&
                    player.projectedMinutes !== undefined
                      ? ` · ~${String(player.projectedMinutes)} min`
                      : ''}
                  </span>
                  {#if blockedProtected}
                    <span class="block text-xs font-semibold text-destructive">Off limits</span>
                  {:else if elig.status === 'availability-risk'}
                    <span class="block text-xs text-muted-foreground">{elig.reason}</span>
                  {:else if blockedThird}
                    <span class="block text-xs text-muted-foreground"
                      >Max {SEASON_TRADE_PACKAGE_MAX} per side</span
                    >
                  {/if}
                </span>
              </label>
              {#if manifest !== null}
                <button
                  type="button"
                  onclick={() => (detailId = player.playerVersionId)}
                  aria-label={`View ${player.displayName} stats`}
                  data-testid={`player-info-${player.playerVersionId}`}
                  class="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight class="h-4 w-4" aria-hidden="true" />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      <p class="mt-2 text-xs text-muted-foreground">
        Selected {incoming.length}/{SEASON_TRADE_PACKAGE_MAX}
      </p>
    </fieldset>
  </div>

  {#if hasOnePlusOne}
    <fieldset class="mx-4 rounded-xl border border-border p-3">
      <legend class="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Influence — optional
      </legend>
      <div class="mt-1 flex flex-wrap gap-2" role="group" aria-label="Influence">
        <button
          type="button"
          aria-pressed={influenceAmount === 0}
          onclick={() => setInfluence(0, null)}
          disabled={busy}
          class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {influenceAmount ===
          0
            ? 'border-primary bg-primary/10'
            : 'border-border'}"
        >
          None
        </button>
        <button
          type="button"
          aria-pressed={influenceAmount === 1 && influenceFrom === humanFranchiseId}
          onclick={() => setInfluence(1, humanFranchiseId)}
          disabled={busy || yourBalance < 1}
          title={yourBalance < 1 ? 'Not enough Influence' : ''}
          class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {influenceAmount ===
            1 && influenceFrom === humanFranchiseId
            ? 'border-primary bg-primary/10'
            : 'border-border'}"
        >
          You +1
        </button>
        <button
          type="button"
          aria-pressed={influenceAmount === 2 && influenceFrom === humanFranchiseId}
          onclick={() => setInfluence(2, humanFranchiseId)}
          disabled={busy || yourBalance < 2}
          title={yourBalance < 2 ? 'Not enough Influence' : ''}
          class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {influenceAmount ===
            2 && influenceFrom === humanFranchiseId
            ? 'border-primary bg-primary/10'
            : 'border-border'}"
        >
          You +2
        </button>
        <button
          type="button"
          aria-pressed={influenceAmount === 1 && influenceFrom === targetFranchiseId}
          onclick={() => setInfluence(1, targetFranchiseId)}
          disabled={busy || theirBalance < 1}
          title={theirBalance < 1 ? 'Not enough Influence' : ''}
          class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {influenceAmount ===
            1 && influenceFrom === targetFranchiseId
            ? 'border-primary bg-primary/10'
            : 'border-border'}"
        >
          Them +1
        </button>
        <button
          type="button"
          aria-pressed={influenceAmount === 2 && influenceFrom === targetFranchiseId}
          onclick={() => setInfluence(2, targetFranchiseId)}
          disabled={busy || theirBalance < 2}
          title={theirBalance < 2 ? 'Not enough Influence' : ''}
          class="inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {influenceAmount ===
            2 && influenceFrom === targetFranchiseId
            ? 'border-primary bg-primary/10'
            : 'border-border'}"
        >
          Them +2
        </button>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">
        {consequence.influenceNote} · {chemistryFootnote(
          consequence.chemistryRemoved,
          consequence.chemistryNew,
        )}
      </p>
    </fieldset>
  {/if}

  <div class="flex flex-col gap-2 border-t border-border p-4">
    {#if hasOnePlusOne && adjustedEstimate !== null}
      <p class="text-xs text-muted-foreground" role="status">
        Est. value {rawEstimate}→{adjustedEstimate} (quantity-discounted, best counts most).
        {#if isLikelyGift}
          Looks like an overpay gift — allowed, logged as a gift.
        {:else if isLikelySteal}
          Looks rich for you — still blocked above 1150. Add value or attach Them Influence.
        {:else if isConsolidatingTrash}
          2-for-1 now discounts the 2nd player (×0.4) and needs your best close to theirs.
        {/if}
      </p>
      {#if isLikelyGift}
        <label
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <input
            type="checkbox"
            checked={confirmGift}
            onchange={(e) => (confirmGift = e.currentTarget.checked)}
            disabled={busy}
            class="h-5 w-5 shrink-0 accent-primary"
          />
          <span>Confirm overpay gift — send anyway</span>
        </label>
      {/if}
    {/if}
    <button
      type="button"
      onclick={submit}
      disabled={!canSubmit}
      data-testid="package-submit"
      title={submitDisabledReason ?? 'Send offer'}
      aria-disabled={!canSubmit}
      class="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? 'Sending…' : isLikelyGift ? 'Send gift offer' : 'Send offer'}
    </button>
    {#if submitDisabledReason !== null && !busy}
      <p class="text-xs text-muted-foreground" role="status">{submitDisabledReason}</p>
    {/if}
    <p class="text-xs text-muted-foreground">
      Sends Offer {nextOfferNumber} of {exchangeMax} — browsing is free, sending starts a talk.
      {#if manifest !== null}Tap › on a player for peak-season and run stats.{/if}
    </p>
  </div>
</div>

{#if manifest !== null}
  <TradePlayerDetailDialog
    player={detailPlayer}
    {manifest}
    {catalog}
    face={detailFace}
    runStats={detailRunStats}
    onClose={() => (detailId = null)}
  />
{/if}

<style>
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
