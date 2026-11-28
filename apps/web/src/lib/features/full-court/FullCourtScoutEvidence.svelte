<script lang="ts">
  import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt, FullCourtArtPlayer } from './full-court-art.ts';

  type ScoutField = keyof SimulationRatings | keyof SimulationTendencies;

  const RATING_LABELS: Readonly<Record<keyof SimulationRatings, string>> = {
    insideScoring: 'Inside',
    closeShot: 'Close',
    midrange: 'Midrange',
    threePoint: 'Three',
    freeThrow: 'Free throw',
    ballHandling: 'Handle',
    passing: 'Passing',
    offensiveIq: 'Off. IQ',
    offensiveRebound: 'Off. reb',
    defensiveRebound: 'Def. reb',
    perimeterDefense: 'Perimeter',
    interiorDefense: 'Interior',
    steal: 'Steal',
    block: 'Block',
    defensiveIq: 'Def. IQ',
    speed: 'Speed',
    strength: 'Strength',
    vertical: 'Vertical',
  };

  const TENDENCY_LABELS: Readonly<Record<keyof SimulationTendencies, string>> = {
    usageRate: 'Usage',
    passRate: 'Pass rate',
    shotRate: 'Shot rate',
    driveRate: 'Drive rate',
    postUpRate: 'Post-up',
    rimFrequency: 'Rim',
    shortMidFrequency: 'Short mid',
    longMidFrequency: 'Long mid',
    cornerThreeFrequency: 'Corner 3',
    aboveBreakThreeFrequency: 'Above break',
    threePointRate: 'Three rate',
    freeThrowRate: 'Free throw rate',
    turnoverRate: 'Turnovers',
    isolationRate: 'Isolation',
    pickAndRollBallHandlerRate: 'PnR handler',
    pickAndRollRollManRate: 'Roll man',
    spotUpRate: 'Spot-up',
    transitionRate: 'Transition',
    cutRate: 'Cut',
    foulRate: 'Fouls',
    stealAttemptRate: 'Steal attempts',
    blockAttemptRate: 'Block attempts',
    crashOffensiveGlassRate: 'Off. glass',
  };

  let {
    items,
    emptyLabel = null,
    art = null,
  }: {
    items: readonly {
      field: ScoutField;
      value: number;
      name?: string;
      player?: FullCourtArtPlayer | null;
    }[];
    emptyLabel?: string | null;
    art?: FullCourtArt | null;
  } = $props();

  function labelOf(field: ScoutField): string {
    return field in TENDENCY_LABELS
      ? TENDENCY_LABELS[field as keyof SimulationTendencies]
      : RATING_LABELS[field as keyof SimulationRatings];
  }

  function isTendency(field: ScoutField): boolean {
    return field in TENDENCY_LABELS;
  }

  function valueText(field: ScoutField, value: number): string {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return isTendency(field) ? `${text}%` : text;
  }
</script>

{#if items.length === 0}
  {#if emptyLabel !== null}
    <p class="font-mono text-[9px] text-muted-foreground">{emptyLabel}</p>
  {/if}
{:else}
  <ul class="flex flex-wrap gap-1.5">
    {#each items as item, index (index)}
      <li
        class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-surface-2/80 px-2 py-1 text-[11px] text-muted-foreground"
      >
        {#if item.player}
          <FullCourtPortrait player={item.player} {art} size="sm" />
        {/if}
        <span class="min-w-0">
          {#if item.name !== undefined}
            <span class="font-semibold text-foreground">{item.name}</span>
            <span aria-hidden="true"> · </span>
          {/if}
          <span>{labelOf(item.field)}</span>
          <span class="font-mono text-[10px] font-bold text-foreground tabular-nums"
            >{valueText(item.field, item.value)}</span
          >
        </span>
      </li>
    {/each}
  </ul>
{/if}
