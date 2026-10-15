<script lang="ts">
  import SettingsChoices from '#lib/modes/SettingsChoices.svelte';
  import type { SettingsChoice, SettingsProps } from '#lib/modes/types.js';
  let props: SettingsProps = $props();
  const fields: readonly SettingsChoice[] = [
    {
      key: 'variant',
      label: 'Mode',
      options: [
        { value: 'standard', label: 'Standard', description: 'Open draft board' },
        { value: 'curated', label: 'Curated', description: 'Guaranteed lineup shape' },
      ],
    },
  ];
</script>

<SettingsChoices {...props} {fields} />
