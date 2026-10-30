<script lang="ts">
  import type { HavocMutationEntry } from '@hoop-rush/data-contracts';
  import {
    havocSpecialistCategoryLabel,
    mutationDescriptionOf,
    mutationDownsideOf,
    mutationNameOf,
  } from './havoc-presentation';
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
    'opposite-day': 'The five best ratings swap places with the five worst. Everything flips.',
    'tiny-titan': 'A 62-inch frame with elite strength, blocking, leaping, and rebounding.',
    'mr-everything': 'Every rating set to exactly 88. No weakness, no standout.',
    'foul-merchant': 'Elite free throws, handles, and IQ, hunting drives and contact.',
    'the-specialist': 'One sampled category rises to 99 while everything else drops by 20.',
    'glass-cannon': 'Everything in the shot diet gets a big lift. Defense is a rumor.',
    'the-pacifist': 'Elite vision and IQ. Almost never shoots.',
    'paper-giant': 'A skyscraper with a jumper. No strength, no glass.',
    'cold-blooded': 'Misses stack a bonus on the next make, but hand points away.',
    'triple-threat': 'Rim, midrange, and three in one quarter pays six.',
    'oops-all-centers': 'Five 7\'3" titans. Slow and ground-bound, but immovable inside.',
    'hostile-takeover': "Your worst starter takes the opponent's best player's ratings.",
    'buzzer-bandit': 'Late-clock makes count double, but quick misses cost a point.',
    'charity-casino': 'Made free throws worth 3; missed ones gift the opponent 2.',
    'fusion-dance':
      'Fuses with the best teammate: better ratings and 99 usage; the teammate plays at 40.',
    'basketball-darwinism': 'Every made shot degrades the shooter\u2019s scoring ratings by 5.',
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
        {#if entry.specialistCategory !== undefined}
          <span class="font-mono text-[10px] text-muted-foreground"
            >{havocSpecialistCategoryLabel(entry.specialistCategory)}</span
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
