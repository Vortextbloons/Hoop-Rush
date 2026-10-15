<script lang="ts">
  import type { SettingsChoice, SettingsProps } from './types';
  let {
    fields,
    value,
    onchange,
    disabled = false,
  }: SettingsProps & { fields: readonly SettingsChoice[] } = $props();
</script>

{#each fields as field (field.key)}
  <fieldset {disabled}>
    <legend>{field.label}</legend>
    <div class="choices">
      {#each field.options as option (option.value)}
        <button
          type="button"
          aria-pressed={value[field.key] === option.value}
          class:active={value[field.key] === option.value}
          onclick={() => onchange({ ...value, [field.key]: option.value })}
        >
          <strong>{option.label}</strong>
          {#if option.description}<small>{option.description}</small>{/if}
        </button>
      {/each}
    </div>
  </fieldset>
{/each}

<style>
  fieldset {
    border: 0;
    padding: 0;
    margin-bottom: 22px;
    min-width: 0;
  }
  legend {
    font: 700 14px var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 10px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  button {
    min-width: 0;
    padding: 12px 10px;
    border: 1px solid var(--color-line-soft);
    border-radius: 8px;
    text-align: left;
    background: var(--color-surface-1);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  button.active {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 9%, var(--color-card));
  }
  strong {
    display: block;
    font: 700 16px var(--font-display);
    line-height: 1.2;
  }
  small {
    display: block;
    color: var(--color-muted-foreground);
    font-size: 10px;
    margin-top: 5px;
  }
</style>
