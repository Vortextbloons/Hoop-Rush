<script lang="ts">
  import type { CapRushSourcePlayer } from '@hoop-rush/data-contracts';
  import { fullCourtScoutPlayer } from '@hoop-rush/engine';
  import { Dialog } from 'bits-ui';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import FullCourtScoutReport from './FullCourtScoutReport.svelte';

  let {
    player,
    priceDollars = null,
    purchasedRevision = null,
    onclose,
  }: {
    player: CapRushSourcePlayer | null;
    priceDollars?: number | null;
    purchasedRevision?: number | null;
    onclose: () => void;
  } = $props();

  const report = $derived(player === null ? null : fullCourtScoutPlayer(player));
</script>

<DialogShell
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
  size="md"
  grabHandle
  closeLabel="Close scouting report"
  contentClass="max-h-[92dvh] overscroll-contain"
>
  {#snippet header()}
    {#if player !== null && report !== null}
      <div class="min-w-0">
        <p class="ui-label text-muted-foreground">Scouting report</p>
        <Dialog.Title class="font-display truncate text-xl font-extrabold tracking-tight uppercase">
          {player.displayName}
        </Dialog.Title>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground uppercase">
          {player.seasonKey} · {player.eraId} · {formatMillions(report.salaryDollars)}
        </p>
      </div>
    {/if}
  {/snippet}

  {#if report !== null}
    <FullCourtScoutReport {report} {priceDollars} {purchasedRevision} />
  {/if}
</DialogShell>
