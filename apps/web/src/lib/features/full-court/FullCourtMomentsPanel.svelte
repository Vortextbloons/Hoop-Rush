<script lang="ts">
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { FullCourtNotableMoment } from '@hoop-rush/engine';
  import { Flame, Sparkles, Trophy, Zap } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  let {
    userMoments,
    leagueMoments,
    art = null,
    title = 'Notable Moments',
    eyebrow = 'Highlights',
    emptyText = 'Standout scoring nights, efficiency clinics, assist milestones, and triple-doubles appear here.',
    initialLimit = 6,
  }: {
    userMoments: readonly FullCourtNotableMoment[];
    leagueMoments: readonly FullCourtNotableMoment[];
    art?: FullCourtArt | null;
    title?: string;
    eyebrow?: string;
    emptyText?: string;
    initialLimit?: number;
  } = $props();

  let scope = $state<'team' | 'league'>('team');
  let expanded = $state(false);

  const activeMoments = $derived(scope === 'team' ? userMoments : leagueMoments);
  const visibleMoments = $derived(expanded ? activeMoments : activeMoments.slice(0, initialLimit));

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

  function tierLabel(tier: FullCourtNotableMoment['tier']): string {
    switch (tier) {
      case 'historic':
        return 'Historic';
      case 'standout':
        return 'Standout';
      case 'notable':
        return 'Notable';
    }
  }
</script>

<Panel as="section" padding="md" aria-label="Full Court notable moments">
  <SectionHeading {eyebrow} {title} level={2} size="md">
    {#snippet actions()}
      <SegmentedControl
        size="sm"
        label="Notable moments scope"
        value={scope}
        options={[
          { value: 'team', label: `Your Games (${String(userMoments.length)})` },
          { value: 'league', label: `League (${String(leagueMoments.length)})` },
        ]}
        onchange={(next) => {
          scope = next;
          expanded = false;
        }}
      />
    {/snippet}
  </SectionHeading>

  {#if activeMoments.length === 0}
    <p class="mt-3 text-xs text-muted-foreground">{emptyText}</p>
  {:else}
    <ul class="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Notable game performances">
      {#each visibleMoments as moment (moment.id)}
        <li
          class="flex items-start gap-2.5 rounded-xl border p-3 {moment.tier === 'historic'
            ? 'border-accent/45 bg-accent/5'
            : moment.isUserPlayerOrTeam
              ? 'border-primary/35 bg-primary/5'
              : 'border-line-soft bg-surface-1'}"
        >
          {#if moment.playerId !== null && moment.playerName !== null}
            <div class="shrink-0 pt-0.5">
              <FullCourtPortrait
                player={{ playerId: moment.playerId, displayName: moment.playerName }}
                {art}
                size="sm"
              />
            </div>
          {:else}
            <span
              class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-soft bg-surface-2 text-accent"
              aria-hidden="true"
            >
              {#if moment.tier === 'historic'}
                <Trophy size={15} />
              {:else if moment.category === 'scoring'}
                <Flame size={15} />
              {:else if moment.category === 'efficiency'}
                <Zap size={15} />
              {:else}
                <Sparkles size={15} />
              {/if}
            </span>
          {/if}

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <Badge tone={tierTone(moment.tier)}>{tierLabel(moment.tier)}</Badge>
              <span class="font-mono text-[10px] font-bold text-muted-foreground uppercase">
                {moment.gameLabel} · {franchiseAbbreviation(moment.teamId)} vs
                {franchiseAbbreviation(moment.opponentTeamId)} · {moment.scoreLabel}
              </span>
            </div>
            <p class="mt-1 text-sm font-bold leading-snug">
              {#if moment.playerName !== null}
                <span class={moment.isUserPlayerOrTeam ? 'text-primary' : 'text-foreground'}>
                  {moment.playerName}
                </span>
                <span class="font-semibold text-foreground"> · {moment.headline}</span>
              {:else}
                <span>{moment.teamName} · {moment.headline}</span>
              {/if}
            </p>
            <p class="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
              {moment.statLine}
            </p>
          </div>
        </li>
      {/each}
    </ul>

    {#if activeMoments.length > initialLimit}
      <div class="mt-3">
        <Button size="sm" tone="secondary" onclick={() => (expanded = !expanded)}>
          {expanded
            ? `Show top ${String(initialLimit)}`
            : `Show all ${String(activeMoments.length)} moments`}
        </Button>
      </div>
    {/if}
  {/if}
</Panel>
