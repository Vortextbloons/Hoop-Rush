<script lang="ts">
  import type { HavocMutationEntry } from '@hoop-rush/data-contracts';
  import { mutationDescriptionOf, mutationDownsideOf, mutationNameOf } from './havoc-presentation';
  let {
    mutations,
    compact = false,
  }: { mutations: readonly HavocMutationEntry[]; compact?: boolean } = $props();
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
          {mutationDescriptionOf(entry.mutationId)}
        </p>
        {#if mutationDownsideOf(entry.mutationId) !== ''}
          <p class="mt-0.5 text-xs leading-snug text-destructive">
            Downside: {mutationDownsideOf(entry.mutationId)}
          </p>
        {/if}
      {/if}
    </li>
  {/each}
</ul>
