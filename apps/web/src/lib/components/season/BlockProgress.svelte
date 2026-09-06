<script lang="ts">
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import type { BlockRunState } from '$lib/season/season-hub-state';
  import type {
    HoopRushManifest,
    SeasonSchedule,
    SeasonScoreline,
  } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { buildBlockLiveViewModel } from '$lib/season/season-block-live';
  import LiveSimModal from '$lib/components/season/LiveSimModal.svelte';
  import { SIM_BAR_FILL_MS } from '$lib/components/season/live-sim-animation';
  const LEAGUE_FEED_SIZE = 3;
  let {
    block: blockInput,
    onCancel,
    onRetry,
    label,
    humanFranchiseId = null,
    schedule = null,
    franchiseName = (id: string) => id,
    franchiseAbbrev = (id: string) => id,
    recapHref = null,
    manifest = null,
    visible = $bindable(false),
  }: {
    block: BlockRunState;
    onCancel: () => void;
    onRetry: () => void;
    label: string;
    humanFranchiseId?: string | null;
    schedule?: SeasonSchedule | null;
    franchiseName?: (franchiseId: string) => string;
    franchiseAbbrev?: (franchiseId: string) => string;
    recapHref?: string | null;
    manifest?: HoopRushManifest | null;
    visible?: boolean;
  } = $props();
  const isLivePhase = $derived(
    blockInput.phase === 'running' ||
      blockInput.phase === 'complete' ||
      blockInput.phase === 'cancelled' ||
      blockInput.phase === 'failed',
  );
  let lastActive = $state<BlockRunState | null>(null);
  $effect(() => {
    if (isLivePhase) {
      const snap = blockInput;
      untrack(() => {
        lastActive = snap;
      });
    }
  });
  const showTerminal = $derived(blockInput.phase === 'idle' && lastActive !== null);
  const block = $derived<BlockRunState>(
    isLivePhase
      ? blockInput
      : showTerminal && lastActive !== null
        ? { ...lastActive, phase: 'complete' }
        : blockInput,
  );
  $effect(() => {
    visible = isLivePhase || showTerminal;
  });
  const effectiveHuman = $derived(humanFranchiseId ?? block.startInput?.humanFranchiseId ?? null);
  function teamExternalIdOf(franchiseId: string): string {
    if (manifest === null) return '';
    return franchiseIdentityOf(manifest, franchiseId)?.teamExternalId ?? '';
  }
  const humanExternalId = $derived(effectiveHuman === null ? '' : teamExternalIdOf(effectiveHuman));
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
  const isRunning = $derived(block.phase === 'running');
  const isActive = $derived(
    block.phase === 'running' ||
      block.phase === 'complete' ||
      block.phase === 'cancelled' ||
      block.phase === 'failed',
  );
  const runKey = $derived(`${block.requestId ?? 'idle'}:${block.blockIndex ?? 'none'}`);
  let dismissedFor = $state<string | null>(null);
  const dialogOpen = $derived(isActive && dismissedFor !== runKey);
  function showLive() {
    dismissedFor = null;
  }
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
  function involvesHuman(line: SeasonScoreline, humanId: string | null): boolean {
    if (humanId === null) return false;
    return line.homeFranchiseId === humanId || line.awayFranchiseId === humanId;
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
  const humanRounds = $derived.by(() => {
    const rounds = new Set<number>();
    for (const chip of visibleChips) rounds.add(chip.round);
    return rounds;
  });
  let recentLeague = $state<SeasonScoreline[]>([]);
  let seenRunKey = $state<string | null>(null);
  $effect(() => {
    const key = `${block.requestId ?? 'idle'}:${block.blockIndex ?? 'none'}`;
    const id = block.latestGameId;
    const line = block.latestResult;
    const human = effectiveHuman;
    const prior = untrack(() => ({ key: seenRunKey, lines: recentLeague }));
    if (prior.key !== key) {
      seenRunKey = key;
      recentLeague = [];
    }
    if (line === null || id === null) return;
    if (involvesHuman(line, human)) return;
    const base = prior.key === key ? prior.lines : [];
    if (base.some((entry) => entry.gameId === id)) return;
    recentLeague = [...base.slice(-(LEAGUE_FEED_SIZE - 1)), line];
  });
  const leagueFeed = $derived([...recentLeague].reverse());
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
  const pulseLine = $derived.by(() => {
    const parts: string[] = [];
    if (pulse.closest !== null) {
      const away = franchiseAbbrev(pulse.closest.awayFranchiseId);
      const home = franchiseAbbrev(pulse.closest.homeFranchiseId);
      parts.push(
        `Closest ${away} ${String(pulse.closest.awayScore)} @ ${home} ${String(pulse.closest.homeScore)}`,
      );
    }
    if (pulse.blowout !== null) {
      const away = franchiseAbbrev(pulse.blowout.awayFranchiseId);
      const home = franchiseAbbrev(pulse.blowout.homeFranchiseId);
      parts.push(
        `Blowout ${away} ${String(pulse.blowout.awayScore)} @ ${home} ${String(pulse.blowout.homeScore)}`,
      );
    }
    if (pulse.highestScoring !== null) {
      const away = franchiseAbbrev(pulse.highestScoring.awayFranchiseId);
      const home = franchiseAbbrev(pulse.highestScoring.homeFranchiseId);
      parts.push(
        `High ${away} ${String(pulse.highestScoring.awayScore)} @ ${home} ${String(pulse.highestScoring.homeScore)}`,
      );
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  });
  const lastHuman = $derived(
    block.humanResults.length > 0
      ? (block.humanResults[block.humanResults.length - 1] ?? null)
      : null,
  );
  const completeLine = $derived.by(() => {
    if (block.phase !== 'complete' || blockNum === null) return null;
    if (wins === losses)
      return `You split Block ${String(blockNum)} ${String(wins)}–${String(losses)}`;
    return `You went ${String(wins)}–${String(losses)} in Block ${String(blockNum)}`;
  });
  const politeMessage = $derived.by(() => {
    if (lastHuman !== null && lastHuman !== undefined && effectiveHuman !== null) {
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

{#if isActive}
  <LiveSimModal
    open={dialogOpen}
    onOpenChange={(next) => {
      if (!next) dismissedFor = runKey;
    }}
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-b from-primary/10 to-transparent px-4 py-3"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {#if block.phase === 'running'}
          <span class="sim-live-pill" role="status">
            <span class="sim-live-dot" aria-hidden="true"></span> Simming
          </span>
        {:else if block.phase === 'complete'}
          <span class="sim-live-pill" data-tone="final">Final</span>
        {:else}
          <span class="sim-live-pill" data-tone="muted">{block.phase}</span>
        {/if}
        {#if manifest !== null && effectiveHuman !== null && humanExternalId !== ''}
          <SeasonTeamLogo
            {manifest}
            franchiseId={effectiveHuman}
            teamExternalId={humanExternalId}
            size="md"
            eager
          />
        {/if}
        <Dialog.Title class="font-display text-base font-extrabold uppercase tracking-tight">
          {#if blockNum !== null}
            You’re {wins}–{losses} · Block {blockNum} of 9
          {:else}
            Block — of 9
          {/if}
        </Dialog.Title>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs text-muted-foreground">{label}</span>
        <Dialog.Close
          aria-label={isRunning ? 'Hide live sim' : 'Close'}
          class="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          <X class="h-4 w-4" />
        </Dialog.Close>
      </div>
    </div>

    <div class="flex flex-col gap-3 px-4 py-4">
      {#if visibleChips.length > 0}
        <div>
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
          >
            Your games
          </p>
          <ul class="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Your games in this block">
            {#each visibleChips as chip (chip.gameId)}
              {@const isSpot = block.latestGameId === chip.gameId && block.isHumanGame}
              <li
                class="sim-ticker-card"
                data-spot={isSpot}
                data-testid={isSpot ? 'block-human-spotlight' : undefined}
              >
                {#if chip.status === 'final' && chip.result !== null && chip.humanWon !== null}
                  {@const split = humanSplit(chip.result, effectiveHuman)}
                  {@const opp = franchiseAbbrev(chip.opponentFranchiseId)}
                  {@const oppExternalId = teamExternalIdOf(chip.opponentFranchiseId)}
                  <span class="flex items-center gap-1.5">
                    {#if manifest !== null && effectiveHuman !== null && humanExternalId !== ''}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={effectiveHuman}
                        teamExternalId={humanExternalId}
                        size="sm"
                      />
                    {/if}
                    <span
                      class="sim-spot-badge"
                      data-result={split.won ? 'w' : 'l'}
                      aria-label={split.won ? 'Win' : 'Loss'}>{split.won ? 'W' : 'L'}</span
                    >
                    <span class="font-display text-lg font-extrabold tabular-nums">
                      {split.humanScore}–{split.oppScore}
                    </span>
                    {#if manifest !== null && oppExternalId !== ''}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={chip.opponentFranchiseId}
                        teamExternalId={oppExternalId}
                        size="sm"
                      />
                    {/if}
                    {#if isSpot}
                      <span
                        class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                        >You</span
                      >
                    {/if}
                  </span>
                  <span
                    class="flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground"
                  >
                    <span class="truncate"
                      >vs {opp}{chip.round > 0 ? ` · R${String(chip.round)}` : ''}</span
                    >
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1 py-px font-bold tracking-[0.08em]"
                      >{chip.isHome ? 'HOME' : 'AWAY'}</span
                    >
                  </span>
                {:else}
                  {@const pendingExternalId = teamExternalIdOf(chip.opponentFranchiseId)}
                  <span class="flex items-center gap-1.5">
                    {#if manifest !== null && pendingExternalId !== ''}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={chip.opponentFranchiseId}
                        teamExternalId={pendingExternalId}
                        size="sm"
                      />
                    {/if}
                    <span class="sim-spot-badge" data-result="pending">·</span>
                    <span
                      class="font-display text-lg font-extrabold tabular-nums text-muted-foreground"
                    >
                      vs {franchiseAbbrev(chip.opponentFranchiseId)}
                    </span>
                  </span>
                  <span class="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <span>
                      {nextText !== null && live?.nextOpponent.gameId === chip.gameId
                        ? 'On deck'
                        : 'Upcoming'}{chip.round > 0 ? ` · R${String(chip.round)}` : ''}
                    </span>
                    <span
                      class="shrink-0 rounded bg-surface-3 px-1 py-px font-bold tracking-[0.08em]"
                      >{chip.isHome ? 'HOME' : 'AWAY'}</span
                    >
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div>
        <div class="flex items-baseline justify-between gap-2">
          <p
            class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
          >
            Around the league
          </p>
          {#if countsText !== null}
            <p class="font-mono text-[10px] text-muted-foreground tabular-nums">{countsText}</p>
          {/if}
        </div>
        {#if leagueFeed.length > 0}
          <ul class="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Latest league finals">
            {#each leagueFeed as entry (entry.gameId)}
              {@const awayExternalId = teamExternalIdOf(entry.awayFranchiseId)}
              {@const homeExternalId = teamExternalIdOf(entry.homeFranchiseId)}
              <li class="sim-ticker-card" data-spot="false">
                <span
                  class="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
                  >Final</span
                >
                <span class="flex items-center gap-1.5">
                  {#if manifest !== null && awayExternalId !== ''}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={entry.awayFranchiseId}
                      teamExternalId={awayExternalId}
                      size="sm"
                    />
                  {/if}
                  <span class="font-display text-lg font-extrabold tabular-nums">
                    {franchiseAbbrev(entry.awayFranchiseId)}
                    {entry.awayScore}–{entry.homeScore}
                    {franchiseAbbrev(entry.homeFranchiseId)}
                  </span>
                  {#if manifest !== null && homeExternalId !== ''}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={entry.homeFranchiseId}
                      teamExternalId={homeExternalId}
                      size="sm"
                    />
                  {/if}
                </span>
                <span class="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                  {franchiseName(entry.awayFranchiseId)} @ {franchiseName(entry.homeFranchiseId)}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-2 text-xs text-muted-foreground" role="status">
            {isRunning
              ? 'Warming the worker… finals stream here as games complete.'
              : 'League finals will appear here while simming.'}
          </p>
        {/if}
        {#if pulseLine !== null}
          <p class="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={pulseLine}>
            {pulseLine}
          </p>
        {/if}
        {#if nextText !== null}
          {@const nextExternalId =
            live?.nextOpponent.franchiseId !== null && live?.nextOpponent.franchiseId !== undefined
              ? teamExternalIdOf(live.nextOpponent.franchiseId)
              : ''}
          <p class="mt-1 flex items-center gap-1.5 font-mono text-[11px] font-bold text-primary">
            {#if manifest !== null && live?.nextOpponent.franchiseId != null && nextExternalId !== ''}
              <SeasonTeamLogo
                {manifest}
                franchiseId={live.nextOpponent.franchiseId}
                teamExternalId={nextExternalId}
                size="sm"
              />
            {/if}
            {nextText}
          </p>
        {/if}
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={block.gamesTotal || 1}
        aria-valuenow={block.gamesCompleted}
        aria-valuetext={block.gamesTotal > 0
          ? `${String(block.gamesCompleted)} of ${String(block.gamesTotal)} games`
          : 'starting'}
      >
        <div class="flex items-center justify-between font-mono text-xs text-muted-foreground">
          <span role="status">
            {block.gamesTotal > 0
              ? `${String(block.gamesCompleted)} / ${String(block.gamesTotal)} games`
              : 'Starting…'}
          </span>
          <span class="font-bold tabular-nums">{percent}%</span>
        </div>
        <div class="sim-bar mt-2" aria-hidden="true">
          <div
            class="sim-bar-fill"
            data-active={isRunning}
            style="width: {percent}%; transition: width {SIM_BAR_FILL_MS}ms linear"
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
                    : 'bg-border'} {humanRounds.has(round.round)
                  ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-surface-1'
                  : ''} motion-reduce:transition-none"
                title={`Round ${String(round.round)}: ${String(round.completed)}/${String(round.total)}${humanRounds.has(round.round) ? ' · your game' : ''}`}
              ></span>
            {/each}
            <span class="ml-2 font-mono text-[10px] text-muted-foreground">
              Rounds {live.roundCompletion.filter((r) => r.completed >= r.total).length}/{live
                .roundCompletion.length}
            </span>
          </div>
        {/if}
      </div>

      {#if block.phase === 'complete' && completeLine !== null}
        <p class="rounded-lg bg-primary/10 px-3 py-2 text-sm font-bold text-primary" role="status">
          {completeLine} — results saved.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          {#if recapHref !== null}
            <a
              href={resolve(recapHref as any)}
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
            >
              View recap
            </a>
          {/if}
          <Dialog.Close
            class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
          >
            Close
          </Dialog.Close>
        </div>
      {/if}

      {#if block.phase === 'running'}
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onclick={onCancel}
            class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong motion-reduce:transition-none"
          >
            Cancel block
          </button>
          <p class="w-full text-xs text-muted-foreground">
            Use Hide (top right) to tuck this away — the sim keeps running until you cancel it.
          </p>
        </div>
      {/if}

      {#if block.phase === 'cancelled'}
        <div class="rounded-lg bg-surface-2 p-3 text-sm">
          <p class="font-semibold">Block cancelled between games.</p>
          <p class="mt-1 text-xs text-muted-foreground">Cancelled. Retry from last block.</p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
            >
              Retry block
            </button>
            <Dialog.Close
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
            >
              Close
            </Dialog.Close>
          </div>
        </div>
      {/if}

      {#if block.phase === 'failed' && block.error}
        <div
          role="alert"
          class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <p class="font-semibold">The block failed.</p>
          <p class="mt-1 text-xs text-muted-foreground">{block.error.message}</p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onclick={onRetry}
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 motion-reduce:transition-none"
            >
              Retry block
            </button>
            <Dialog.Close
              class="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
            >
              Close
            </Dialog.Close>
          </div>
        </div>
      {/if}
    </div>

    <p class="sr-only" role="status" aria-live="polite">
      {politeMessage}
    </p>
  </LiveSimModal>

  {#if !dialogOpen}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3"
      role="status"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        {#if block.phase === 'running'}
          <span class="sim-live-pill">
            <span class="sim-live-dot" aria-hidden="true"></span> Simming
          </span>
        {:else if block.phase === 'complete'}
          <span class="sim-live-pill" data-tone="final">Final</span>
        {:else}
          <span class="sim-live-pill" data-tone="muted">{block.phase}</span>
        {/if}
        {#if manifest !== null && effectiveHuman !== null && humanExternalId !== ''}
          <SeasonTeamLogo
            {manifest}
            franchiseId={effectiveHuman}
            teamExternalId={humanExternalId}
            size="sm"
          />
        {/if}
        <p class="truncate text-sm font-semibold">
          {#if block.phase === 'complete' && completeLine !== null}
            {completeLine}
          {:else if block.gamesTotal > 0}
            {blockNum !== null ? `Block ${String(blockNum)}` : 'Block'} · {wins}–{losses} · {String(
              block.gamesCompleted,
            )}/{String(block.gamesTotal)} games
          {:else}
            {label}
          {/if}
        </p>
      </div>
      <button
        type="button"
        onclick={showLive}
        class="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        {block.phase === 'running' ? 'Watch live' : 'Show results'}
      </button>
    </div>
    <p class="sr-only" role="status" aria-live="polite">
      {politeMessage}
    </p>
  {/if}
{/if}
