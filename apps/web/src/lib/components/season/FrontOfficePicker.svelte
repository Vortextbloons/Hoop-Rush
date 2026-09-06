<script lang="ts">
  import { SEASON_FRONT_OFFICE_CATALOG, type SeasonFrontOfficeId } from '@hoop-rush/data-contracts';
  let {
    value = null,
    disabled = false,
    onChange,
  }: {
    value?: SeasonFrontOfficeId | null;
    disabled?: boolean;
    onChange: (executiveId: SeasonFrontOfficeId) => void;
  } = $props();
  function choose(id: SeasonFrontOfficeId): void {
    if (disabled) return;
    onChange(id);
  }
  function onCardKeydown(event: KeyboardEvent, id: SeasonFrontOfficeId): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(id);
    }
  }
</script>

<div class="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Executive">
  {#each SEASON_FRONT_OFFICE_CATALOG as executive (executive.id)}
    {@const selected = value === executive.id}
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabindex={disabled ? -1 : 0}
      onkeydown={(event) => onCardKeydown(event, executive.id)}
      onclick={() => choose(executive.id)}
      class="relative min-h-11 cursor-pointer overflow-hidden rounded-xl border-2 bg-surface-2 p-4 pt-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none {selected
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-line-strong'} {disabled
        ? 'cursor-not-allowed opacity-60'
        : ''}"
    >
      {#if selected}
        <span aria-hidden="true" class="absolute inset-y-0 left-0 w-1 bg-primary"></span>
        <span
          class="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-primary-foreground uppercase"
        >
          <span aria-hidden="true">✓</span> Selected
        </span>
      {/if}
      <p class="font-display text-base font-extrabold tracking-tight uppercase">
        {executive.displayName}
      </p>
      <p class="mt-0.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {executive.title}
      </p>
      <ul class="mt-3 space-y-1.5">
        <li class="flex gap-2 text-xs leading-snug font-semibold text-foreground">
          <span aria-hidden="true" class="font-bold text-primary">+</span>
          <span>{executive.ability}</span>
        </li>
        <li class="flex gap-2 text-xs leading-snug text-muted-foreground">
          <span aria-hidden="true" class="font-bold">−</span>
          <span>{executive.drawback}</span>
        </li>
      </ul>
    </div>
  {/each}
</div>
