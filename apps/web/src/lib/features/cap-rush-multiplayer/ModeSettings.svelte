<script lang="ts">
  import type { SettingsProps } from '#lib/modes/types.js';

  let { value, onchange, disabled = false }: SettingsProps = $props();

  const variant = $derived(value.variant ?? 'clash');
</script>

<div class="flex flex-col gap-2">
  <p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Variant</p>
  <div class="grid gap-2 sm:grid-cols-2">
    <button
      type="button"
      class="flex min-h-12 items-center justify-center rounded-xl border px-4 text-sm font-semibold
        {variant === 'clash'
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border bg-surface-2 text-foreground'}"
      {disabled}
      onclick={() => onchange({ ...value, variant: 'clash' })}
    >
      Normal
    </button>
    <button
      type="button"
      class="flex min-h-12 items-center justify-center rounded-xl border px-4 text-sm font-semibold
        {variant === 'roulette'
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border bg-surface-2 text-foreground'}"
      {disabled}
      onclick={() => onchange({ ...value, variant: 'roulette' })}
    >
      Mutation
    </button>
  </div>
  <p class="text-xs text-muted-foreground">
    Normal has no paid spins. Mutation unlocks the Cap Rush spin window after recruitment.
  </p>
</div>
