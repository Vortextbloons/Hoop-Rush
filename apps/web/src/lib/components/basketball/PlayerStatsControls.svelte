<script lang="ts" generics="Side extends string = string">
  import SegmentedControl from '../ui/SegmentedControl.svelte';

  const valueOptions = [
    { value: 'game', label: 'Per game' },
    { value: 'totals', label: 'Totals' },
  ] as const;

  let {
    sideOptions = null,
    side = null,
    onsidechange = null,
    sideLabel = 'Roster',
    values = 'game',
    onvalueschange = null,
    valuesLabel = 'Stat values',
  }: {
    sideOptions?: readonly { value: Side; label: string }[] | null;
    side?: Side | null;
    onsidechange?: ((value: Side) => void) | null;
    sideLabel?: string;
    values?: 'game' | 'totals';
    onvalueschange?: ((value: 'game' | 'totals') => void) | null;
    valuesLabel?: string;
  } = $props();

  const sideValue = $derived(
    sideOptions !== null && sideOptions.length > 0 ? (side ?? sideOptions[0]!.value) : null,
  );
  const showSide = $derived(sideValue !== null && onsidechange !== null);
  const show = $derived(showSide || onvalueschange !== null);
</script>

{#if show}
  <div class="ui-stats-controls">
    {#if showSide && sideOptions !== null && sideValue !== null && onsidechange !== null}
      <SegmentedControl
        label={sideLabel}
        size="md"
        value={sideValue}
        options={sideOptions}
        onchange={onsidechange}
      />
    {/if}
    {#if onvalueschange !== null}
      <SegmentedControl
        label={valuesLabel}
        size="md"
        value={values}
        options={valueOptions}
        onchange={onvalueschange}
      />
    {/if}
  </div>
{/if}
