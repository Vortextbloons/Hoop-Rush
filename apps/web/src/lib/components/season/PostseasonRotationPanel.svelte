<script lang="ts">
  import { resolve } from '$app/paths';
  import type {
    HoopRushManifest,
    SeasonEffectsState,
    SeasonGameSummary,
    SeasonRotation,
  } from '@hoop-rush/data-contracts';
  import type { RotationEditor as RotationEditorType } from '#lib/season/season-rotation-editor.js';
  import type { RiskyRehabOption } from '#lib/season/season-postseason-presentation.js';
  import type { SeasonFaceRef } from '#lib/season/season-branding.js';
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
    canForfeit = false,
    onSubmit,
    onForfeit,
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
    canForfeit?: boolean;
    onSubmit: () => void;
    onForfeit: () => void;
  } = $props();
  const rehabInjuredPlayerCount = $derived(
    rehabOptions.filter((option) => !option.alreadyRehabbed).length,
  );
  let fineTuneOpen = $state(false);
  const minutesTotal = $derived(editor.rotation.targetMinutes.reduce((s, t) => s + t.minutes, 0));
  const closersCount = $derived(new Set(editor.rotation.closingFive).size);
  const minuteById = $derived(
    new Map(editor.rotation.targetMinutes.map((t) => [t.playerVersionId, t.minutes] as const)),
  );
  const startersLine = $derived(
    editor.rotation.starters
      .map((id) => {
        const name = editor.names.get(id) ?? id;
        const short = name.split(' ').slice(-1)[0] ?? name;
        return `${short} ${String(minuteById.get(id) ?? 0)}`;
      })
      .join(' · '),
  );
</script>

<section
  aria-labelledby="postseason-lineup-heading"
  data-season-postseason-lineup
  class="sr-panel-quiet p-4 sm:p-5"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="postseason-lineup-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight text-foreground"
    >
      Game 1 rotation
    </h2>
    <span class="sr-section-label">
      {matchupLabel}{matchupDetail !== null ? ` · ${matchupDetail}` : ''}
    </span>
  </div>

  <div
    class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5"
  >
    <div class="min-w-0">
      <p class="sr-number font-mono text-[11px] font-bold text-foreground">
        {String(minutesTotal)}/240 min · {String(closersCount)}/5 closers
      </p>
      <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{startersLine}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <a href={resolve('/season/run/team' as any)} class="sr-btn-ghost px-3.5 text-xs">
        Edit rotation
      </a>
      <button
        type="button"
        aria-expanded={fineTuneOpen}
        aria-controls="playoff-fine-tune"
        onclick={() => (fineTuneOpen = !fineTuneOpen)}
        class="sr-btn-ghost px-3.5 text-xs {fineTuneOpen ? '' : 'text-muted-foreground'}"
      >
        {fineTuneOpen ? 'Hide fine-tune' : 'Fine-tune here'}
      </button>
    </div>
  </div>

  {#if canForfeit}
    <div class="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
      <p class="text-xs text-muted-foreground">
        Your roster is carrying an active injury. You can take a 0–2 playoff loss without spending
        Influence.
      </p>
      <button
        type="button"
        data-season-postseason-forfeit
        onclick={onForfeit}
        disabled={submitting || disabled}
        class="sr-btn-danger mt-2 w-full"
      >
        Forfeit game and continue
      </button>
    </div>
  {/if}

  {#if fineTuneOpen}
    <div id="playoff-fine-tune" class="mt-3">
      <RotationEditor {editor} {disabled} {onchange} {faces} {manifest} {effects} {summaries} />
      <button
        type="button"
        data-season-postseason-submit-secondary
        onclick={onSubmit}
        disabled={!canSubmit || submitting || disabled}
        class="sr-btn-ghost mt-3 w-full"
      >
        {submitting ? 'Locking lineup…' : `Lock lineup and play ${matchupLabel}`}
      </button>
    </div>
  {/if}

  {#if rehabOptions.length > 0}
    <fieldset class="mt-4 rounded-lg bg-surface-2 p-3">
      <legend class="sr-section-label flex flex-wrap items-baseline gap-2">
        Injured players · risky rehab
      </legend>
      <p class="mt-1 text-xs text-muted-foreground">
        A lineup with an injured player is rejected.
        {#if rehabOptions.length > 0 && rehabOptions[0] !== undefined}
          Bring back a player ({rehabOptions[0].cost}◆): chance sooner, can set back.
        {:else}
          Chance sooner, can set back.
        {/if}
        Balance:
        <span class="sr-number font-mono font-bold text-foreground">{balance}</span>.
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
                  <span class="block truncate text-xs font-semibold">
                    Bring back {option.displayName} ({option.cost}◆)
                    {#if option.alreadyRehabbed}
                      <span class="ml-1 font-mono text-xs text-muted-foreground">rolled</span>
                    {/if}
                  </span>
                  <span class="block font-mono text-xs text-muted-foreground">
                    Chance sooner, can set back.
                  </span>
                </span>
                {#if option.alreadyRehabbed}
                  <span class="sr-chip shrink-0"> Rolled </span>
                {:else if !option.available}
                  <span class="sr-badge shrink-0" data-tone="loss">
                    Needs {option.cost}◆
                  </span>
                {:else}
                  <span class="sr-badge shrink-0" data-tone="hardwood">
                    {option.cost}◆
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
    <p class="sr-section-label">
      The hero card above plays the game — this panel stays a summary unless you open fine-tune.
    </p>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    {submitting ? 'Locking your postseason lineup.' : ''}
  </p>
  <span class="hidden">{targetGameId}</span>
</section>
