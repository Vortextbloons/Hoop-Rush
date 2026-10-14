<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import {
    blockRoundRange,
    type SeasonAcceptedBlock,
    type SeasonGameSummary,
  } from '@hoop-rush/data-contracts';
  import { didWin, recordLabel } from '#lib/season/season-presentation.js';
  let {
    acceptedBlocks,
    nextBlockIndex,
    summaries,
    humanFranchiseId,
    totalBlocks = 9,
  }: {
    acceptedBlocks: readonly SeasonAcceptedBlock[];
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
    record: {
      wins: number;
      losses: number;
    } | null;
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
  function blockRecord(
    blockIndex: number,
    franchiseId: string,
  ): {
    wins: number;
    losses: number;
  } {
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
  let track: HTMLElement | null = $state(null);
  let lastCenteredIndex: number | null = null;
  $effect(() => {
    if (import.meta.env.SSR) return;
    const el = track;
    const currentIndex = nextBlockIndex;
    if (el === null || currentIndex === null || currentIndex >= totalBlocks) return;
    if (lastCenteredIndex === currentIndex) return;
    lastCenteredIndex = currentIndex;
    const child = el.children[currentIndex] as HTMLElement | undefined;
    if (child === undefined || typeof el.scrollTo !== 'function') return;
    const target = Math.max(0, child.offsetLeft - (el.clientWidth - child.clientWidth) / 2);
    el.scrollTo({ left: target, behavior: 'auto' });
  });
</script>

<nav aria-label="Season progress" class="w-full">
  <div class="relative">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 right-2 left-2 hidden h-px sm:block"
      style="background: linear-gradient(90deg, rgb(255 122 77 / 35%), var(--sr-line) 60%)"
    ></div>
    <ol
      bind:this={track}
      class="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0"
    >
      {#each segments as segment (segment.blockIndex)}
        {#if segment.state === 'completed'}
          <li class="w-14 shrink-0 sm:min-w-[4.25rem] sm:flex-1">
            <a
              href={resolve(`/season/run/checkpoint/?block=${String(segment.blockIndex)}` as any)}
              data-season-tape-segment={segment.blockIndex}
              aria-label={labelOf(segment)}
              class="sr-gamecard relative flex h-full flex-col items-center gap-0.5 px-1.5 py-2 text-center outline-none transition-colors hover:bg-surface-2"
            >
              <span class="sr-eyebrow">
                B{segment.blockIndex + 1}
              </span>
              <span class="sr-section-label">
                {segment.fromRound}–{segment.toRound}
              </span>
              {#if segment.record !== null}
                <span class="sr-number text-sm font-bold" style="color: var(--sr-paper)">
                  {recordLabel(segment.record.wins, segment.record.losses)}
                </span>
              {/if}
            </a>
          </li>
        {:else}
          <li class="w-14 shrink-0 sm:min-w-[4.25rem] sm:flex-1">
            <span
              data-season-tape-segment={segment.blockIndex}
              aria-label={labelOf(segment)}
              aria-current={segment.state === 'current' ? 'step' : undefined}
              class="sr-gamecard flex h-full flex-col items-center gap-0.5 px-1.5 py-2 text-center {segment.state ===
              'current'
                ? 'bg-surface-2'
                : 'opacity-55'}"
              style={segment.state === 'current'
                ? '--sr-accent: var(--sr-hardwood-bright); border-color: rgb(255 122 77 / 55%)'
                : undefined}
            >
              {#if segment.state === 'current'}
                <span class="sr-eyebrow" style="color: var(--sr-hardwood-bright)">
                  B{segment.blockIndex + 1}
                </span>
              {:else}
                <span class="sr-eyebrow" style="color: var(--sr-muted)">
                  B{segment.blockIndex + 1}
                </span>
              {/if}
              <span class="sr-section-label">
                {segment.fromRound}–{segment.toRound}
              </span>
              {#if segment.state === 'current'}
                <span class="sr-number text-sm font-bold" style="color: var(--sr-hardwood-bright)">
                  Next
                </span>
              {:else}
                <span class="sr-section-label">Pending</span>
              {/if}
            </span>
          </li>
        {/if}
      {/each}
    </ol>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 right-0 w-10 to-transparent sm:hidden"
      style="background: linear-gradient(to left, var(--sr-bg), transparent)"
    ></div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 left-0 w-10 to-transparent sm:hidden"
      style="background: linear-gradient(to right, var(--sr-bg), transparent)"
    ></div>
  </div>
</nav>
