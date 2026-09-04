<script lang="ts">
  import type {
    FixedFiveCompetitionResult,
    FixedFiveRoomMode,
    HoopRushManifest,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { formatPositions } from '$lib/player-positions';
  import type { DraftPresentation } from '$lib/draft-presentation';

  let {
    mode,
    result,
    selfId = 'p1',
    manifest,
    p1Rows = [],
    p2Rows = [],
    presentation = 'ratings',
    digest = null,
  }: {
    mode: FixedFiveRoomMode;
    result: FixedFiveCompetitionResult;
    selfId?: 'p1' | 'p2';
    manifest: HoopRushManifest;
    p1Rows?: (PlayersIndexEntry | null)[];
    p2Rows?: (PlayersIndexEntry | null)[];
    presentation?: DraftPresentation;
    digest?: string | null;
  } = $props();

  const modeLabel = $derived(
    mode === 'duel'
      ? 'Duel · Best of 7'
      : mode === 'sandbox-shared-82'
        ? 'Sandbox · Shared 82'
        : 'Classic · Shared 82',
  );
  const youWon = $derived(
    result.competition === 'duel' ? result.winner === selfId : result.ranking[0] === selfId,
  );
  const shared = $derived(result.competition === 'shared-82' ? result : null);
  const duel = $derived(result.competition === 'duel' ? result : null);
  const youShared = $derived(shared?.participants.find((p) => p.participantId === selfId) ?? null);
  const oppShared = $derived(shared?.participants.find((p) => p.participantId !== selfId) ?? null);
  const showRatings = $derived(presentation !== 'ball-knowledge');

  function laneName(id: 'p1' | 'p2'): string {
    return id === selfId ? 'You' : 'Opponent';
  }
</script>

<div
  class="overflow-hidden rounded-2xl border border-line-strong bg-card shadow-[0_0_32px_hsl(13_100%_62%/0.14)]"
>
  <div class="border-b border-border/60 px-4 py-4 sm:px-6">
    <p class="font-mono text-[11px] tracking-[0.16em] text-primary uppercase">{modeLabel}</p>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <h2 class="font-display text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        {#if youWon}<span class="text-primary">You win</span>{:else}<span class="text-destructive"
            >Opponent wins</span
          >{/if}
      </h2>
      {#if shared && youShared && oppShared}
        <p class="font-display text-xl font-extrabold tabular-nums">
          {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground"
            >opp {oppShared.wins}–{oppShared.losses}</span
          >
        </p>
      {/if}
      {#if duel}
        <p class="font-display text-xl font-extrabold tabular-nums">
          {duel.p1Wins === duel.p2Wins ? '' : ''}{selfId === 'p1' ? duel.p1Wins : duel.p2Wins}<span
            class="text-muted-foreground">–</span
          >{selfId === 'p1' ? duel.p2Wins : duel.p1Wins}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground"
            >after {duel.stoppedAtGame}</span
          >
        </p>
      {/if}
    </div>
    {#if shared}
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">
        Wins → differential → seeded tie-break · H2H mirrored
      </p>
    {/if}
    {#if digest}
      <p
        class="mt-2 truncate font-mono text-[11px] text-muted-foreground"
        title={digest}
        aria-label="Result digest"
      >
        Digest {digest.slice(0, 16)}…{digest.slice(-8)}
      </p>
    {/if}
  </div>

  {#if shared && youShared && oppShared}
    <div class="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6">
      <div class="rounded-xl border border-primary/50 bg-primary/5 p-4">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">You</p>
        <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
          {youShared.wins}<span class="text-muted-foreground">–</span>{youShared.losses}
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Diff</dt>
            <dd class="font-bold tabular-nums">
              {youShared.differential >= 0 ? '+' : ''}{youShared.differential}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">H2H</dt>
            <dd class="font-bold tabular-nums">{youShared.h2hWins}</dd>
          </div>
        </dl>
      </div>
      <div class="rounded-xl border border-line-soft bg-surface-1 p-4">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Opponent
        </p>
        <p class="font-display mt-1 text-4xl font-extrabold tabular-nums">
          {oppShared.wins}<span class="text-muted-foreground">–</span>{oppShared.losses}
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">Diff</dt>
            <dd class="font-bold tabular-nums">
              {oppShared.differential >= 0 ? '+' : ''}{oppShared.differential}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">H2H</dt>
            <dd class="font-bold tabular-nums">{oppShared.h2hWins}</dd>
          </div>
        </dl>
      </div>
    </div>
  {/if}

  {#if duel}
    <div class="px-4 py-4 sm:px-6">
      <ol class="flex flex-wrap items-center gap-2" aria-label="Duel series games">
        {#each duel.games as g (g.gameNumber)}
          {@const won = g.winner === selfId}
          <li
            class="flex min-w-20 flex-1 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm sm:max-w-36 {won
              ? 'border-primary/50 bg-primary/10'
              : 'border-line-soft bg-surface-1'}"
          >
            <span class="font-mono text-[11px] text-muted-foreground">G{g.gameNumber}</span>
            <span
              class="font-display text-sm font-extrabold {won
                ? 'text-primary'
                : 'text-destructive'}">{won ? 'W' : 'L'}</span
            >
          </li>
        {/each}
      </ol>
      <p class="mt-2 font-mono text-[11px] text-muted-foreground">
        {duel.winner === selfId ? 'You' : 'Opponent'} took the series {Math.max(
          duel.p1Wins,
          duel.p2Wins,
        )}–{Math.min(duel.p1Wins, duel.p2Wins)} · first to 4
      </p>
    </div>
  {/if}

  <div class="grid gap-3 border-t border-border/60 px-4 py-4 sm:grid-cols-2 sm:px-6">
    {#each ['p1', 'p2'] as const as pid (pid)}
      {@const rows = pid === 'p1' ? p1Rows : p2Rows}
      <div class="rounded-xl bg-surface-1">
        <p
          class="px-3 pt-3 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase"
        >
          {laneName(pid)} · five
        </p>
        <ul class="flex flex-col divide-y divide-border/60">
          {#each rows as r, i (i)}
            <li class="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
              {#if r}
                <PlayerFace
                  player={r}
                  {manifest}
                  size="sm"
                  fallbackInitials={r.firstName[0]! + r.lastName[0]!}
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-bold">{r.displayName}</span>
                  <span class="block truncate font-mono text-[10px] text-muted-foreground">
                    {r.seasonKey} · {formatPositions(r.positionsPlayable)}{showRatings
                      ? ` · O ${r.overall}`
                      : ''}
                  </span>
                </span>
              {:else}
                <span class="text-sm text-muted-foreground">Slot {i + 1} — unknown</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</div>
