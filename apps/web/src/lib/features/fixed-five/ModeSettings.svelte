<script lang="ts">
  import SettingsChoices from '#lib/modes/SettingsChoices.svelte';
  import { knowledgeField } from '#lib/modes/settings-fields.js';
  import type { SettingsChoice, SettingsProps } from '#lib/modes/types.js';
  let props: SettingsProps = $props();
  const fields: readonly SettingsChoice[] = [
    {
      key: 'sourceMode',
      label: 'Draft source',
      options: [
        { value: 'classic', label: 'Classic', description: 'Roll Draft' },
        { value: 'sandbox', label: 'Sandbox', description: 'Snake Draft' },
      ],
    },
    knowledgeField,
  ];
</script>

<SettingsChoices {...props} {fields} />
