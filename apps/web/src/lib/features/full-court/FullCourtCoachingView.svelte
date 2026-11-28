<script lang="ts">
  import type { CapRushSourcePlayer } from '@hoop-rush/data-contracts';
  import { fullCourtLineupFitReport } from '@hoop-rush/engine';
  import type { SaveFullCourtBlueprintOptions } from '@hoop-rush/application/full-court';
  import type {
    FullCourtBlueprint,
    FullCourtCoachingPlan,
    FullCourtCoachingRule,
    FullCourtTactics,
    FullCourtTeamHealth,
    SimulationPlayer,
  } from '@hoop-rush/data-contracts';
  import type { FullCourtBlueprintBindingPreview } from '@hoop-rush/engine';
  import { untrack } from 'svelte';
  import { AlertTriangle, Check } from '@lucide/svelte';
  import ActionRow from '#lib/components/ui/ActionRow.svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import FullCourtBlueprintPicker from './FullCourtBlueprintPicker.svelte';
  import FullCourtCourtLineup from './FullCourtCourtLineup.svelte';
  import FullCourtHierarchyCards from './FullCourtHierarchyCards.svelte';
  import FullCourtMinutesBoard from './FullCourtMinutesBoard.svelte';
  import FullCourtRotationLadder from './FullCourtRotationLadder.svelte';
  import FullCourtRuleEditor from './FullCourtRuleEditor.svelte';
  import FullCourtUnitPlanner from './FullCourtUnitPlanner.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import {
    FULL_COURT_MAX_PLAYER_MINUTES,
    FULL_COURT_MAX_UNITS,
    FULL_COURT_MINUTE_TOTAL,
    FULL_COURT_UNIT_MINUTE_BUDGET,
    activeRotationForBlueprint,
    applyFullCourtBlueprintToDraft,
    defaultFullCourtCoachingDraft,
    historicalThreePointShare,
    rebalanceFullCourtMinuteTargets,
    fullCourtCoachingDraft,
    fullCourtCoachingPlan,
    fullCourtCoachingSignature,
    fullCourtTeamMinutes,
    newFullCourtClosingRule,
    newFullCourtFoulTroubleRule,
    nextFullCourtRuleId,
    validateFullCourtCoachingDraft,
    type FullCourtCoachingDraft,
    type FullCourtNamedUnitDraft,
    type FullCourtOffensiveHierarchyDraft,
    type FullCourtRotationMode,
  } from './full-court-coaching-presenter.ts';

  import { LINEUP_FINDING_LABELS } from './full-court-scout-labels';

  let {
    roster,
    defaultRotation,
    scoutedRoster = null,
    plan,
    busy,
    onSave,
    onDirtyChange,
    workspace = $bindable('plan'),
    onListBlueprints,
    onSaveBlueprint,
    onRemoveBlueprint,
    readOnly = false,
    opponent = null,
    leagueThreePointShare = null,
    health = null,
    dayOffset = null,
    art = null,
  }: {
    roster: readonly SimulationPlayer[];
    scoutedRoster?: readonly CapRushSourcePlayer[] | null;
    defaultRotation: NonNullable<FullCourtCoachingPlan['rotation']>;
    plan: FullCourtCoachingPlan;
    busy: boolean;
    onSave: (plan: FullCourtCoachingPlan) => Promise<boolean>;
    onDirtyChange?: (dirty: boolean) => void;
    workspace?: (typeof WORKSPACES)[number]['id'];
    onListBlueprints?: () => Promise<FullCourtBlueprint[]>;
    onSaveBlueprint?: (
      name: string,
      tactics: FullCourtTactics,
      options?: SaveFullCourtBlueprintOptions,
    ) => Promise<FullCourtBlueprint>;
    onRemoveBlueprint?: (name: string) => Promise<void>;
    readOnly?: boolean;
    leagueThreePointShare?: number | null;
    opponent?: { displayName: string; roster: readonly SimulationPlayer[] } | null;
    health?: FullCourtTeamHealth | null;
    dayOffset?: number | null;
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
  ] as const satisfies readonly { value: FullCourtTactics['offense']; label: string }[];
  const DEFENSE_OPTIONS = [
    { value: 'balanced', label: 'Balanced' },
    { value: 'pressure', label: 'Pressure' },
    { value: 'protect-paint', label: 'Protect paint' },
  ] as const satisfies readonly { value: FullCourtTactics['defense']; label: string }[];
  const ROTATION_OPTIONS = [
    { value: 'automatic', label: 'Staff plan' },
    { value: 'custom', label: 'My plan' },
  ] as const satisfies readonly { value: FullCourtRotationMode; label: string }[];
  const HIERARCHY_ROLES = [
    {
      key: 'primaryPlayerId',
      label: 'Primary option',
      hint: 'Gets the strongest boost to scoring opportunities.',
    },
    {
      key: 'secondaryPlayerId',
      label: 'Second option',
      hint: 'Takes a moderate share behind the primary option.',
    },
    {
      key: 'floorGeneralPlayerId',
      label: 'Floor general',
      hint: 'Starts more possessions and looks to pass. Can also be a scoring option.',
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
  let lockedMinutes = $state<string[]>([]);
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
      lockedMinutes = [];
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
  $effect(() => {
    const edited = dirty;
    const notify = onDirtyChange;
    untrack(() => notify?.(edited));
  });
  const saveLabel = $derived(saving ? 'Saving…' : dirty ? 'Save plan' : 'Saved');
  const minuteGroups = $derived([
    { label: 'Starters', rows: minutes.starters, total: minutes.starterMinutes },
    { label: 'Bench', rows: minutes.bench, total: minutes.benchMinutes },
  ]);
  const blueprintRotation = $derived(activeRotationForBlueprint(draft, defaultRotation));
  const playerNames = $derived(
    new Map<string, string>(roster.map((player) => [player.playerId, player.displayName])),
  );
  const lineupNames = (ids: readonly string[]) =>
    ids.map((id) => playerNames.get(id) ?? 'Unavailable player').join(', ');
  const hasStaggerScorers = $derived(
    draft.hierarchy.primaryPlayerId !== null || draft.hierarchy.secondaryPlayerId !== null,
  );
  const rotationRows = $derived([
    ...minutes.starters,
    ...minutes.bench.filter((row) => row.minutes > 0),
  ]);
  const unavailableRotation = $derived(
    rotationRows.filter((row) => row.health?.tone === 'unavailable'),
  );
  const fatiguedRotation = $derived(rotationRows.filter((row) => row.health?.tone === 'fatigued'));
  const playersUsed = $derived(
    minutes.starters.length + minutes.bench.filter((row) => row.minutes > 0).length,
  );
  const styleSummary = $derived(
    `${labelFor(PACE_OPTIONS, draft.tactics.pace)} · ${
      draft.tactics.offense === 'ball-movement'
        ? 'Ball movement'
        : labelFor(OFFENSE_OPTIONS, draft.tactics.offense)
    } · ${labelFor(DEFENSE_OPTIONS, draft.tactics.defense)}`,
  );
  const opponentThreePointShare = $derived(
    opponent === null ? null : historicalThreePointShare(opponent.roster),
  );
  const opponentThreePointRead = $derived(
    opponentThreePointShare === null || leagueThreePointShare === null
      ? null
      : Math.round(opponentThreePointShare) - Math.round(leagueThreePointShare),
  );
  const hasHealthData = $derived(rotationRows.some((row) => row.health !== null));
  const availabilityHeadline = $derived(
    unavailableRotation.length > 0
      ? `${String(unavailableRotation.length)} unavailable`
      : fatiguedRotation.length > 0
        ? `${String(fatiguedRotation.length)} heavy load`
        : hasHealthData
          ? 'All available'
          : 'No health flags',
  );
  const availabilityNote = $derived(
    unavailableRotation.length > 0
      ? unavailableRotation.map((row) => row.player.displayName).join(', ')
      : fatiguedRotation.length > 0
        ? 'Manage minutes or rest them on game day.'
        : hasHealthData
          ? 'Rotation cleared to play.'
          : 'Availability appears once the season starts.',
  );
  const minutesGap = $derived(FULL_COURT_MINUTE_TOTAL - displayedMinutes);
  const lockedMinuteSet = $derived(new Set(lockedMinutes));
  const hierarchyRolesSet = $derived(
    [
      draft.hierarchy.primaryPlayerId,
      draft.hierarchy.secondaryPlayerId,
      draft.hierarchy.floorGeneralPlayerId,
    ].filter((playerId): playerId is string => playerId !== null).length,
  );
  const planPulse = $derived([
    {
      label: `${String(displayedMinutes)} / ${String(FULL_COURT_MINUTE_TOTAL)} min`,
      tone:
        displayedMinutes === FULL_COURT_MINUTE_TOTAL
          ? ('positive' as const)
          : displayedMinutes > FULL_COURT_MINUTE_TOTAL
            ? ('negative' as const)
            : ('accent' as const),
    },
    { label: `${String(hierarchyRolesSet)} roles`, tone: 'neutral' as const },
    { label: `${String(draft.units.length)} units`, tone: 'neutral' as const },
  ]);
  const planCheckHeadline = $derived(
    validation.valid
      ? 'Ready'
      : `${String(validation.errors.length)} ${validation.errors.length === 1 ? 'issue' : 'issues'}`,
  );
  function labelFor<T extends string>(
    options: readonly { value: T; label: string }[],
    value: T,
  ): string {
    return options.find((option) => option.value === value)?.label ?? value;
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

  function setMinutes(playerId: string, minutes: number): void {
    const next = Number.isFinite(minutes)
      ? Math.max(0, Math.min(FULL_COURT_MAX_PLAYER_MINUTES, Math.round(minutes)))
      : 0;
    draft.minuteTargets[playerId] = next;
    lastMinutesEdit = playerId;
    markEdited();
  }

  function sitPlayer(playerId: string): void {
    setMinutes(playerId, 0);
    lockedMinutes = lockedMinutes.filter((id) => id !== playerId);
    announcement = `${playerNames.get(playerId) ?? 'Player'} moved out of the rotation. Save changes to use it.`;
  }

  function toggleMinuteLock(playerId: string): void {
    lockedMinutes = lockedMinuteSet.has(playerId)
      ? lockedMinutes.filter((id) => id !== playerId)
      : [...lockedMinutes, playerId];
  }

  function rebalanceMinutes(): void {
    draft.minuteTargets = rebalanceFullCourtMinuteTargets(
      draft,
      rosterIds,
      defaultRotation.minuteTargets,
      lastMinutesEdit,
      lockedMinuteSet,
    );
    lastMinutesEdit = null;
    markEdited();
    announcement = 'Rotation minutes rebalanced.';
  }

  function setUnitMinutes(index: number, minutes: number): void {
    const unit = draft.units[index];
    if (unit === undefined) return;
    const next = Number.isFinite(minutes)
      ? Math.max(0, Math.min(FULL_COURT_UNIT_MINUTE_BUDGET, Math.round(minutes)))
      : 0;
    if (next === 0) delete unit.plannedMinutes;
    else unit.plannedMinutes = next;
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
      const roles = unitRoles(unit);
      if (roles && !playerIds.every((id) => unit.playerIds.includes(id))) {
        draft.unitRoles = (draft.unitRoles ?? []).filter((entry) => entry !== roles);
        if (!unitRoles({ ...unit, playerIds })) {
          const primary = roles.primaryPlayerId;
          const initiator = roles.floorGeneralPlayerId;
          const next = {
            playerIds,
            ...(primary && playerIds.includes(primary) ? { primaryPlayerId: primary } : {}),
            ...(initiator && playerIds.includes(initiator)
              ? { floorGeneralPlayerId: initiator }
              : {}),
          };
          if (next.primaryPlayerId || next.floorGeneralPlayerId) draft.unitRoles.push(next);
        }
      }
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

  function setHierarchyRole(
    role: keyof FullCourtOffensiveHierarchyDraft,
    playerId: string | null,
  ): void {
    draft.hierarchy[role] = playerId === null || playerId === '' ? null : playerId;
    markEdited();
  }

  const WORKSPACES = [
    { id: 'plan', label: 'Game Plan' },
    { id: 'rotation', label: 'Rotation' },
    { id: 'situations', label: 'Game Situations' },
  ] as const;
  let lastMinutesEdit: string | null = null;
  let readHandler = $state('');
  const starterStrengths = $derived(
    scoutedRoster === null
      ? []
      : fullCourtLineupFitReport(
          scoutedRoster.filter((player) => draft.startingFive.includes(player.playerId)),
        ).strengths,
  );
  const reads = $derived(draft.passingReads?.[readHandler] ?? []);

  function setRead(slot: number, target: string): void {
    const next = [...reads];
    if (target === '') next.splice(slot, 1);
    else next[slot] = target;
    draft.passingReads ??= {};
    if (next.length === 0) delete draft.passingReads[readHandler];
    else draft.passingReads[readHandler] = next;
    markEdited();
  }

  function unitRoles(unit: FullCourtNamedUnitDraft) {
    return draft.unitRoles?.find((entry) =>
      entry.playerIds.every((id) => unit.playerIds.includes(id)),
    );
  }

  function setUnitRole(
    unit: FullCourtNamedUnitDraft,
    role: 'primaryPlayerId' | 'floorGeneralPlayerId',
    playerId: string,
  ): void {
    const current = unitRoles(unit);
    const next = { ...current, playerIds: [...unit.playerIds] };
    if (playerId === '') delete next[role];
    else next[role] = playerId;
    draft.unitRoles = (draft.unitRoles ?? []).filter((entry) => entry !== current);
    if (next.primaryPlayerId || next.floorGeneralPlayerId) draft.unitRoles.push(next);
    markEdited();
  }

  function toggleClosingFive(enabled: boolean): void {
    draft.closingFive = enabled ? [...draft.startingFive] : null;
    markEdited();
  }

  function cancel(): void {
    draft = fullCourtCoachingDraft(plan, defaultRotation, rosterIds);
    savedSignature = fullCourtCoachingSignature(plan);
    saveError = null;
    savedMessage = null;
    announcement = 'Changes discarded.';
  }

  function reset(): void {
    const level = draft.interfaceLevel;
    draft = defaultFullCourtCoachingDraft(defaultRotation, rosterIds);
    draft.interfaceLevel = level;
    savedSignature = fullCourtCoachingSignature(plan);
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

<div class="coaching-view min-w-0 p-3 sm:p-5">
  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
    novalidate
  >
    {#if !readOnly}
      <div class="save-bar mb-3 rounded-lg border border-line-soft px-3 py-2" class:dirty>
        <p class="save-state" aria-live="polite">
          {#if dirty}
            Unsaved changes — save to use them next game.
          {:else}
            Saved plan is active from your next game.
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
            <Button tone="secondary" disabled={locked || !dirty} onclick={cancel}
              >Discard changes</Button
            >
          {/snippet}
          {#snippet tertiary()}
            <Button tone="ghost" disabled={locked} onclick={reset}>Reset to staff plan</Button>
          {/snippet}
        </ActionRow>
      </div>
    {/if}
    {#if saveError !== null}
      <Alert tone="danger" class="mb-3">{saveError}</Alert>
    {/if}
    {#if savedMessage !== null}
      <p class="mb-3 text-xs font-semibold text-positive" role="status">{savedMessage}</p>
    {/if}
    <header class="board-header">
      <div>
        <h3>Coaching Board</h3>
        <p>
          {readOnly
            ? 'The plan used for this run.'
            : opponent === null
              ? 'Season game plan'
              : `Next game vs. ${opponent.displayName}`}
        </p>
      </div>
      <div class="plan-pulse" aria-label="Plan summary">
        {#if !readOnly}
          {#each planPulse as pulse (pulse.label)}
            <Badge tone={pulse.tone}>{pulse.label}</Badge>
          {/each}
        {/if}
        <Badge tone={validation.valid ? 'positive' : 'negative'}>
          {validation.valid ? 'Ready' : planCheckHeadline}
        </Badge>
      </div>
    </header>
    {#if minutes.starters.length > 0}
      <div
        class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-line-soft bg-surface-1 px-3 py-2"
      >
        <span class="ui-label"
          >{editingRotation ? 'Custom starting five' : 'Staff starting five'}</span
        >
        <span class="text-xs"
          >{lineupNames(minutes.starters.map((row) => row.player.playerId))}</span
        >
      </div>
    {/if}
    <nav class="workspace-nav" aria-label="Coaching workspace">
      {#each WORKSPACES as item (item.id)}
        <button
          type="button"
          aria-current={workspace === item.id ? 'true' : undefined}
          onclick={() => (workspace = item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>

    <fieldset class="m-0 min-w-0 border-0 p-0" disabled={locked}>
      <legend class="sr-only">Coaching plan</legend>
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

      <div class="workspace-content" hidden={workspace !== 'plan'}>
        <div class="plan-grid" class:read-only={readOnly}>
          {#if !readOnly}
            <Panel as="section" padding="sm" aria-label="Strategy presets">
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
            </Panel>
          {/if}
          <Panel as="section" padding="sm" aria-label="Style">
            <SectionHeading level={4} size="sm" title="Team tactics" description={styleSummary} />
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
                <span class="text-sm font-semibold">Shot emphasis</span>
                <SegmentedControl
                  label="Shot emphasis"
                  value={draft.tactics.offense === 'ball-movement'
                    ? 'balanced'
                    : draft.tactics.offense}
                  options={OFFENSE_OPTIONS.map((option) => ({ ...option, disabled: locked }))}
                  onchange={(value) => {
                    if (draft.tactics.offense === 'ball-movement')
                      draft.tactics.ballMovement = true;
                    draft.tactics.offense = value;
                    markEdited();
                  }}
                />
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="flex items-start gap-2">
                  <input
                    type="checkbox"
                    class="mt-1 accent-primary"
                    disabled={locked}
                    checked={draft.tactics.ballMovement === true ||
                      draft.tactics.offense === 'ball-movement'}
                    onchange={(event) => {
                      if (draft.tactics.offense === 'ball-movement')
                        draft.tactics.offense = 'balanced';
                      if (event.currentTarget.checked) draft.tactics.ballMovement = true;
                      else delete draft.tactics.ballMovement;
                      markEdited();
                    }}
                  />
                  <span>
                    <span class="block text-sm font-semibold">Move the ball</span>
                    <span class="text-xs text-muted-foreground"
                      >More passing and assists, with more turnover risk.</span
                    >
                  </span>
                </label>
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
            <p class="mt-2 text-xs text-muted-foreground">
              {draft.tactics.defense === 'pressure'
                ? 'Force more steals at the cost of energy and defensive rebounds.'
                : draft.tactics.defense === 'protect-paint'
                  ? 'Give up more outside shots to protect the rim and secure rebounds.'
                  : 'Use each player’s usual defensive tendencies.'}
            </p>
            {#if !readOnly && opponent !== null && opponentThreePointShare !== null}
              <p class="mt-1 text-xs text-muted-foreground">
                {opponent.displayName} &middot; {Math.round(opponentThreePointShare)}% historical
                three-point share
                {#if opponentThreePointRead !== null}
                  {#if opponentThreePointRead === 0}
                    &middot; matches the league average
                  {:else}
                    &middot; {Math.abs(opponentThreePointRead)} pts
                    {opponentThreePointRead > 0 ? 'above' : 'below'} the league average
                  {/if}
                {/if}
              </p>
            {/if}
          </Panel>
        </div>
        {#if !readOnly}
          <Panel as="section" padding="sm" aria-label="Offensive roles">
            <SectionHeading
              level={4}
              size="sm"
              title="Scoring hierarchy"
              description="Choose who the offense plays through, in order."
            />
            <FullCourtHierarchyCards
              hierarchy={draft.hierarchy}
              {roster}
              {art}
              {locked}
              onChange={setHierarchyRole}
            />
          </Panel>
        {/if}
        {#if !readOnly}
          <Panel as="section" padding="sm" aria-label="Offensive roles">
            <SectionHeading level={4} size="sm" title="Playmaking" />
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <label class="grid gap-1">
                <span class="text-sm font-semibold">Ball handler</span>
                <select class={SELECT_CLASS} disabled={locked} bind:value={readHandler}>
                  <option value="">Choose a player</option>
                  {#each roster as player (player.playerId)}
                    <option value={player.playerId}>{player.displayName}</option>
                  {/each}
                </select>
              </label>
              {#each [0, 1] as slot (slot)}
                <label class="grid gap-1">
                  <span class="text-sm font-semibold"
                    >{slot === 0 ? 'Top passing target' : 'Second passing target'}</span
                  >
                  <select
                    class={SELECT_CLASS}
                    disabled={locked || readHandler === '' || (slot === 1 && reads.length === 0)}
                    value={reads[slot] ?? ''}
                    onchange={(event) => setRead(slot, event.currentTarget.value)}
                  >
                    <option value="">Use player tendencies</option>
                    {#each roster as player (player.playerId)}
                      {#if player.playerId !== readHandler && player.playerId !== reads[1 - slot]}
                        <option value={player.playerId}>{player.displayName}</option>
                      {/if}
                    {/each}
                  </select>
                </label>
              {/each}
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              The top target gets the strongest preference. Players still follow their tendencies.
            </p>
            {#each draft.units as unit, index (index)}
              <fieldset class="mt-4 grid gap-2 md:grid-cols-2">
                <legend class="text-sm font-semibold">{unit.name}</legend>
                {#if scoutedRoster !== null}
                  {@const strengths = fullCourtLineupFitReport(
                    scoutedRoster.filter((player) => unit.playerIds.includes(player.playerId)),
                  ).strengths}
                  {#if strengths.length}
                    <p class="text-xs text-muted-foreground md:col-span-2">
                      {strengths.map((strength) => LINEUP_FINDING_LABELS[strength.code]).join(', ')}
                    </p>
                  {/if}
                {/if}
                {#each ['floorGeneralPlayerId', 'primaryPlayerId'] as role (role)}
                  {@const key =
                    role === 'primaryPlayerId' ? 'primaryPlayerId' : 'floorGeneralPlayerId'}
                  <label class="grid gap-1">
                    <span class="text-xs"
                      >{key === 'primaryPlayerId' ? 'Scoring priority' : 'Initiator'}</span
                    >
                    <select
                      class={SELECT_CLASS}
                      disabled={locked}
                      value={unitRoles(unit)?.[key] ?? ''}
                      onchange={(event) => setUnitRole(unit, key, event.currentTarget.value)}
                    >
                      <option value="">Use team role</option>
                      {#each unit.playerIds as id (id)}
                        <option value={id}>{playerNames.get(id)}</option>
                      {/each}
                    </select>
                  </label>
                {/each}
              </fieldset>
            {/each}
            <div class="mt-4 rounded-lg border border-line-soft bg-surface-1 px-3 py-2.5"></div>
          </Panel>
        {/if}
      </div>
      <div class="workspace-content" hidden={workspace !== 'rotation'}>
        {#if !readOnly && editingRotation && minutesGap !== 0}
          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2"
          >
            <p class="text-xs font-semibold text-accent">
              {minutesGap > 0
                ? `Add ${String(minutesGap)} more ${minutesGap === 1 ? 'minute' : 'minutes'} to reach ${String(FULL_COURT_MINUTE_TOTAL)}.`
                : `Remove ${String(Math.abs(minutesGap))} ${Math.abs(minutesGap) === 1 ? 'minute' : 'minutes'} to reach ${String(FULL_COURT_MINUTE_TOTAL)}.`}
            </p>
            <Button
              size="sm"
              tone="secondary"
              disabled={locked}
              onclick={() => {
                rebalanceMinutes();
              }}
            >
              Rebalance minutes
            </Button>
          </div>
        {/if}

        <Panel as="section" padding="sm" aria-label="Lineup and minutes">
          <SectionHeading level={4} size="sm" title="Lineup and minutes">
            {#snippet actions()}
              {#if readOnly}
                <Badge tone={editingRotation ? 'primary' : 'neutral'}>
                  {editingRotation ? 'My plan' : 'Staff plan'}
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

          <div class="rotation-brief">
            <div>
              <strong>{playersUsed} players</strong>
              <span>{displayedMinutes} planned minutes</span>
            </div>
            <div>
              <strong
                >{rotationRows.filter((row) => row.minutes >= 40).length} heavy-minute players</strong
              >
              <span>40 or more planned minutes</span>
            </div>
            <div>
              <strong>{availabilityHeadline}</strong>
              <span>{availabilityNote}</span>
            </div>
          </div>

          {#if !readOnly}
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
          {/if}
          {#if starterStrengths.length > 0}
            <div class="mt-3 flex flex-wrap gap-1.5" aria-label="Starting five strengths">
              {#each starterStrengths as strength (strength.code)}
                <Badge tone="neutral">
                  Starting five · {LINEUP_FINDING_LABELS[strength.code]}
                </Badge>
              {/each}
            </div>
          {/if}

          <div class="rotation-room">
            <section class="rotation-room-column" aria-label="Starting five">
              <div class="rotation-room-head">
                <p class="ui-label">Starting five</p>
                <p class="ui-micro">Tap a court slot to swap</p>
              </div>
              <FullCourtCourtLineup
                starters={minutes.starters}
                bench={minutes.bench}
                {roster}
                {art}
                locked={locked || !editingRotation}
                onSelectStarter={setStarter}
              />
            </section>

            <section class="rotation-room-column" aria-label="Rotation share">
              <div class="rotation-room-head">
                <p class="ui-label">Rotation share</p>
                <p class="ui-micro">0–48 minutes</p>
              </div>
              <FullCourtRotationLadder rows={rotationRows} {art} />
            </section>
          </div>

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
                      lockedMinutes = [];
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
            {#if !editingRotation && !readOnly}
              <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
                The staff plan is active. Switch to <strong>My plan</strong> to edit starters, minutes,
                and the closing five.
              </p>
            {/if}
            <FullCourtMinutesBoard
              groups={minuteGroups}
              summary={minutesSummary()}
              {displayedMinutes}
              locked={locked || !editingRotation}
              readOnly={readOnly || !editingRotation}
              lockedIds={lockedMinutes}
              {art}
              onMinutes={setMinutes}
              onToggleLock={toggleMinuteLock}
              onSit={sitPlayer}
            />
          </div>

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
      </div>
      <div class="workspace-content" hidden={workspace !== 'situations'}>
        {#if !readOnly}
          <Panel as="section" padding="sm" aria-label="Named units">
            <SectionHeading level={4} size="sm" title="Lineup groups">
              {#snippet actions()}
                <Badge tone="neutral">{draft.units.length} / {FULL_COURT_MAX_UNITS}</Badge>
              {/snippet}
            </SectionHeading>
            <p class="mt-2 text-xs text-muted-foreground">
              Plan up to 12 minutes across units at the start of the second quarter, in the order
              shown. Fatigue, availability, and substitution rules can shorten their time.
            </p>
            <div class="mt-3">
              <FullCourtUnitPlanner
                units={draft.units}
                {roster}
                closingFive={draft.closingFive}
                {art}
                {locked}
                onAdd={addUnit}
                onRemove={removeUnit}
                onRename={renameUnit}
                onMinutes={setUnitMinutes}
                onPlayer={setUnitPlayer}
                onUseAsClosingFive={useUnitAsClosingFive}
              />
            </div>
          </Panel>
        {/if}
        {#if !readOnly}
          <Panel as="section" padding="sm" aria-label="Coaching rules">
            <SectionHeading level={4} size="sm" title="Automatic substitutions">
              {#snippet actions()}
                <Badge tone="neutral">{draft.rules.length} configured</Badge>
              {/snippet}
            </SectionHeading>
            <p class="mt-2 text-xs text-muted-foreground">
              Rules run in priority order and respond to the score, clock, or foul trouble.
            </p>

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
        {#if readOnly}
          <Panel as="section" padding="sm" aria-label="Saved situations and roles">
            <SectionHeading level={4} size="sm" title="Game plan" />
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
    </fieldset>
  </form>
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
  .board-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.1rem 1.25rem;
    border: 1px solid var(--color-line-soft);
    border-inline-start: 3px solid var(--color-accent);
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }
  .board-header h3 {
    font: 800 clamp(1.5rem, 4vw, 2.25rem) / 1 var(--font-display);
  }
  .board-header p {
    margin-top: 0.4rem;
    font-size: 0.875rem;
    color: var(--color-muted-foreground);
  }
  .plan-pulse {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.3rem;
    max-width: 30rem;
  }
  .rotation-room {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.85rem;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 900px) {
    .rotation-room {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    }
  }
  .rotation-room-column {
    min-width: 0;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.8rem;
    background: var(--color-surface-1);
  }
  .rotation-room-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .workspace-nav {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: 0.75rem 0 0;
    border-bottom: 1px solid var(--color-line-soft);
  }
  .workspace-nav button {
    min-height: 2.75rem;
    padding: 0.5rem 0.375rem;
    border-bottom: 2px solid transparent;
    color: var(--color-muted-foreground);
    font-size: 0.875rem;
    font-weight: 700;
    cursor: pointer;
  }
  .workspace-nav button:hover,
  .workspace-nav button[aria-current='true'] {
    color: var(--color-foreground);
  }
  .workspace-nav button[aria-current='true'] {
    border-bottom-color: var(--color-accent);
  }
  .workspace-content:not([hidden]) {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .plan-grid {
    display: grid;
    align-items: start;
    gap: 0.75rem;
  }
  @media (min-width: 960px) {
    .plan-grid:not(.read-only) {
      grid-template-columns: minmax(15rem, 2fr) minmax(0, 3fr);
    }
  }
  .rotation-brief {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 0.5rem;
    margin-block: 0.75rem;
  }
  .rotation-brief div {
    display: grid;
    gap: 0.2rem;
    padding: 0.65rem 0.75rem;
    border-inline-start: 2px solid var(--color-line-soft);
    background: var(--color-surface-1);
  }
  .rotation-brief span {
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
  }
  @media (max-width: 639px) {
    .save-bar:not(.dirty) {
      position: static;
    }
    .save-state {
      flex-basis: 100%;
    }
    .coaching-view :global(.ui-segmented button),
    summary {
      min-height: 2.75rem;
    }
    summary {
      align-content: center;
    }
  }
</style>
