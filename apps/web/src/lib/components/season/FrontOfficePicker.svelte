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

<fieldset>
  <legend class="font-display text-base font-extrabold uppercase tracking-tight">
    Front office
  </legend>
  <p class="mt-1 text-sm text-muted-foreground">
    One executive for the run. Every pairing is legal. The choice sticks — no replacements, no
    leveling.
  </p>
  <div class="mt-3 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Front office executive">
    {#each SEASON_FRONT_OFFICE_CATALOG as executive (executive.id)}
      {@const selected = value === executive.id}
      <div
        role="radio"
        aria-checked={selected}
        tabindex={disabled ? -1 : 0}
        onkeydown={(event) => onCardKeydown(event, executive.id)}
        onclick={() => choose(executive.id)}
        class="cursor-pointer rounded-xl border-2 bg-surface-2 p-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {selected
          ? 'border-primary'
          : 'border-border hover:border-line-strong'}"
      >
        <div class="font-bold">{executive.displayName} — {executive.title}</div>
        <p class="mt-2 text-sm"><span class="font-semibold">Ability:</span> {executive.ability}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          <span class="font-semibold">Drawback:</span>
          {executive.drawback}
        </p>
      </div>
    {/each}
  </div>
</fieldset>
