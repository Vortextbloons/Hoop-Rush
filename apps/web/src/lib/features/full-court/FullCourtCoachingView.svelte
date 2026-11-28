<script lang="ts">
  import type { SaveFullCourtBlueprintOptions } from '@hoop-rush/application/full-court';
  import type {
    FullCourtBlueprint,
    FullCourtCoachingPlan,
    FullCourtCoachingRule,
    FullCourtDefensiveMatchupAssignment,
    FullCourtInterfaceLevel,
    FullCourtTactics,
    FullCourtTeamHealth,
    SimulationPlayer,
  } from '@hoop-rush/data-contracts';
  import type { FullCourtBlueprintBindingPreview } from '@hoop-rush/engine';
  import { untrack } from 'svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import FullCourtBlueprintPicker from './FullCourtBlueprintPicker.svelte';
  import FullCourtDefensiveMatchupsPanel from './FullCourtDefensiveMatchupsPanel.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRuleEditor from './FullCourtRuleEditor.svelte';
  import TeamCourtPreview from './TeamCourtPreview.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtMatchupEditorContext } from './full-court-matchup-presenter.ts';
  import {
    FULL_COURT_MAX_PLAYER_MINUTES,
    FULL_COURT_MAX_UNITS,
    FULL_COURT_MINUTE_TOTAL,
    FULL_COURT_UNIT_NAME_MAX_LENGTH,
    activeRotationForBlueprint,
    applyFullCourtBlueprintToDraft,
    defaultFullCourtCoachingDraft,
    fullCourtCoachingDraft,
    fullCourtCoachingPlan,
    fullCourtCoachingSignature,
    fullCourtTeamMinutes,
    fullCourtUnitNameForLineup,
    newFullCourtClosingRule,
    newFullCourtFoulTroubleRule,
    nextFullCourtRuleId,
    validateFullCourtCoachingDraft,
    type FullCourtCoachingDraft,
    type FullCourtNamedUnitDraft,
    type FullCourtOffensiveHierarchyDraft,
    type FullCourtRotationMode,
    type FullCourtTeamMinutesRow,
  } from './full-court-coaching-presenter.ts';

  let {
    roster,
    defaultRotation,
    plan,
    busy,
    onSave,
    onListBlueprints,
    onSaveBlueprint,
    onRemoveBlueprint,
    readOnly = false,
    health = null,
    dayOffset = null,
    matchupContext = null,
    onMatchupsChange,
    onResetMatchups,
    art = null,
  }: {
    roster: readonly SimulationPlayer[];
    defaultRotation: NonNullable<FullCourtCoachingPlan['rotation']>;
    plan: FullCourtCoachingPlan;
    busy: boolean;
    onSave: (plan: FullCourtCoachingPlan) => Promise<boolean>;
    onListBlueprints?: () => Promise<FullCourtBlueprint[]>;
    onSaveBlueprint?: (
      name: string,
      tactics: FullCourtTactics,
      options?: SaveFullCourtBlueprintOptions,
    ) => Promise<FullCourtBlueprint>;
    onRemoveBlueprint?: (name: string) => Promise<void>;
    readOnly?: boolean;
    health?: FullCourtTeamHealth | null;
    dayOffset?: number | null;
    matchupContext?: FullCourtMatchupEditorContext | null;
    onMatchupsChange?: (assignments: readonly FullCourtDefensiveMatchupAssignment[]) => void;
    onResetMatchups?: () => void;
    art?: FullCourtArt | null;
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
  const INTERFACE_OPTIONS = [
    { value: 'quick', label: 'Quick Coach' },
    { value: 'remix', label: 'Remix' },
    { value: 'mastermind', label: 'Mastermind' },
  ] as const satisfies readonly { value: FullCourtInterfaceLevel; label: string }[];
  const HIERARCHY_ROLES = [
    {
      key: 'primaryPlayerId',
      label: 'Primary option',
      hint: 'Runs the most offense and takes the largest share of his own looks.',
    },
    {
      key: 'secondaryPlayerId',
      label: 'Second option',
      hint: 'Takes a moderate share behind the primary option.',
    },
    {
      key: 'floorGeneralPlayerId',
      label: 'Floor general',
      hint: 'Starts more possessions and passes more instead of shooting more.',
    },
  ] as const satisfies readonly {
    key: keyof FullCourtOffensiveHierarchyDraft;
    label: string;
    hint: string;
  }[];
  const SELECT_CLASS =
    'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  const rosterIds = $derived(roster.map((player) => player.playerId));
  let draft = $state<FullCourtCoachingDraft>(
    untrack(() => fullCourtCoachingDraft(plan, defaultRotation, rosterIds)),
  );
  let savedSignature = $state(untrack(() => fullCourtCoachingSignature(plan)));
  let focusedSlot = $state<number | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let savedMessage = $state<string | null>(null);
  let announcement = $state('');

  // The Team tab keeps this editor mounted across runs, so a new roster has to
  // seed a new draft. An in-place plan change keeps local work; Discard reloads it.
  const rosterKey = $derived(rosterIds.join('\u0000'));
  let seededRoster = $state(untrack(() => rosterKey));
  $effect(() => {
    if (rosterKey === seededRoster) return;
    untrack(() => {
      seededRoster = rosterKey;
      draft = fullCourtCoachingDraft(plan, defaultRotation, rosterIds);
      savedSignature = fullCourtCoachingSignature(plan);
      focusedSlot = null;
      saveError = null;
      savedMessage = null;
    });
  });

  const validation = $derived(validateFullCourtCoachingDraft(draft, rosterIds));
  const locked = $derived(readOnly || busy || saving);
  const editingRotation = $derived(draft.rotationMode === 'custom');
  const minutes = $derived(
    fullCourtTeamMinutes(
      editingRotation ? draft : { ...draft, ...defaultRotation, closingFive: null },
      roster,
      plan,
      health,
      dayOffset,
    ),
  );
  const displayedMinutes = $derived(minutes.starterMinutes + minutes.benchMinutes);
  const dirty = $derived(
    fullCourtCoachingSignature(fullCourtCoachingPlan(draft)) !== savedSignature,
  );
  const saveLabel = $derived(saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved');
  const minuteGroups = $derived([
    { label: 'Starters', rows: minutes.starters, total: minutes.starterMinutes },
    { label: 'Bench', rows: minutes.bench, total: minutes.benchMinutes },
  ]);
  const blueprintRotation = $derived(activeRotationForBlueprint(draft, defaultRotation));
  const mastermind = $derived(draft.interfaceLevel === 'mastermind' && !readOnly);
  const playerNames = $derived(
    new Map(roster.map((player) => [player.playerId, player.displayName])),
  );
  const lineupNames = (ids: readonly string[]) =>
    ids.map((id) => playerNames.get(id) ?? 'Unavailable player').join(', ');
  const hasStaggerScorers = $derived(
    draft.hierarchy.primaryPlayerId !== null || draft.hierarchy.secondaryPlayerId !== null,
  );
  const interfaceDescription = $derived(
    draft.interfaceLevel === 'quick'
      ? 'Set a strategy, choose your starters, and manage bench minutes.'
      : draft.interfaceLevel === 'remix'
        ? 'Set pace, offense, defense, rotation, and the closing five.'
        : 'Fine-tune scoring roles, lineup groups, situational rules, and defensive matchups.',
  );

  function setInterfaceLevel(level: FullCourtInterfaceLevel): void {
    draft.interfaceLevel = level;
    markEdited();
  }

  function addRule(kind: FullCourtCoachingRule['kind']): void {
    const ruleId = nextFullCourtRuleId(draft.rules);
    draft.rules = [
      ...draft.rules,
      kind === 'closing-lineup'
        ? newFullCourtClosingRule(ruleId, rosterIds)
        : newFullCourtFoulTroubleRule(ruleId, rosterIds),
    ];
    markEdited();
  }

  function updateRule(index: number, rule: FullCourtCoachingRule): void {
    draft.rules = draft.rules.map((current, position) => (position === index ? rule : current));
    markEdited();
  }

  function removeRule(index: number): void {
    draft.rules = draft.rules.filter((_rule, position) => position !== index);
    markEdited();
  }

  function moveRule(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= draft.rules.length) return;
    const rules = [...draft.rules];
    const [moved] = rules.splice(index, 1);
    if (moved === undefined) return;
    rules.splice(target, 0, moved);
    draft.rules = rules;
    markEdited();
  }

  function markEdited(): void {
    saveError = null;
    savedMessage = null;
  }

  function applyStrategyTactics(tactics: FullCourtTactics, label: string): void {
    if (
      tactics.pace === draft.tactics.pace &&
      tactics.offense === draft.tactics.offense &&
      tactics.defense === draft.tactics.defense
    ) {
      announcement = `${label} tactics are already selected.`;
      return;
    }
    draft.tactics = { ...tactics };
    markEdited();
    announcement = `Applied ${label} tactics to draft. Save changes to use them.`;
  }

  function applyStrategyBlueprint(
    blueprint: FullCourtBlueprint,
    _preview: FullCourtBlueprintBindingPreview,
  ): void {
    const result = applyFullCourtBlueprintToDraft(draft, blueprint, roster, defaultRotation);
    if (!result.changed) {
      announcement = `${blueprint.name} strategy is already selected.`;
      return;
    }
    draft.tactics = result.draft.tactics;
    draft.hierarchy = result.draft.hierarchy;
    markEdited();
    if (!result.preview.hasHierarchy) {
      announcement = `Applied ${blueprint.name} tactics to draft. Save changes to use them.`;
      return;
    }
    const boundCount = result.preview.bindings.filter(
      (binding) => binding.playerId !== null,
    ).length;
    const fallbackCount = result.preview.bindings.filter(
      (binding) => binding.status === 'fallback',
    ).length;
    const ambiguousCount = result.preview.bindings.filter(
      (binding) => binding.status === 'ambiguous',
    ).length;
    const vacantCount = result.preview.bindings.filter(
      (binding) => binding.status === 'vacant',
    ).length;
    const qualifiers: string[] = [];
    if (fallbackCount > 0) qualifiers.push(`${String(fallbackCount)} fallback`);
    if (ambiguousCount > 0) qualifiers.push(`${String(ambiguousCount)} ambiguous`);
    if (vacantCount > 0) qualifiers.push(`${String(vacantCount)} vacant`);
    const roleLabel = `${String(boundCount)} scoring ${boundCount === 1 ? 'role' : 'roles'}`;
    announcement =
      qualifiers.length > 0
        ? `Applied ${blueprint.name} to draft (${roleLabel} bound; ${qualifiers.join(', ')}). Save changes to use them.`
        : `Applied ${blueprint.name} tactics and ${roleLabel} to draft. Save changes to use them.`;
  }

  function setRotationMode(mode: FullCourtRotationMode): void {
    draft.rotationMode = mode;
    if (mode === 'automatic') focusedSlot = null;
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

  function nextUnitName(): string {
    const taken = new Set(draft.units.map((unit) => unit.name.trim().toLowerCase()));
    for (let index = 1; ; index += 1) {
      const candidate = `Unit ${String(index)}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  function addUnit(): void {
    if (locked || draft.units.length >= FULL_COURT_MAX_UNITS) return;
    const playerIds =
      draft.startingFive.length === SLOTS.length
        ? [...draft.startingFive]
        : rosterIds.slice(0, SLOTS.length);
    draft.units = [...draft.units, { name: nextUnitName(), playerIds }];
    markEdited();
  }

  function renameUnit(index: number, name: string): void {
    draft.units = draft.units.map((unit, position) =>
      position === index ? { ...unit, name } : unit,
    );
    markEdited();
  }

  function setUnitPlayer(index: number, slot: number, playerId: string): void {
    draft.units = draft.units.map((unit, position) => {
      if (position !== index) return unit;
      const playerIds = [...unit.playerIds];
      const existingSlot = playerIds.indexOf(playerId);
      if (existingSlot >= 0 && existingSlot !== slot) {
        playerIds[existingSlot] = playerIds[slot] ?? playerId;
      }
      playerIds[slot] = playerId;
      return { ...unit, playerIds };
    });
    markEdited();
  }

  function removeUnit(index: number): void {
    draft.units = draft.units.filter((_unit, position) => position !== index);
    markEdited();
  }

  function useUnitAsClosingFive(unit: FullCourtNamedUnitDraft): void {
    draft.rotationMode = 'custom';
    draft.closingFive = [...unit.playerIds];
    markEdited();
    announcement = `${unit.name || 'Named unit'} copied to the closing five. Save changes to use it.`;
  }

  function setHierarchyRole(role: keyof FullCourtOffensiveHierarchyDraft, raw: string): void {
    draft.hierarchy[role] = raw === '' ? null : raw;
    markEdited();
  }

  function toggleClosingFive(enabled: boolean): void {
    draft.closingFive = enabled ? [...draft.startingFive] : null;
    markEdited();
  }

  function cancel(): void {
    draft = fullCourtCoachingDraft(plan, defaultRotation, rosterIds);
    savedSignature = fullCourtCoachingSignature(plan);
    focusedSlot = null;
    saveError = null;
    savedMessage = null;
    announcement = 'Changes discarded.';
  }

  function reset(): void {
    const level = draft.interfaceLevel;
    draft = defaultFullCourtCoachingDraft(defaultRotation, rosterIds);
    draft.interfaceLevel = level;
    savedSignature = fullCourtCoachingSignature(plan);
    focusedSlot = null;
    saveError = null;
    savedMessage = null;
    announcement =
      'Reset to balanced tactics, automatic rotation, no scoring roles, no star staggering, no named units, and no conditional rules.';
  }

  function minutesSummary(): string {
    if (displayedMinutes === FULL_COURT_MINUTE_TOTAL) {
      return `All ${String(FULL_COURT_MINUTE_TOTAL)} minutes assigned.`;
    }
    if (displayedMinutes < FULL_COURT_MINUTE_TOTAL) {
      const amount = FULL_COURT_MINUTE_TOTAL - displayedMinutes;
      return `${String(amount)} ${amount === 1 ? 'minute' : 'minutes'} left to assign.`;
    }
    const amount = displayedMinutes - FULL_COURT_MINUTE_TOTAL;
    return `${String(amount)} ${amount === 1 ? 'minute' : 'minutes'} over ${String(FULL_COURT_MINUTE_TOTAL)}.`;
  }

  function roleLabel(row: FullCourtTeamMinutesRow): string {
    if (row.starterSlot !== null) {
      return `Starter ${String(row.starterSlot + 1)}`;
    }
    return row.minutes === 0 ? 'Out of rotation' : 'Bench';
  }

  async function save(): Promise<void> {
    if (!validation.valid || locked) return;
    saving = true;
    saveError = null;
    savedMessage = null;
    const submitted = fullCourtCoachingPlan(draft);
    try {
      const saved = await onSave(submitted);
      if (!saved) {
        saveError = 'The coaching plan could not be saved. Try again.';
        return;
      }
      savedSignature = fullCourtCoachingSignature(submitted);
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

<div class="min-w-0 p-4 sm:p-5">
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
    novalidate
  >
    {#if !readOnly}
      <div class="save-bar mb-3 rounded-lg border border-line-soft px-3 py-2">
        <p class="save-state" aria-live="polite">
          {#if dirty}
            Unsaved changes
          {:else}
            Saved plan is in use
          {/if}
        </p>
        <ActionRow>
          {#snippet primary()}
            <Button
              type="submit"
              tone={dirty ? 'primary' : 'secondary'}
              loading={saving}
              disabled={!validation.valid || locked || !dirty}
            >
              {saveLabel}
            </Button>
          {/snippet}
          {#snippet secondary()}
            <Button tone="secondary" disabled={locked || !dirty} onclick={cancel}>Discard</Button>
          {/snippet}
          {#snippet tertiary()}
            <Button tone="ghost" disabled={locked} onclick={reset}>Reset</Button>
          {/snippet}
        </ActionRow>
      </div>
    {/if}
    <fieldset class="m-0 min-w-0 border-0 p-0" disabled={locked}>
      <legend class="sr-only">Team</legend>
      <SectionHeading
        level={3}
        size="sm"
        title="Rotation and tactics"
        description={readOnly
          ? 'The rotation and tactics used for this run.'
          : 'Set the rotation and tactics that apply from your next game.'}
      />

      <div
        class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-1 px-3 py-2"
      >
        <div class="min-w-0">
          <p class="ui-label" data-tone="muted">Coaching interface</p>
          <p class="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {interfaceDescription}
          </p>
        </div>
        {#if readOnly}
          <Badge tone={draft.interfaceLevel === 'quick' ? 'neutral' : 'primary'}>
            {INTERFACE_OPTIONS.find((option) => option.value === draft.interfaceLevel)?.label ??
              'Remix'}
          </Badge>
        {:else}
          <SegmentedControl
            label="Coaching interface"
            value={draft.interfaceLevel}
            options={INTERFACE_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
            onchange={setInterfaceLevel}
          />
        {/if}
      </div>

      <div class="mt-3 grid gap-3">
        <Panel as="section" padding="sm" aria-label="Rotation">
          <SectionHeading level={4} size="sm" title="Rotation">
            {#snippet actions()}
              {#if readOnly}
                <Badge tone={editingRotation ? 'primary' : 'neutral'}>
                  {editingRotation ? 'Custom' : 'Automatic'}
                </Badge>
              {:else}
                <SegmentedControl
                  label="Rotation source"
                  value={draft.rotationMode}
                  options={ROTATION_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
                  onchange={setRotationMode}
                />
              {/if}
            {/snippet}
          </SectionHeading>

          {#if !editingRotation}
            <p
              class="mt-3 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {readOnly
                ? 'The staff sets the starters and minutes for every game.'
                : 'The staff sets the starters and minutes for every game. Choose Custom to lock in your own five and minute targets.'}
            </p>
          {/if}

          <div class="mt-4 border-t border-line-soft pt-3" aria-label="Minutes" role="group">
            <SectionHeading level={4} size="sm" title="Minutes">
              {#snippet actions()}
                {#if !readOnly && editingRotation}
                  <Button
                    tone="secondary"
                    size="sm"
                    disabled={locked}
                    onclick={() => {
                      draft.minuteTargets = { ...defaultRotation.minuteTargets };
                      markEdited();
                      announcement = 'Staff minutes copied. Save changes to use them.';
                    }}
                  >
                    Autofill minutes
                  </Button>
                {/if}
                <Badge
                  tone={displayedMinutes === FULL_COURT_MINUTE_TOTAL
                    ? 'positive'
                    : displayedMinutes > FULL_COURT_MINUTE_TOTAL
                      ? 'negative'
                      : 'neutral'}
                >
                  {displayedMinutes} / {FULL_COURT_MINUTE_TOTAL} min
                </Badge>
              {/snippet}
            </SectionHeading>
            <p
              class="mt-1 text-[11px] leading-snug {displayedMinutes === FULL_COURT_MINUTE_TOTAL
                ? 'text-positive'
                : 'text-muted-foreground'}"
              aria-live="polite"
            >
              {minutesSummary()}
            </p>
            <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                class="h-full rounded-full transition-all {displayedMinutes ===
                FULL_COURT_MINUTE_TOTAL
                  ? 'bg-positive'
                  : displayedMinutes > FULL_COURT_MINUTE_TOTAL
                    ? 'bg-negative'
                    : 'bg-primary'}"
                style={`width: ${String(Math.min(100, Math.round((displayedMinutes / FULL_COURT_MINUTE_TOTAL) * 100)))}%`}
              ></div>
            </div>

            <div class="mt-3 grid gap-1.5 md:grid-cols-2">
              {#each minuteGroups as group (group.label)}
                <div class="min-w-0">
                  <div class="flex items-baseline justify-between gap-2 px-0.5">
                    <p class="ui-label" data-tone="muted">{group.label}</p>
                    <p class="ui-micro">{group.total} min</p>
                  </div>
                  <ul class="mt-1.5 flex flex-col gap-1.5">
                    {#each group.rows as row (row.player.playerId)}
                      <li
                        class="flex min-w-0 items-center gap-2 rounded-lg border bg-surface-1 px-2.5 py-2 {row.starterSlot !==
                          null && focusedSlot === row.starterSlot
                          ? 'border-primary/50'
                          : 'border-line-soft'}"
                      >
                        <FullCourtPortrait player={row.player} {art} size="md" />
                        <div class="min-w-0 flex-1">
                          {#if editingRotation && !readOnly && row.starterSlot !== null}
                            {@const slot = row.starterSlot}
                            <select
                              class="min-h-8 w-full rounded-md border border-line-soft bg-surface-2 px-1.5 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label={`Change Starter ${slot + 1}`}
                              value={row.player.playerId}
                              disabled={locked}
                              onfocus={() => (focusedSlot = slot)}
                              onchange={(event) => setStarter(slot, event.currentTarget.value)}
                            >
                              {#each roster as player (player.playerId)}
                                <option value={player.playerId}>
                                  {player.displayName} · {formatPositions(player.positions)}
                                </option>
                              {/each}
                            </select>
                          {:else}
                            <span class="block truncate text-sm font-semibold">
                              {row.player.displayName}
                            </span>
                          {/if}
                          <span class="ui-micro flex flex-wrap items-center gap-x-1.5">
                            <span>{roleLabel(row)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatPositions(row.player.positions)}</span>
                            {#if row.closer}
                              <span class="text-accent">· Closer</span>
                            {/if}
                            {#if row.health !== null}
                              <span
                                class={row.health.tone === 'unavailable'
                                  ? 'text-negative'
                                  : row.health.tone === 'fatigued'
                                    ? 'text-accent'
                                    : ''}
                              >
                                · {row.health.label}
                              </span>
                            {/if}
                            {#if row.player.overall != null}
                              <span>· {row.player.overall} OVR</span>
                            {/if}
                          </span>
                        </div>
                        {#if editingRotation && !readOnly}
                          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
                            <label class="grid justify-items-center gap-0.5">
                              <span class="sr-only">Minutes for {row.player.displayName}</span>
                              <input
                                type="number"
                                inputmode="numeric"
                                min="0"
                                max={FULL_COURT_MAX_PLAYER_MINUTES}
                                step="1"
                                class="min-h-10 w-16 rounded-lg border border-line-soft bg-surface-2 px-1.5 text-center font-mono text-sm tabular-nums text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                value={row.minutes}
                                disabled={locked}
                                oninput={(event) =>
                                  setMinutes(row.player.playerId, event.currentTarget.value)}
                              />
                              <span class="ui-micro" aria-hidden="true">min</span>
                            </label>
                            {#if row.starterSlot === null && !row.closer && row.minutes > 0}
                              <Button
                                type="button"
                                tone="ghost"
                                size="sm"
                                disabled={locked}
                                aria-label={`Sit ${row.player.displayName}`}
                                onclick={() => setMinutes(row.player.playerId, '0')}
                              >
                                Sit
                              </Button>
                            {/if}
                          </div>
                        {:else}
                          <p class="shrink-0 font-mono text-sm font-bold tabular-nums">
                            {row.minutes} <span class="ui-micro">min</span>
                          </p>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/each}
            </div>
          </div>
          <details class="mt-4 rounded-lg border border-line-soft bg-surface-1 p-3">
            <summary class="cursor-pointer text-sm font-semibold">Court preview</summary>
            <div class="mt-3">
              <TeamCourtPreview
                starters={minutes.starters}
                bench={minutes.bench}
                {focusedSlot}
                readOnly
                {art}
              />
            </div>
          </details>

          {#if editingRotation}
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
          {#if !readOnly}
            <FullCourtBlueprintPicker
              tactics={draft.tactics}
              {roster}
              rotation={blueprintRotation}
              hierarchy={draft.hierarchy}
              disabled={locked}
              onApplyTactics={applyStrategyTactics}
              onApplyBlueprint={applyStrategyBlueprint}
              {onListBlueprints}
              {onSaveBlueprint}
              {onRemoveBlueprint}
            />
          {/if}
        </Panel>

        {#if mastermind}
          <Panel as="section" padding="sm" aria-label="Scoring hierarchy">
            <SectionHeading
              level={4}
              size="sm"
              title="Scoring hierarchy"
              description="Choose who takes the lead on offense and who sets up teammates."
            />
            <div class="mt-3 grid gap-3 md:grid-cols-3">
              {#each HIERARCHY_ROLES as role (role.key)}
                <label class="grid min-w-0 gap-1">
                  <span class="text-sm font-semibold">{role.label}</span>
                  <select
                    class={SELECT_CLASS}
                    aria-label={role.label}
                    value={draft.hierarchy[role.key] ?? ''}
                    disabled={locked}
                    onchange={(event) => setHierarchyRole(role.key, event.currentTarget.value)}
                  >
                    <option value="">Not set</option>
                    {#each roster as player (player.playerId)}
                      <option value={player.playerId}>
                        {player.displayName} · {formatPositions(player.positions)}
                      </option>
                    {/each}
                  </select>
                  <span class="text-xs text-muted-foreground">{role.hint}</span>
                </label>
              {/each}
            </div>
            <div class="mt-4 rounded-lg border border-line-soft bg-surface-1 px-3 py-2.5">
              <label class="flex items-start gap-2">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={draft.staggerStars}
                  disabled={locked}
                  onchange={(event) => {
                    draft.staggerStars = event.currentTarget.checked;
                    markEdited();
                  }}
                />
                <span class="min-w-0">
                  <span class="block text-sm font-semibold">Stagger stars</span>
                  <span class="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    Keep at least one primary or secondary option on the floor when available.
                    Foul-outs, injuries, exhaustion, and explicit rules still take priority.
                  </span>
                  {#if !hasStaggerScorers}
                    <span class="mt-1 block text-[11px] font-semibold text-accent">
                      Assign a primary or secondary option to use this preference.
                    </span>
                  {/if}
                </span>
              </label>
            </div>
          </Panel>
        {/if}

        {#if mastermind}
          <Panel as="section" padding="sm" aria-label="Named units">
            <SectionHeading
              level={4}
              size="sm"
              title="Named units"
              description="Reusable fives for closing rules or the closing five."
            >
              {#snippet actions()}
                <Badge tone={draft.units.length > 0 ? 'primary' : 'neutral'}>
                  {draft.units.length} / {FULL_COURT_MAX_UNITS}
                </Badge>
              {/snippet}
            </SectionHeading>
            {#if draft.units.length === 0}
              <p
                class="mt-3 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
              >
                No named units. Add a unit to save a five you can reuse in a closing rule or copy to
                the closing five.
              </p>
            {:else}
              <ul class="mt-3 grid gap-2">
                {#each draft.units as unit, index (index)}
                  <li class="rounded-lg border border-line-soft bg-surface-1 px-3 py-3">
                    <div class="flex flex-wrap items-end justify-between gap-2">
                      <label class="min-w-0 flex-1">
                        <span class="ui-micro">Unit name</span>
                        <input
                          type="text"
                          class="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                          maxlength={FULL_COURT_UNIT_NAME_MAX_LENGTH}
                          value={unit.name}
                          disabled={locked}
                          oninput={(event) => renameUnit(index, event.currentTarget.value)}
                        />
                      </label>
                      <div class="flex flex-wrap gap-1.5">
                        <Button
                          tone="secondary"
                          type="button"
                          disabled={locked}
                          onclick={() => useUnitAsClosingFive(unit)}
                        >
                          Use as closing five
                        </Button>
                        <Button
                          tone="ghost"
                          type="button"
                          disabled={locked}
                          onclick={() => removeUnit(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                    <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {#each SLOTS as slot (slot)}
                        <label class="min-w-0">
                          <span class="ui-micro">Player {slot + 1}</span>
                          <select
                            class={SELECT_CLASS}
                            value={unit.playerIds[slot] ?? ''}
                            disabled={locked}
                            onchange={(event) =>
                              setUnitPlayer(index, slot, event.currentTarget.value)}
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
                    {#if fullCourtUnitNameForLineup([unit], draft.closingFive ?? []) !== null}
                      <p class="mt-2 text-[11px] font-semibold text-accent">Current closing five</p>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="mt-3">
              <Button
                tone="secondary"
                type="button"
                disabled={locked || draft.units.length >= FULL_COURT_MAX_UNITS}
                onclick={addUnit}
              >
                Add named unit
              </Button>
            </div>
          </Panel>
        {/if}

        {#if mastermind}
          <Panel as="section" padding="sm" aria-label="Coaching rules">
            <SectionHeading
              level={4}
              size="sm"
              title="Rules"
              description="Ordered reactions to the score, clock, and foul trouble."
            />
            <div class="mt-3">
              <FullCourtRuleEditor
                rules={draft.rules}
                {roster}
                units={draft.units}
                {locked}
                onAdd={addRule}
                onUpdate={updateRule}
                onRemove={removeRule}
                onMove={moveRule}
              />
            </div>
          </Panel>
        {/if}
        {#if !mastermind}
          <Panel as="section" padding="sm" aria-label="Game plan summary">
            <SectionHeading
              level={4}
              size="sm"
              title="Game plan"
              description={readOnly
                ? undefined
                : 'Edit scoring roles, lineup groups, and game situations in Mastermind.'}
            />
            <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              {#each HIERARCHY_ROLES as role (role.key)}
                {@const id = draft.hierarchy[role.key]}
                <div>
                  <dt class="text-muted-foreground">{role.label}</dt>
                  <dd class="font-semibold">{id === null ? 'Staff choice' : lineupNames([id])}</dd>
                </div>
              {/each}
              <div>
                <dt class="text-muted-foreground">Star rotation</dt>
                <dd>
                  {draft.staggerStars && hasStaggerScorers
                    ? 'Keep a leading scorer on the floor when possible'
                    : 'Normal substitutions'}
                </dd>
              </div>
            </dl>
            <details class="mt-3 rounded-lg border border-line-soft bg-surface-1 p-3">
              <summary class="cursor-pointer text-sm font-semibold"
                >Lineup groups and game situations</summary
              >
              <ul class="mt-2 grid gap-2 text-sm">
                {#each draft.units as unit, index (index)}
                  <li><strong>{unit.name}</strong> ? {lineupNames(unit.playerIds)}</li>
                {:else}
                  <li class="text-muted-foreground">No saved lineup groups.</li>
                {/each}
                {#each draft.rules as rule (rule.ruleId)}
                  {#if rule.kind === 'closing-lineup'}
                    <li>
                      With {Math.floor(rule.secondsRemainingMax / 60)}:{String(
                        rule.secondsRemainingMax % 60,
                      ).padStart(2, '0')} or less left and the score within {rule.scoreMarginMax} points,
                      use {lineupNames(rule.lineup)}.
                    </li>
                  {:else}
                    <li>
                      At {rule.foulLimit} fouls, replace {lineupNames([rule.playerId])} with {rule.replacementPlayerId ==
                      null
                        ? 'a staff-selected substitute'
                        : lineupNames([rule.replacementPlayerId])}.
                    </li>
                  {/if}
                {:else}
                  <li class="text-muted-foreground">The staff handles in-game adjustments.</li>
                {/each}
              </ul>
            </details>
          </Panel>
        {/if}
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
  </form>

  {#if matchupContext !== null}
    <div class="mt-4">
      <FullCourtDefensiveMatchupsPanel
        context={matchupContext}
        busy={busy || saving}
        readOnly={!mastermind}
        canCustomize={!readOnly && !mastermind}
        {art}
        {onMatchupsChange}
        {onResetMatchups}
      />
    </div>
  {/if}
</div>

<style>
  .save-bar {
    position: sticky;
    top: 0.5rem;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    background: var(--color-surface-1);
  }
  .save-state {
    margin: 0 auto 0 0;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  @media (max-width: 639px) {
    .save-state {
      flex-basis: 100%;
    }
  }
</style>
