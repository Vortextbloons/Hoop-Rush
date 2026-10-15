<script lang="ts">
  import SettingsChoices from '#lib/modes/SettingsChoices.svelte';
  import { knowledgeField } from '#lib/modes/settings-fields.js';
  import type { SettingsChoice, SettingsProps } from '#lib/modes/types.js';
  let props: SettingsProps = $props();
  const fields: readonly SettingsChoice[] = [
    {
      key: 'fairness',
      label: 'Fairness',
      options: [
        { value: 'fair', label: 'Fair', description: 'Shared strength bands' },
        { value: 'unfair', label: 'Unfair', description: 'Equal player odds' },
      ],
    },
    knowledgeField,
  ];
</script>

<SettingsChoices {...props} {fields} />
