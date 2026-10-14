<script lang="ts">
  import type { HoopRushManifest, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
  import { Dialog } from 'bits-ui';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import SeasonPlayerFace from '#lib/components/season/SeasonPlayerFace.svelte';
  import { eraIdentityOf, type SeasonFaceRef } from '#lib/season/season-branding.js';
  import { candidateOf } from '#lib/season/season-catalog-index.js';
  import { formatPositions } from '#lib/player-positions.js';
  import type { SeasonPlayerStatsRow } from '#lib/season/season-player-stats-view.js';
  import type { TradePlayerViewModel } from '#lib/season/season-trade-view.js';
  import { oneDecimal } from '#lib/format.js';
  import { formatPct } from '#lib/roster-browser.js';
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
</script>

<DialogShell
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onClose();
  }}
  layout="center"
  size="md"
  overlayClass="sr-dialog-overlay"
  contentClass="sr-dialog p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6"
>
  {#snippet header()}
    {#if player !== null}
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
    {/if}
  {/snippet}

  {#if player !== null}
    <div class="mt-4 flex flex-wrap gap-2">
      {#if player.overallRating !== null}
        <span class="sr-badge" data-tone="hardwood"> OVR {player.overallRating} </span>
      {/if}
      {#if player.offenseRating !== null}
        <span class="sr-chip"> OFF {player.offenseRating} </span>
      {/if}
      {#if player.defenseRating !== null}
        <span class="sr-chip"> DEF {player.defenseRating} </span>
      {/if}
    </div>

    {#if candidate?.anchors}
      <section class="mt-4">
        <h3 class="sr-section-label">Peak season</h3>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <div>
            <dt class="text-xs text-muted-foreground">MPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(candidate.anchors.minutesPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">PPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(candidate.anchors.pointsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">RPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(candidate.anchors.reboundsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">APG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(candidate.anchors.assistsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">FG%</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {formatPct(candidate.anchors.fieldGoalPct)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">3P%</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {formatPct(candidate.anchors.threePointPct)}
            </dd>
          </div>
        </dl>
      </section>
    {/if}

    {#if runStats !== null}
      <section class="mt-4 border-t border-border pt-4">
        <h3 class="sr-section-label">This season run</h3>
        <p class="mt-1 text-xs text-muted-foreground">
          {runStats.gamesPlayed} gp · folded from accepted games
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <div>
            <dt class="text-xs text-muted-foreground">MPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(runStats.minutesPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">PPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(runStats.pointsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">RPG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(runStats.reboundsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">APG</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {oneDecimal(runStats.assistsPerGame)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">FG%</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {formatPct(runStats.fieldGoalPct)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted-foreground">3P%</dt>
            <dd class="sr-number font-mono text-sm font-semibold">
              {formatPct(runStats.threePointPct)}
            </dd>
          </div>
        </dl>
      </section>
    {/if}
  {/if}
</DialogShell>
