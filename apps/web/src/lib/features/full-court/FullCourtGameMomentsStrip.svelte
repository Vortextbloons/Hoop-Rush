<script lang="ts">
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { FullCourtNotableMoment } from '@hoop-rush/engine';
  import Badge from '#lib/components/ui/Badge.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  let {
    moments,
    art = null,
    label = 'Notable moments',
  }: {
    moments: readonly FullCourtNotableMoment[];
    art?: FullCourtArt | null;
    label?: string;
  } = $props();

  function tierTone(tier: FullCourtNotableMoment['tier']) {
    switch (tier) {
      case 'historic':
        return 'accent' as const;
      case 'standout':
        return 'primary' as const;
      case 'notable':
        return 'neutral' as const;
    }
  }
</script>

{#if moments.length > 0}
  <ul class="mt-2.5 flex flex-col gap-1.5" aria-label={label}>
    {#each moments as moment (moment.id)}
      <li
        class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs {moment.tier ===
        'historic'
          ? 'border-accent/40 bg-accent/5'
          : 'border-line-soft bg-surface-1'}"
      >
        {#if moment.playerId !== null && moment.playerName !== null}
          <FullCourtPortrait
            player={{ playerId: moment.playerId, displayName: moment.playerName }}
            {art}
            size="xs"
          />
        {/if}
        <Badge tone={tierTone(moment.tier)}>{moment.headline}</Badge>
        <span class="min-w-0 flex-1 truncate">
          {#if moment.playerName !== null}
            <strong class={moment.isUserPlayerOrTeam ? 'text-primary' : 'text-foreground'}>
              {moment.playerName}
            </strong>
            <span class="text-muted-foreground">
              ({franchiseAbbreviation(moment.teamId)}) · {moment.statLine}
            </span>
          {:else}
            <span class="text-muted-foreground">{moment.teamName} · {moment.statLine}</span>
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}
