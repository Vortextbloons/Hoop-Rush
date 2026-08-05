<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import {
    blockRoundRange,
    type SeasonAcceptedBlock,
    type SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import { didWin, recordLabel } from '$lib/season/season-presentation';

  /**
   * Season tape (M2.3.5 hub): nine segments for checkpoints 1-9. Completed
   * segments are links to their checkpoint detail (`/season/run/checkpoint?
   * block=N`) and show the human team's W-L across that block's round range;
   * the current segment marks the next decision; the rest are muted. Every
   * segment exposes `data-season-tape-segment` for e2e and a descriptive
   * aria-label; the current segment carries `aria-current="step"`.
   */

  let {
    acceptedBlocks,
    nextBlockIndex,
    summaries,
    humanFranchiseId,
    totalBlocks = 9,
  }: {
    acceptedBlocks: readonly SeasonAcceptedBlock[];
    /** 0-based accepted-block count (0..8); 9 when the season is complete. */
    nextBlockIndex: number | null;
    summaries: readonly SeasonGameSummary[];
    humanFranchiseId: string | null;
    totalBlocks?: number;
  } = $props();

  interface TapeSegment {
    blockIndex: number;
    fromRound: number;
    toRound: number;
    state: 'completed' | 'current' | 'upcoming';
    record: { wins: number; losses: number } | null;
  }

  const segments = $derived.by(() => {
    const result: TapeSegment[] = [];
    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
      const completed = acceptedBlocks.some((block) => block.blockIndex === blockIndex);
      const state: TapeSegment['state'] = completed
        ? 'completed'
        : blockIndex === nextBlockIndex
          ? 'current'
          : 'upcoming';
      result.push({
        blockIndex,
        fromRound: blockRoundRange(blockIndex).fromRound,
        toRound: blockRoundRange(blockIndex).toRound,
        state,
        record:
          completed && humanFranchiseId !== null ? blockRecord(blockIndex, humanFranchiseId) : null,
      });
    }
    return result;
  });

  function blockRecord(blockIndex: number, franchiseId: string): { wins: number; losses: number } {
    const { fromRound, toRound } = blockRoundRange(blockIndex);
    let wins = 0;
    let losses = 0;
    for (const summary of summaries) {
      if (summary.round < fromRound || summary.round > toRound) continue;
      if (summary.homeFranchiseId !== franchiseId && summary.awayFranchiseId !== franchiseId) {
        continue;
      }
      if (didWin(summary, franchiseId)) wins += 1;
      else losses += 1;
    }
    return { wins, losses };
  }

  function labelOf(segment: TapeSegment): string {
    const range = `Block ${String(segment.blockIndex + 1)} of ${String(totalBlocks)}, rounds ${String(segment.fromRound)}–${String(segment.toRound)}`;
    if (segment.state === 'completed') {
      const record =
        segment.record === null
          ? ''
          : `, ${recordLabel(segment.record.wins, segment.record.losses)}`;
      return `${range} complete${record}`;
    }
    if (segment.state === 'current') {
      return `${range} — next decision`;
    }
    return `${range} upcoming`;
  }
</script>

<nav aria-label="Season progress" class="w-full">
  <ol class="flex flex-wrap gap-1.5 sm:gap-2">
    {#each segments as segment (segment.blockIndex)}
      {#if segment.state === 'completed'}
        <li class="min-w-[4.25rem] flex-1">
          <a
            href={resolve(`/season/run/checkpoint/?block=${String(segment.blockIndex)}` as RouteId)}
            data-season-tape-segment={segment.blockIndex}
            aria-label={labelOf(segment)}
            class="flex h-full flex-col items-center gap-0.5 rounded-lg border border-border bg-surface-1 px-1.5 py-2 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong hover:bg-surface-2"
          >
            <span class="font-mono text-[10px] font-bold text-primary uppercase">
              B{segment.blockIndex + 1}
            </span>
            <span class="font-mono text-[9px] text-muted-foreground">
              {segment.fromRound}–{segment.toRound}
            </span>
            {#if segment.record !== null}
              <span class="font-mono text-xs font-bold">
                {recordLabel(segment.record.wins, segment.record.losses)}
              </span>
            {/if}
          </a>
        </li>
      {:else}
        <li class="min-w-[4.25rem] flex-1">
          <span
            data-season-tape-segment={segment.blockIndex}
            aria-label={labelOf(segment)}
            aria-current={segment.state === 'current' ? 'step' : undefined}
            class="flex h-full flex-col items-center gap-0.5 rounded-lg border px-1.5 py-2 text-center {segment.state ===
            'current'
              ? 'border-primary/60 bg-primary/10'
              : 'border-border/60 bg-surface-2/50 opacity-60'}"
          >
            <span class="font-mono text-[10px] font-bold uppercase text-muted-foreground">
              B{segment.blockIndex + 1}
            </span>
            <span class="font-mono text-[9px] text-muted-foreground">
              {segment.fromRound}–{segment.toRound}
            </span>
            {#if segment.state === 'current'}
              <span class="font-mono text-xs font-bold text-primary">Next</span>
            {:else}
              <span class="font-mono text-[10px] text-muted-foreground">Pending</span>
            {/if}
          </span>
        </li>
      {/if}
    {/each}
  </ol>
</nav>
