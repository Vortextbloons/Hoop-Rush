<script lang="ts">
  import type { BlockRunState } from '$lib/season/season-hub-state';
  import type { SeasonSchedule, SeasonScoreline } from '@hoop-rush/data-contracts';
  import { buildBlockLiveViewModel } from '$lib/season/season-block-live';
  let {
    block,
    onCancel,
    onRetry,
    label,
    humanFranchiseId = null,
    schedule = null,
    franchiseName = (id: string) => id,
    franchiseAbbrev = (id: string) => id,
  }: {
    block: BlockRunState;
    onCancel: () => void;
    onRetry: () => void;
    label: string;
    humanFranchiseId?: string | null;
    schedule?: SeasonSchedule | null;
    franchiseName?: (franchiseId: string) => string;
    franchiseAbbrev?: (franchiseId: string) => string;
  } = $props();
  const effectiveHuman = $derived(humanFranchiseId ?? block.startInput?.humanFranchiseId ?? null);
  const live = $derived.by(() => {
    if (schedule !== null && block.blockIndex !== null) {
      try {
        return buildBlockLiveViewModel({
          schedule,
          blockIndex: block.blockIndex,
          humanFranchiseId: effectiveHuman,
          progress: {
            gamesCompleted: block.gamesCompleted,
            gamesTotal: block.gamesTotal,
            latestGameId: block.latestGameId,
            latestResult: block.latestResult,
            isHumanGame: block.isHumanGame,
            humanRecordInBlock: block.humanRecordInBlock,
            humanResults: block.humanResults,
            leaguePulse: block.leaguePulse,
          },
          franchiseNameOf: franchiseName,
        });
      } catch {
        return null;
      }
    }
    return null;
  });
  const percent = $derived(
    block.gamesTotal > 0
      ? Math.min(100, Math.round((block.gamesCompleted / block.gamesTotal) * 100))
      : 0,
  );
  const wins = $derived(block.humanRecordInBlock.wins);
  const losses = $derived(block.humanRecordInBlock.losses);
  const blockNum = $derived(block.blockIndex !== null ? block.blockIndex + 1 : null);
  function humanSplit(
    line: SeasonScoreline,
    humanId: string | null,
  ): {
    won: boolean;
    humanScore: number;
    oppScore: number;
    oppId: string;
    isHome: boolean;
  } {
    const isHome = line.homeFranchiseId === humanId;
    const humanScore = isHome ? line.homeScore : line.awayScore;
    const oppScore = isHome ? line.awayScore : line.homeScore;
    const oppId = isHome ? line.awayFranchiseId : line.homeFranchiseId;
    return { won: humanScore > oppScore, humanScore, oppScore, oppId, isHome };
  }
  const chips = $derived.by(() => {
    if (live !== null) return live.slots;
    return [];
  });
  const fallbackChips = $derived.by(() => {
    if (live !== null || effectiveHuman === null) return [];
    return block.humanResults.map((line) => {
      const split = humanSplit(line, effectiveHuman);
      return {
        gameId: line.gameId,
        round: 0,
        opponentFranchiseId: split.oppId,
        opponentName: franchiseName(split.oppId),
        isHome: split.isHome,
        status: 'final' as const,
        result: line,
        humanWon: split.won,
      };
    });
  });
  const visibleChips = $derived(live !== null ? chips : fallbackChips);
  const tickerKind = $derived(live?.ticker.kind ?? (block.latestResult ? 'league' : 'empty'));
  const tickerLine = $derived.by((): SeasonScoreline | null => {
    if (live !== null) return live.ticker.scoreline;
    const lastHuman =
      block.humanResults.length > 0 ? block.humanResults[block.humanResults.length - 1] : null;
    return lastHuman ?? block.latestResult;
  });
  const tickerHeadline = $derived.by(() => {
    const line = tickerLine;
    if (line === null) return 'Waiting for the first final…';
    if (
      effectiveHuman !== null &&
      (line.homeFranchiseId === effectiveHuman || line.awayFranchiseId === effectiveHuman)
    ) {
      const split = humanSplit(line, effectiveHuman);
      const opp = franchiseAbbrev(split.oppId);
      return `Final: ${split.won ? 'W' : 'L'} ${String(split.humanScore)}–${String(split.oppScore)} vs ${opp}`;
    }
    const away = franchiseAbbrev(line.awayFranchiseId);
    const home = franchiseAbbrev(line.homeFranchiseId);
    return `Final: ${away} ${String(line.awayScore)} @ ${home} ${String(line.homeScore)}`;
  });
  const nextText = $derived.by(() => {
    const next = live?.nextOpponent ?? null;
    if (next !== null && next.franchiseId !== null) {
      const name = franchiseAbbrev(next.franchiseId);
      return `Next you vs ${name}`;
    }
    return null;
  });
  const countsText = $derived.by(() => {
    if (live !== null) {
      return `${String(live.ticker.humanCompleted)}/${String(live.ticker.humanTotal)} you · ${String(live.ticker.leagueCompleted)}/${String(live.ticker.leagueTotal)} league`;
    }
    if (block.gamesTotal > 0) {
      return `${String(block.humanResults.length)} you · ${String(block.gamesCompleted)}/${String(block.gamesTotal)} league`;
    }
    return null;
  });
  const pulse = $derived(live?.pulse ?? block.leaguePulse);
  function pulseLabel(line: SeasonScoreline | null): string | null {
    if (line === null) return null;
    const away = franchiseAbbrev(line.awayFranchiseId);
    const home = franchiseAbbrev(line.homeFranchiseId);
    return `${away} ${String(line.awayScore)} @ ${home} ${String(line.homeScore)}`;
  }
  const politeMessage = $derived.by(() => {
    const lastHuman =
      block.humanResults.length > 0 ? block.humanResults[block.humanResults.length - 1] : null;
    if (lastHuman !== undefined && lastHuman !== null && effectiveHuman !== null) {
      const split = humanSplit(lastHuman, effectiveHuman);
      const opp = franchiseAbbrev(split.oppId);
      return `Final: ${split.won ? 'W' : 'L'} ${String(split.humanScore)}–${String(split.oppScore)} vs ${opp}. ${countsText ?? ''}`;
    }
    if (block.phase === 'running') return `${label} started`;
    if (block.phase === 'complete') return `${label} complete`;
    if (block.phase === 'cancelled') return `${label} cancelled`;
    if (block.phase === 'failed') return `${label} failed`;
    return '';
  });
