<script lang="ts">
  import type { HoopRushManifest, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import { eraIdentityOf, type SeasonFaceRef } from '$lib/season/season-branding';
  import { candidateOf } from '$lib/season/season-catalog-index';
  import { formatPositions } from '$lib/player-positions';
  import type { SeasonPlayerStatsRow } from '$lib/season/season-player-stats-view';
  import type { TradePlayerViewModel } from '$lib/season/season-trade-view';
  import { oneDecimal, percentOneDecimal } from '$lib/format';
  let {
    player,
    manifest,
    catalog,
    face,
    runStats = null,
    onClose,
  }: {
    player: TradePlayerViewModel | null;
    manifest: HoopRushManifest;
    catalog: SeasonDraftCatalog | null;
    face: SeasonFaceRef | null;
    runStats?: SeasonPlayerStatsRow | null;
    onClose: () => void;
  } = $props();
  const candidate = $derived(player === null ? null : candidateOf(catalog, player.playerVersionId));
  const eraLabel = $derived(
    player === null ? null : eraIdentityOf(manifest, player.franchiseId, player.eraId).displayLabel,
  );
  function pct(value: number | null): string {
    if (value === null) return '—';
    if (value === 0) return '0%';
    return percentOneDecimal(value);
  }
</script>

<Dialog.Root
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      {#if player !== null}
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            {#if face !== null}
              <SeasonPlayerFace {face} {manifest} size="md" />
            {/if}
            <div class="min-w-0">
              <Dialog.Title class="font-display text-lg font-extrabold tracking-tight uppercase">
                {player.displayName}
              </Dialog.Title>
              <p class="mt-1 text-sm text-muted-foreground">
                {player.seasonKey}
                {#if player.playable.length > 0}
                  · {formatPositions(player.playable)}
                {/if}
              </p>
              {#if eraLabel}
                <p class="mt-0.5 text-xs text-muted-foreground">{eraLabel}</p>
              {/if}
            </div>
          </div>
          <Dialog.Close
            aria-label="Close"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          {#if player.overallRating !== null}
            <span class="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm font-bold">
              OVR {player.overallRating}
            </span>
          {/if}
          {#if player.offenseRating !== null}
            <span
              class="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
            >
              OFF {player.offenseRating}
            </span>
          {/if}
          {#if player.defenseRating !== null}
            <span
              class="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
            >
              DEF {player.defenseRating}
            </span>
          {/if}
        </div>

        {#if candidate?.anchors}
          <section class="mt-4">
            <h3
              class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Peak season
            </h3>
            <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <div>
                <dt class="text-xs text-muted-foreground">MPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(candidate.anchors.minutesPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">PPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(candidate.anchors.pointsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">RPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(candidate.anchors.reboundsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">APG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(candidate.anchors.assistsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">FG%</dt>
                <dd class="font-mono text-sm font-semibold">
                  {pct(candidate.anchors.fieldGoalPct)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">3P%</dt>
                <dd class="font-mono text-sm font-semibold">
                  {pct(candidate.anchors.threePointPct)}
                </dd>
              </div>
            </dl>
          </section>
        {/if}

        {#if runStats !== null}
          <section class="mt-4 border-t border-border pt-4">
            <h3
              class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              This season run
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {runStats.gamesPlayed} gp · folded from accepted games
            </p>
            <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <div>
                <dt class="text-xs text-muted-foreground">MPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(runStats.minutesPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">PPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(runStats.pointsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">RPG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(runStats.reboundsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">APG</dt>
                <dd class="font-mono text-sm font-semibold">
                  {oneDecimal(runStats.assistsPerGame)}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">FG%</dt>
                <dd class="font-mono text-sm font-semibold">{pct(runStats.fieldGoalPct)}</dd>
              </div>
              <div>
                <dt class="text-xs text-muted-foreground">3P%</dt>
                <dd class="font-mono text-sm font-semibold">{pct(runStats.threePointPct)}</dd>
              </div>
            </dl>
          </section>
        {/if}
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
