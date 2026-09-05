<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonEffectsState,
    SeasonGameSummary,
    SeasonRotation,
  } from '@hoop-rush/data-contracts';
  import type { RotationEditor as RotationEditorType } from '$lib/season/season-rotation-editor';
  import type { RiskyRehabOption } from '$lib/season/season-postseason-presentation';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  import { INJURY_SEVERITY_LABEL } from '$lib/season/season-health-view';
  import RotationEditor from './RotationEditor.svelte';
  let {
    editor,
    disabled,
    onchange,
    faces = null,
    manifest = null,
    effects = null,
    summaries = [],
    targetGameId,
    matchupLabel,
    matchupDetail = null,
    rehabOptions,
    selectedRehabInjuryId,
    onRehabSelect,
    failures,
    rejectionMessage,
    balance,
    submitting,
    canSubmit,
    onSubmit,
  }: {
    editor: RotationEditorType;
    disabled: boolean;
    onchange: (rotation: SeasonRotation, failures: string[]) => void;
    faces?: ReadonlyMap<string, SeasonFaceRef> | null;
    manifest?: HoopRushManifest | null;
    effects?: SeasonEffectsState | null;
    summaries?: SeasonGameSummary[];
    targetGameId: string;
    matchupLabel: string;
    matchupDetail?: string | null;
    rehabOptions: RiskyRehabOption[];
    selectedRehabInjuryId: string | null;
    onRehabSelect: (injuryId: string | null) => void;
    failures: string[];
    rejectionMessage: string | null;
    balance: number;
    submitting: boolean;
    canSubmit: boolean;
    onSubmit: () => void;
  } = $props();
  const rehabInjuredPlayerCount = $derived(
    rehabOptions.filter((option) => !option.alreadyRehabbed).length,
  );
</script>

<section
  aria-labelledby="postseason-lineup-heading"
  data-season-postseason-lineup
  class="rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="postseason-lineup-heading"
      class="font-display text-lg font-extrabold uppercase tracking-tight"
    >
      Your lineup
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      {matchupLabel}{matchupDetail !== null ? ` · ${matchupDetail}` : ''}
    </span>
  </div>

  <div class="mt-3">
    <RotationEditor
      {editor}
      {disabled}
      {onchange}
      {faces}
      {manifest}
      {effects}
      {summaries}
      optimize={null}
    />
  </div>

  {#if rehabOptions.length > 0}
    <fieldset class="mt-4 rounded-lg bg-surface-2 p-3">
      <legend
        class="flex flex-wrap items-baseline gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
      >
        Injured players · risky rehab
      </legend>
      <p class="mt-1 text-sm text-muted-foreground">
        A lineup with an injured player is rejected. Spend
        <strong class="text-foreground"> 2 Influence</strong> to roll a risky rehab before this game
        (once per injury). Balance:
        <span class="font-mono font-bold text-foreground">{balance}</span>.
      </p>
      {#if rehabInjuredPlayerCount === 0}
        <p class="mt-2 text-sm text-muted-foreground">
          Every active injury has already been rolled this postseason.
        </p>
      {:else}
        <ul class="mt-2 flex flex-col gap-2" data-season-rehab-options>
          {#each rehabOptions as option (option.injuryId)}
            <li>
              <label
                class="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-1 p-2.5 outline-none focus-within:ring-2 focus-within:ring-ring {option.alreadyRehabbed
                  ? 'opacity-60'
                  : ''}"
              >
                <input
                  type="radio"
                  name="postseason-risky-rehab"
                  data-season-rehab-option={option.injuryId}
                  class="h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                  value={option.injuryId}
                  checked={selectedRehabInjuryId === option.injuryId}
                  disabled={disabled || option.alreadyRehabbed || !option.available}
                  onchange={() => onRehabSelect(option.injuryId)}
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">
                    {option.displayName}
                    {#if option.alreadyRehabbed}
                      <span class="ml-1 font-mono text-[10px] text-muted-foreground">rolled</span>
                    {/if}
                  </span>
                  <span class="block font-mono text-[10px] text-muted-foreground">
                    {INJURY_SEVERITY_LABEL[option.severity]} · {option.missedGamesRemaining} game
                    {option.missedGamesRemaining === 1 ? 'out' : 's out'}
                  </span>
                </span>
                {#if option.alreadyRehabbed}
                  <span
                    class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    Rolled
                  </span>
                {:else if !option.available}
                  <span
                    class="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-destructive"
                  >
                    Needs 2 Influence
                  </span>
                {:else}
                  <span
                    class="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                  >
                    {option.cost} Influence
                  </span>
                {/if}
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    </fieldset>
  {/if}

  <div class="mt-4 flex flex-col gap-3">
    {#if failures.length > 0}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
        The lineup is invalid — fix the highlighted issues above before locking it in.
      </p>
    {/if}
    {#if rejectionMessage !== null}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
        {rejectionMessage}
      </p>
    {/if}
    <button
      type="button"
      data-season-postseason-submit
      onclick={onSubmit}
      disabled={!canSubmit || submitting || disabled}
      class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
    >
      {submitting ? 'Locking lineup…' : `Lock lineup and simulate ${matchupLabel}`}
    </button>
    <p class="hidden font-mono text-[10px] text-muted-foreground sm:block">
      Nothing is saved until the game completes.
    </p>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    {submitting ? 'Locking your postseason lineup.' : ''}
  </p>
</section>
