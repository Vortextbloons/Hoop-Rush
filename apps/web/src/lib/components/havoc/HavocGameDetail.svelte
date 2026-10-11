<script lang="ts">
  import type { HavocComparison } from '@hoop-rush/data-contracts';
  import { havocPeriodLabel, mutationNameOf } from './havoc-presentation';

  let { comparison, gameNumber }: { comparison: HavocComparison; gameNumber: number } = $props();

  const game = $derived(
    comparison.games.find((candidate) => candidate.gameNumber === gameNumber) ?? null,
  );
  const namesByInstance = $derived.by(() => {
    const names = new Map<string, string>();
    for (const slot of comparison.slots) {
      for (const line of [...slot.havoc.lines, ...slot.normal.lines]) {
        names.set(line.instanceId, line.displayName);
      }
    }
    return names;
  });
  const nameOf = (instanceId: string | null): string =>
    instanceId === null ? 'Unknown player' : (namesByInstance.get(instanceId) ?? instanceId);
</script>

{#if game === null}
  <p class="text-xs text-muted-foreground">Game {gameNumber} is not part of this comparison.</p>
{:else}
  <section
    aria-labelledby="havoc-game-detail-heading"
    class="rounded-xl bg-surface-2 p-4"
    data-havoc-game-detail={game.gameNumber}
  >
    <h3
      id="havoc-game-detail-heading"
      class="font-display text-base font-extrabold tracking-tight uppercase"
    >
      Game {game.gameNumber} · {game.humanHome ? 'Home' : 'Away'} vs {game.opponentId}
    </h3>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">
      <div class="rounded-lg bg-surface-1 p-3">
        <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-[#37B7CC] uppercase">
          Havoc
        </p>
        <p class="font-display text-2xl font-black tabular-nums">
          {game.havoc.humanScore}–{game.havoc.opponentScore}
          <span class="font-mono text-xs font-bold text-muted-foreground">
            {game.havoc.outcome === 'win' ? 'W' : 'L'}
          </span>
        </p>
      </div>
      <div class="rounded-lg bg-surface-1 p-3">
        <p
          class="font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
        >
          Normal
        </p>
        <p class="font-display text-2xl font-black tabular-nums">
          {game.normal.humanScore}–{game.normal.opponentScore}
          <span class="font-mono text-xs font-bold text-muted-foreground">
            {game.normal.outcome === 'win' ? 'W' : 'L'}
          </span>
        </p>
      </div>
    </div>
    <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
      <div>
        <dt class="text-muted-foreground">Δ points for</dt>
        <dd class="font-mono font-bold">{game.deltas.pointsFor}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Δ points against</dt>
        <dd class="font-mono font-bold">{game.deltas.pointsAgainst}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Δ margin</dt>
        <dd class="font-mono font-bold">{game.deltas.margin}</dd>
      </div>
    </dl>
    {#if game.flips.havocWinNormalLoss || game.flips.normalWinHavocLoss}
      <p class="mt-2 text-xs font-semibold">
        {#if game.flips.havocWinNormalLoss}
          Result flipped: Havoc won, the normal lineup lost this seed.
        {:else}
          Result flipped: Normal won, the mutated lineup lost this seed.
        {/if}
      </p>
    {/if}
    <div class="mt-3">
      <h4 class="font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        Recorded mutation highlights
      </h4>
      {#if game.highlights.length === 0}
        <p class="mt-1 text-xs text-muted-foreground">
          No mutation highlights recorded for this game.
        </p>
      {:else}
        <ul class="mt-1 flex flex-col gap-1">
          {#each game.highlights as highlight, index (index)}
            <li class="text-xs">
              {havocPeriodLabel(highlight.period)} · {highlight.clockSeconds}s ·
              {#if highlight.kind === 'mutation' && highlight.mutationId !== null}
                <span class="font-semibold">{mutationNameOf(highlight.mutationId)}</span> —
                {nameOf(highlight.instanceId)} ({highlight.pointsDelta >= 0
                  ? '+'
                  : ''}{highlight.pointsDelta} pts)
              {:else if highlight.kind === 'foul-out'}
                <span class="font-semibold">Foul out</span> — {nameOf(highlight.instanceId)}
              {:else}
                <span class="font-semibold">Negative score</span> — {nameOf(highlight.instanceId)}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}
