<script lang="ts">
  import type { HavocMutationEntry } from '@hoop-rush/data-contracts';
  import { mutationDescriptionOf, mutationDownsideOf, mutationNameOf } from './havoc-presentation';
  let {
    mutations,
    compact = false,
    readable = false,
  }: { mutations: readonly HavocMutationEntry[]; compact?: boolean; readable?: boolean } = $props();
  const powerSummaries: Partial<Record<HavocMutationEntry['mutationId'], string>> = {
    'growth-spurt': 'A sudden growth spurt adds size for finishing, contests, and rebounds.',
    'alien-arms': 'An enormous wingspan adds reach for contests, blocks, and rebounds.',
    'mini-monster': 'Tiny frame. Elite speed and handles. Gives up size at the rim.',
    'super-soldier': 'Elite speed, strength, and leaping ability in one package.',
    'sniper-gene': 'A dangerous three-point shot and a huge appetite for shooting from deep.',
    'point-god': 'Elite passing and handles, with a pass-first approach.',
    'brick-wall': 'Elite interior defense, strength, and shot blocking.',
    'glass-eater': 'Elite rebounding at both ends, with an aggressive pursuit of offensive boards.',
    'trigger-happy': 'Elite shooting everywhere. Loves to shoot; rarely passes.',
    'walking-bucket': 'Boosted finishing and midrange scoring, with more isolation play.',
    butterfingers: 'Elite close-range scoring, but shaky handles and more turnovers.',
    'freak-athlete': 'Elite leaping and finishing, at the cost of outside shooting.',
    'the-statue': 'Elite strength and post scoring, but painfully slow.',
    'reverse-evolution': 'Shrinks in size while gaining elite perimeter defense and steals.',
  };
</script>

<ul class="flex flex-col gap-1.5" data-havoc-mutation-list>
  {#each mutations as entry (entry.mutationId)}
    <li class="min-w-0" data-havoc-mutation={entry.mutationId}>
      <p class="text-xs font-semibold text-foreground">
        {mutationNameOf(entry.mutationId)}
        {#if entry.sampledHeightDelta !== undefined}
          <span class="font-mono text-[10px] text-muted-foreground"
            >+{entry.sampledHeightDelta} in sampled</span
          >
        {/if}
      </p>
      {#if !compact}
        <p class="mt-0.5 text-xs leading-snug text-muted-foreground">
          {readable
            ? (powerSummaries[entry.mutationId] ?? mutationDescriptionOf(entry.mutationId))
            : mutationDescriptionOf(entry.mutationId)}
        </p>
        {#if (!readable || !powerSummaries[entry.mutationId]) && mutationDownsideOf(entry.mutationId) !== ''}
          <p class="mt-0.5 text-xs leading-snug text-destructive">
            Downside: {mutationDownsideOf(entry.mutationId)}
          </p>
        {/if}
      {/if}
    </li>
  {/each}
</ul>
