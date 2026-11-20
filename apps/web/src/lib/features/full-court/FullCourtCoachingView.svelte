<script lang="ts">
  import type {
    FullCourtCoachingPlan,
    FullCourtTactics,
    SimulationPlayer,
  } from '@hoop-rush/data-contracts';
  import { untrack } from 'svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import {
    FULL_COURT_MAX_PLAYER_MINUTES,
    FULL_COURT_MINUTE_TOTAL,
    defaultFullCourtCoachingDraft,
    fullCourtCoachingDraft,
    fullCourtCoachingPlan,
    validateFullCourtCoachingDraft,
    type FullCourtCoachingDraft,
    type FullCourtRotationMode,
  } from './full-court-coaching-presenter.ts';

  let {
    roster,
    defaultRotation,
    plan,
    busy,
    onSave,
  }: {
    roster: readonly SimulationPlayer[];
    defaultRotation: NonNullable<FullCourtCoachingPlan['rotation']>;
    plan: FullCourtCoachingPlan;
    busy: boolean;
    onSave: (plan: FullCourtCoachingPlan) => Promise<boolean>;
  } = $props();

  const SLOTS = [0, 1, 2, 3, 4] as const;
  const PACE_OPTIONS = [
    { value: 'slow', label: 'Slow' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'fast', label: 'Fast' },
  ] as const satisfies readonly { value: FullCourtTactics['pace']; label: string }[];
  const OFFENSE_OPTIONS = [
    { value: 'balanced', label: 'Balanced' },
    { value: 'perimeter', label: 'Perimeter' },
    { value: 'interior', label: 'Interior' },
    { value: 'ball-movement', label: 'Ball movement' },
  ] as const satisfies readonly { value: FullCourtTactics['offense']; label: string }[];
  const DEFENSE_OPTIONS = [
    { value: 'balanced', label: 'Balanced' },
    { value: 'pressure', label: 'Pressure' },
    { value: 'protect-paint', label: 'Protect paint' },
  ] as const satisfies readonly { value: FullCourtTactics['defense']; label: string }[];
  const ROTATION_OPTIONS = [
    { value: 'automatic', label: 'Automatic' },
    { value: 'custom', label: 'Custom' },
  ] as const satisfies readonly { value: FullCourtRotationMode; label: string }[];
  const SELECT_CLASS =
    'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  const rosterIds = $derived(roster.map((player) => player.playerId));
  let draft = $state<FullCourtCoachingDraft>(
    untrack(() => fullCourtCoachingDraft(plan, defaultRotation, rosterIds)),
  );
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let savedMessage = $state<string | null>(null);
  let announcement = $state('');

  const validation = $derived(validateFullCourtCoachingDraft(draft, rosterIds));
  const locked = $derived(busy || saving);
  const starterSet = $derived(new Set(draft.startingFive));

  function markEdited(): void {
    saveError = null;
    savedMessage = null;
  }

  function setRotationMode(mode: FullCourtRotationMode): void {
    draft.rotationMode = mode;
    markEdited();
  }

  function setStarter(slot: number, playerId: string): void {
    const existingSlot = draft.startingFive.indexOf(playerId);
    if (existingSlot >= 0 && existingSlot !== slot) {
      draft.startingFive[existingSlot] = draft.startingFive[slot]!;
    }
    draft.startingFive[slot] = playerId;
    markEdited();
  }

  function setCloser(slot: number, playerId: string): void {
    const closers = draft.closingFive;
    if (closers === null) return;
    const existingSlot = closers.indexOf(playerId);
    if (existingSlot >= 0 && existingSlot !== slot) {
      closers[existingSlot] = closers[slot]!;
    }
    closers[slot] = playerId;
    markEdited();
  }

  function setMinutes(playerId: string, raw: string): void {
    const parsed = Number(raw);
    draft.minuteTargets[playerId] = Number.isFinite(parsed) ? parsed : 0;
    markEdited();
  }

  function toggleClosingFive(enabled: boolean): void {
    draft.closingFive = enabled ? [...draft.startingFive] : null;
    markEdited();
  }

  function cancel(): void {
    draft = fullCourtCoachingDraft(plan, defaultRotation, rosterIds);
    saveError = null;
    savedMessage = null;
    announcement = 'Changes discarded.';
  }

  function reset(): void {
    draft = defaultFullCourtCoachingDraft(defaultRotation, rosterIds);
    saveError = null;
    savedMessage = null;
    announcement = 'Reset to balanced tactics and automatic rotation.';
  }

  function minutesSummary(): string {
    if (validation.totalMinutes === FULL_COURT_MINUTE_TOTAL) {
      return `All ${String(FULL_COURT_MINUTE_TOTAL)} minutes assigned.`;
    }
    if (validation.totalMinutes < FULL_COURT_MINUTE_TOTAL) {
      const amount = FULL_COURT_MINUTE_TOTAL - validation.totalMinutes;
      return `${String(amount)} ${amount === 1 ? 'minute' : 'minutes'} left to assign.`;
    }
    const amount = validation.totalMinutes - FULL_COURT_MINUTE_TOTAL;
    return `${String(amount)} ${amount === 1 ? 'minute' : 'minutes'} over ${String(FULL_COURT_MINUTE_TOTAL)}.`;
  }

  async function save(): Promise<void> {
    if (!validation.valid || locked) return;
    saving = true;
    saveError = null;
    savedMessage = null;
    try {
      const saved = await onSave(fullCourtCoachingPlan(draft));
      if (!saved) {
        saveError = 'The coaching plan could not be saved. Try again.';
        return;
      }
      savedMessage = 'Coaching plan saved. It applies from your next game.';
      announcement = savedMessage;
    } catch (error) {
      saveError =
        error instanceof Error ? error.message : 'The coaching plan could not be saved. Try again.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="border-t border-line-soft p-4 sm:p-5">
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
    novalidate
  >
    <fieldset class="m-0 min-w-0 border-0 p-0" disabled={locked}>
      <legend class="sr-only">Coaching plan</legend>
      <SectionHeading
        level={3}
        size="sm"
        title="Tactics and rotation"
        description="Save to apply these settings from your next game."
      />

      <div class="mt-3 grid gap-3">
        <Panel as="section" padding="sm" aria-label="Tactics">
          <SectionHeading level={4} size="sm" title="Tactics" />
          <div class="mt-3 grid gap-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold">Pace</span>
              <SegmentedControl
                label="Pace"
                value={draft.tactics.pace}
                options={PACE_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
                onchange={(value) => {
                  draft.tactics.pace = value;
                  markEdited();
                }}
              />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold">Offense</span>
              <SegmentedControl
                label="Offense"
                value={draft.tactics.offense}
                options={OFFENSE_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
                onchange={(value) => {
                  draft.tactics.offense = value;
                  markEdited();
                }}
              />
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold">Defense</span>
              <SegmentedControl
                label="Defense"
                value={draft.tactics.defense}
                options={DEFENSE_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
                onchange={(value) => {
                  draft.tactics.defense = value;
                  markEdited();
                }}
              />
            </div>
          </div>
        </Panel>

        <Panel as="section" padding="sm" aria-label="Rotation">
          <SectionHeading level={4} size="sm" title="Rotation" />
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-semibold">Minutes and starters</span>
            <SegmentedControl
              label="Rotation source"
              value={draft.rotationMode}
              options={ROTATION_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
              onchange={setRotationMode}
            />
          </div>

          {#if draft.rotationMode === 'automatic'}
            <p
              class="mt-2 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              The staff sets the starters and minutes for every game. Choose Custom to lock in your
              own five and minute targets.
            </p>
          {:else}
            <div class="mt-4">
              <div class="flex flex-wrap items-baseline justify-between gap-1">
                <p class="ui-label" data-tone="muted">Starting five</p>
                <p class="ui-micro">Positions are advisory</p>
              </div>
              <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {#each SLOTS as slot (slot)}
                  <label class="min-w-0">
                    <span class="ui-micro">Starter {slot + 1}</span>
                    <select
                      class={SELECT_CLASS}
                      value={draft.startingFive[slot] ?? ''}
                      disabled={locked}
                      onchange={(event) => setStarter(slot, event.currentTarget.value)}
                    >
                      {#each roster as player (player.playerId)}
                        <option value={player.playerId}>
                          {player.displayName} · {formatPositions(player.positions)}
                        </option>
                      {/each}
                    </select>
                  </label>
                {/each}
              </div>
            </div>

            <div class="mt-4">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="ui-label" data-tone="muted">Minute targets</p>
                <Badge
                  tone={validation.totalMinutes === FULL_COURT_MINUTE_TOTAL
                    ? 'positive'
                    : validation.totalMinutes > FULL_COURT_MINUTE_TOTAL
                      ? 'negative'
                      : 'neutral'}
                >
                  {validation.totalMinutes} / {FULL_COURT_MINUTE_TOTAL} min
                </Badge>
              </div>
              <p
                class="mt-1 text-[11px] leading-snug {validation.totalMinutes ===
                FULL_COURT_MINUTE_TOTAL
                  ? 'text-positive'
                  : 'text-muted-foreground'}"
                aria-live="polite"
              >
                {minutesSummary()}
              </p>
              <div class="mt-2 grid gap-1.5 md:grid-cols-2">
                {#each roster as player (player.playerId)}
                  <div
                    class="flex min-w-0 items-center gap-2 rounded-lg border border-line-soft bg-surface-1 px-2.5 py-2"
                  >
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-semibold">
                        {player.displayName}
                      </span>
                      <span class="ui-micro">
                        {formatPositions(player.positions)} ·
                        {starterSet.has(player.playerId) ? 'Starter' : 'Bench'}
                      </span>
                    </span>
                    <label class="inline-flex shrink-0 items-center gap-1">
                      <span class="sr-only">Minutes for {player.displayName}</span>
                      <input
                        type="number"
                        inputmode="numeric"
                        min="0"
                        max={FULL_COURT_MAX_PLAYER_MINUTES}
                        step="1"
                        class="min-h-10 w-16 rounded-lg border border-line-soft bg-surface-2 px-2 text-right font-mono text-sm tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        value={draft.minuteTargets[player.playerId] ?? 0}
                        disabled={locked}
                        oninput={(event) => setMinutes(player.playerId, event.currentTarget.value)}
                      />
                      <span class="ui-micro" aria-hidden="true">min</span>
                    </label>
                  </div>
                {/each}
              </div>
            </div>

            <div class="mt-4 border-t border-line-soft pt-3">
              <label class="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  class="size-4 accent-primary"
                  checked={draft.closingFive !== null}
                  disabled={locked}
                  onchange={(event) => toggleClosingFive(event.currentTarget.checked)}
                />
                Set a closing five
              </label>
              <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
                Optional. Used in late, close games.
              </p>
              {#if draft.closingFive !== null}
                {@const closers = draft.closingFive}
                <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {#each SLOTS as slot (slot)}
                    <label class="min-w-0">
                      <span class="ui-micro">Closer {slot + 1}</span>
                      <select
                        class={SELECT_CLASS}
                        value={closers[slot] ?? ''}
                        disabled={locked}
                        onchange={(event) => setCloser(slot, event.currentTarget.value)}
                      >
                        {#each roster as player (player.playerId)}
                          <option value={player.playerId}>
                            {player.displayName} · {formatPositions(player.positions)}
                          </option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </Panel>
      </div>

      {#if !validation.valid}
        <div
          class="mt-3 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2"
          role="alert"
        >
          <ul class="space-y-0.5 text-xs font-semibold text-negative">
            {#each validation.errors as error (error)}
              <li>{error}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if saveError !== null}
        <Alert tone="danger" class="mt-3">{saveError}</Alert>
      {/if}
      {#if savedMessage !== null}
        <p class="mt-3 text-xs font-semibold text-positive" role="status">{savedMessage}</p>
      {/if}
    </fieldset>

    <ActionRow class="mt-4 border-t border-line-soft pt-4">
      {#snippet primary()}
        <Button
          type="submit"
          tone="primary"
          loading={saving}
          disabled={!validation.valid || locked}
        >
          Save
        </Button>
      {/snippet}
      {#snippet secondary()}
        <Button tone="secondary" disabled={locked} onclick={cancel}>Cancel</Button>
      {/snippet}
      {#snippet tertiary()}
        <Button tone="ghost" disabled={locked} onclick={reset}>Reset</Button>
      {/snippet}
    </ActionRow>
  </form>
</div>