</script>

{#if block.phase === 'running' || block.phase === 'complete' || block.phase === 'cancelled' || block.phase === 'failed'}
  <section
    aria-labelledby="block-progress-heading"
    class="rounded-xl border border-border bg-surface-1 p-4"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2
        id="block-progress-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        {#if blockNum !== null}
          You’re {wins}–{losses} in Block {blockNum}
        {:else}
          Block — of 9
        {/if}
      </h2>
      <span class="font-mono text-xs text-muted-foreground">{label}</span>
    </div>

    {#if visibleChips.length > 0}
      <ul class="mt-3 flex flex-wrap gap-2" aria-label="Your games in this block">
        {#each visibleChips as chip (chip.gameId)}
          <li>
            {#if chip.status === 'final' && chip.result !== null && chip.humanWon !== null}
              {@const split = humanSplit(chip.result, effectiveHuman)}
              {@const opp = franchiseAbbrev(chip.opponentFranchiseId)}
              <span
                class="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface-2 px-3 py-2 text-xs font-semibold"
              >
                {split.won ? 'W' : 'L'}
                {split.humanScore}–{split.oppScore} vs {opp}
              </span>
            {:else}
              <span
                class="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
              >
                vs {franchiseAbbrev(chip.opponentFranchiseId)}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="mt-3 rounded-lg bg-surface-2 p-3">
      <p class="text-sm font-semibold">{tickerHeadline}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {#if nextText !== null}{nextText} ·
        {/if}{#if countsText !== null}{countsText}{/if}
      </p>
    </div>

    <div class="mt-3 grid grid-cols-3 gap-2 text-xs">
      <div class="rounded-lg border border-border p-2">
        <p class="font-semibold">Closest</p>
        <p class="mt-1 text-muted-foreground">{pulseLabel(pulse.closest) ?? '—'}</p>
      </div>
      <div class="rounded-lg border border-border p-2">
        <p class="font-semibold">Blowout</p>
        <p class="mt-1 text-muted-foreground">{pulseLabel(pulse.blowout) ?? '—'}</p>
      </div>
      <div class="rounded-lg border border-border p-2">
        <p class="font-semibold">Highest</p>
        <p class="mt-1 text-muted-foreground">{pulseLabel(pulse.highestScoring) ?? '—'}</p>
      </div>
    </div>

    <div
      class="mt-3"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={block.gamesTotal || 1}
      aria-valuenow={block.gamesCompleted}
      aria-valuetext={block.gamesTotal > 0
        ? `${String(block.gamesCompleted)} of ${String(block.gamesTotal)} games`
        : 'starting'}
    >
      <div class="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>
          {block.gamesTotal > 0
            ? `${String(block.gamesCompleted)} / ${String(block.gamesTotal)} games`
            : 'Starting…'}
        </span>
        <span>{percent}%</span>
      </div>
      <div class="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style="width: {percent}%"
        ></div>
      </div>
      {#if live !== null && live.roundCompletion.length > 0}
        <div class="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Round completion">
          {#each live.roundCompletion as round (round.round)}
            <span
              class="inline-block h-2.5 w-2.5 rounded-full {round.completed >= round.total
                ? 'bg-primary'
                : round.completed > 0
                  ? 'bg-primary/50'
                  : 'bg-border'} motion-reduce:transition-none"
              title={`Round ${String(round.round)}: ${String(round.completed)}/${String(round.total)}`}
            ></span>
          {/each}
          <span class="ml-2 text-xs text-muted-foreground">
            Rounds {live.roundCompletion.filter((r) => r.completed >= r.total).length}/{live
              .roundCompletion.length}
          </span>
        </div>
      {/if}
    </div>

    {#if block.phase === 'running'}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={onCancel}
          class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong motion-reduce:transition-none"
        >
          Cancel
        </button>
      </div>
    {/if}

    {#if block.phase === 'cancelled'}
      <div class="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
        <p class="font-semibold">Block cancelled between games.</p>
        <p class="mt-1 text-xs text-muted-foreground">Cancelled. Retry from last block.</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
        >
          Retry block
        </button>
      </div>
    {/if}

    {#if block.phase === 'failed' && block.error}
      <div
        role="alert"
        class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        <p class="font-semibold">The block failed.</p>
        <p class="mt-1 text-xs text-muted-foreground">{block.error.message}</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
        >
          Retry block
        </button>
      </div>
    {/if}

    <p class="sr-only" role="status" aria-live="polite">
      {politeMessage}
    </p>
  </section>
{/if}
