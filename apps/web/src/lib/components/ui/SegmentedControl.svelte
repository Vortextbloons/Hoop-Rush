<script lang="ts" generics="Value extends string | number">
  let {
    options,
    value,
    onchange,
    label,
    size = 'sm',
    class: className = '',
  }: {
    options: readonly { value: Value; label: string; disabled?: boolean }[];
    value: Value;
    onchange: (value: Value) => void;
    label: string;
    size?: 'sm' | 'md';
    class?: string;
  } = $props();
</script>

<div class={['ui-segmented', className]} data-size={size} role="group" aria-label={label}>
  {#each options as option (option.value)}
    <button
      type="button"
      aria-pressed={value === option.value}
      disabled={option.disabled}
      onclick={() => onchange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>
