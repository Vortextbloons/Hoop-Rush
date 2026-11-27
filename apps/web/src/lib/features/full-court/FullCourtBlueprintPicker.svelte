<script lang="ts">
  import {
    FULL_COURT_HISTORICAL_PRESETS,
    type SaveFullCourtBlueprintOptions,
  } from '@hoop-rush/application/full-court';
  import {
    FULL_COURT_BLUEPRINT_MAX_NAME_LENGTH,
    FULL_COURT_BLUEPRINT_ROLE_KEYS,
    fullCourtBlueprintNameKey,
    fullCourtBlueprintNameSchema,
    type FullCourtBlueprint,
    type FullCourtBlueprintHierarchy,
    type FullCourtBlueprintRoleKey,
    type FullCourtBlueprintRoleRef,
    type FullCourtTactics,
    type SimulationPlayer,
  } from '@hoop-rush/data-contracts';
  import {
    buildFullCourtBlueprintHierarchy,
    resolveFullCourtBlueprintHierarchy,
    type FullCourtBlueprintBindingPreview,
    type FullCourtBlueprintRoleBindingStatus,
    type FullCourtBlueprintRotationRef,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import Alert from '#lib/components/ui/Alert.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import type { BadgeTone } from '#lib/components/ui/types.js';
  import { formatPositions, SLOT_LABELS } from '#lib/player-positions.js';
  import {
    fullCourtOffensiveHierarchy,
    type FullCourtOffensiveHierarchyDraft,
  } from './full-court-coaching-presenter.ts';

  const CONTROL_CLASS =
    'min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const DEFAULT_PRESET_KEY = `historical:${FULL_COURT_HISTORICAL_PRESETS[0].id}`;

  const PACE_LABELS: Record<FullCourtTactics['pace'], string> = {
    slow: 'Slow',
    balanced: 'Balanced',
    fast: 'Fast',
  };
  const OFFENSE_LABELS: Record<FullCourtTactics['offense'], string> = {
    balanced: 'Balanced',
    perimeter: 'Perimeter',
    interior: 'Interior',
    'ball-movement': 'Ball movement',
  };
  const DEFENSE_LABELS: Record<FullCourtTactics['defense'], string> = {
    balanced: 'Balanced',
    pressure: 'Pressure',
    'protect-paint': 'Protect paint',
  };
  const ROLE_LABELS: Record<FullCourtBlueprintRoleKey, string> = {
    primary: 'Primary option',
    secondary: 'Second option',
    floorGeneral: 'Floor general',
  };
  const STATUS_LABELS: Record<FullCourtBlueprintRoleBindingStatus, string> = {
    matched: 'Matched',
    fallback: 'Fallback',
    ambiguous: 'Ambiguous',
    vacant: 'Vacant',
  };
  const STATUS_TONES: Record<FullCourtBlueprintRoleBindingStatus, BadgeTone> = {
    matched: 'positive',
    fallback: 'accent',
    ambiguous: 'accent',
    vacant: 'negative',
  };

  let {
    tactics,
    roster = undefined,
    rotation = undefined,
    hierarchy = undefined,
    disabled = false,
    onApplyTactics,
    onApplyBlueprint = undefined,
    onListBlueprints,
    onSaveBlueprint,
    onRemoveBlueprint,
  }: {
    tactics: FullCourtTactics;
    roster?: readonly SimulationPlayer[];
    rotation?: FullCourtBlueprintRotationRef;
    hierarchy?: FullCourtOffensiveHierarchyDraft;
    disabled?: boolean;
    onApplyTactics: (tactics: FullCourtTactics, label: string) => void;
    onApplyBlueprint?: (
      blueprint: FullCourtBlueprint,
      preview: FullCourtBlueprintBindingPreview,
    ) => void;
    onListBlueprints?: () => Promise<FullCourtBlueprint[]>;
    onSaveBlueprint?: (
      name: string,
      tactics: FullCourtTactics,
      options?: SaveFullCourtBlueprintOptions,
    ) => Promise<FullCourtBlueprint>;
    onRemoveBlueprint?: (name: string) => Promise<void>;
  } = $props();

  let blueprints = $state.raw<FullCourtBlueprint[]>([]);
  let selectedKey = $state(DEFAULT_PRESET_KEY);
  let blueprintName = $state('');
  let includeRoles = $state(true);
  let libraryLoading = $state(false);
  let libraryBusy = $state(false);
  let libraryError = $state<string | null>(null);
  let libraryMessage = $state<string | null>(null);
  let confirmingRemoveName = $state<string | null>(null);
  let mounted = false;

  const selectedHistorical = $derived(
    selectedKey.startsWith('historical:')
      ? (FULL_COURT_HISTORICAL_PRESETS.find(
          (preset) => preset.id === selectedKey.slice('historical:'.length),
        ) ?? null)
      : null,
  );
  const selectedBlueprint = $derived(
    selectedKey.startsWith('blueprint:')
      ? (blueprints.find((item) => item.name === selectedKey.slice('blueprint:'.length)) ?? null)
      : null,
  );
  const selectedPreview = $derived.by((): FullCourtBlueprintBindingPreview | null => {
    if (
      selectedBlueprint === null ||
      selectedBlueprint.hierarchy === undefined ||
      roster === undefined ||
      roster.length < 5
    ) {
      return null;
    }
    return resolveFullCourtBlueprintHierarchy({
      blueprint: selectedBlueprint,
      roster,
      rotation,
    });
  });
  const draftBlueprintHierarchy = $derived.by((): FullCourtBlueprintHierarchy | undefined => {
    if (hierarchy === undefined || roster === undefined || roster.length < 5) return undefined;
    const contractHierarchy = fullCourtOffensiveHierarchy(hierarchy);
    if (contractHierarchy === undefined) return undefined;
    const rosterIds = new Set<string>(roster.map((player) => player.playerId));
    const assigned = [
      contractHierarchy.primaryPlayerId,
      contractHierarchy.secondaryPlayerId,
      contractHierarchy.floorGeneralPlayerId,
    ].filter((id): id is string => id !== undefined);
    if (
      assigned.length === 0 ||
      new Set(assigned).size !== assigned.length ||
      assigned.some((id) => !rosterIds.has(id))
    ) {
      return undefined;
    }
    return buildFullCourtBlueprintHierarchy({
      hierarchy: contractHierarchy,
      roster,
      rotation,
    });
  });
  const parsedName = $derived(fullCourtBlueprintNameSchema.safeParse(blueprintName));
  const normalizedKey = $derived(fullCourtBlueprintNameKey(blueprintName));
  const duplicateName = $derived(
    normalizedKey.length > 0 &&
      blueprints.some((item) => fullCourtBlueprintNameKey(item.name) === normalizedKey),
  );
  const hasSavedLibrary = $derived(
    onListBlueprints !== undefined ||
      onSaveBlueprint !== undefined ||
      onRemoveBlueprint !== undefined,
  );

  function formatTacticsSummary(value: FullCourtTactics): string {
    return `${PACE_LABELS[value.pace]} pace · ${OFFENSE_LABELS[value.offense]} offense · ${DEFENSE_LABELS[value.defense]} defense`;
  }

  function formatPortableRef(ref: FullCourtBlueprintRoleRef): string {
    if (ref.kind === 'starter-slot') {
      const slotPos = SLOT_LABELS[ref.slot] ?? '';
      return `Starter ${String(ref.slot + 1)}${slotPos === '' ? '' : ` (${slotPos})`}`;
    }
    if (ref.kind === 'bench-slot') {
      return `Bench ${String(ref.benchIndex + 1)}`;
    }
    return ref.preferredPositions === undefined
      ? 'Role fit'
      : `Role fit (${formatPositions(ref.preferredPositions)})`;
  }

  function summarizeDraftHierarchy(value: FullCourtBlueprintHierarchy): string {
    const parts: string[] = [];
    for (const key of FULL_COURT_BLUEPRINT_ROLE_KEYS) {
      const ref = value[key];
      if (ref === undefined) continue;
      parts.push(`${ROLE_LABELS[key]}: ${formatPortableRef(ref)}`);
    }
    return parts.join(' · ');
  }

  async function loadBlueprints(): Promise<void> {
    if (onListBlueprints === undefined) return;
    libraryLoading = true;
    libraryError = null;
    try {
      const loaded = await onListBlueprints();
      if (!mounted) return;
      blueprints = loaded;
    } catch (error) {
      if (!mounted) return;
      libraryError =
        error instanceof Error ? error.message : 'Saved strategies could not be loaded.';
    } finally {
      if (mounted) {
        libraryLoading = false;
      }
    }
  }

  onMount(() => {
    mounted = true;
    if (onListBlueprints !== undefined) {
      void loadBlueprints();
    }
    return () => {
      mounted = false;
    };
  });

  function selectPreset(nextKey: string): void {
    selectedKey = nextKey;
    confirmingRemoveName = null;
    libraryError = null;
    libraryMessage = null;
  }

  function applySelected(): void {
    if (disabled || libraryBusy) return;
    if (selectedHistorical !== null) {
      onApplyTactics({ ...selectedHistorical.tactics }, selectedHistorical.name);
      confirmingRemoveName = null;
      libraryError = null;
      libraryMessage = null;
      return;
    }
    if (selectedBlueprint !== null) {
      if (onApplyBlueprint !== undefined && selectedPreview !== null) {
        onApplyBlueprint(selectedBlueprint, selectedPreview);
      } else {
        onApplyTactics({ ...selectedBlueprint.tactics }, selectedBlueprint.name);
      }
      confirmingRemoveName = null;
      libraryError = null;
      libraryMessage = null;
    }
  }

  async function saveBlueprint(): Promise<void> {
    if (onSaveBlueprint === undefined || disabled || libraryBusy || libraryLoading) return;
    if (!parsedName.success || duplicateName) return;

    libraryBusy = true;
    libraryError = null;
    libraryMessage = null;
    confirmingRemoveName = null;
    try {
      const savedHierarchy = includeRoles ? draftBlueprintHierarchy : undefined;
      const created = await onSaveBlueprint(
        parsedName.data,
        { ...tactics },
        savedHierarchy === undefined ? undefined : { hierarchy: savedHierarchy },
      );
      if (!mounted) return;
      const key = fullCourtBlueprintNameKey(created.name);
      const index = blueprints.findIndex((item) => fullCourtBlueprintNameKey(item.name) > key);
      blueprints =
        index === -1
          ? [...blueprints, created]
          : [...blueprints.slice(0, index), created, ...blueprints.slice(index)];
      selectedKey = `blueprint:${created.name}`;
      blueprintName = '';
      libraryMessage =
        created.hierarchy === undefined
          ? `Saved "${created.name}" to your strategies.`
          : `Saved "${created.name}" with portable scoring roles to your strategies.`;
    } catch (error) {
      if (!mounted) return;
      libraryError = error instanceof Error ? error.message : 'The strategy could not be saved.';
    } finally {
      if (mounted) {
        libraryBusy = false;
      }
    }
  }

  async function confirmRemove(): Promise<void> {
    if (
      onRemoveBlueprint === undefined ||
      confirmingRemoveName === null ||
      disabled ||
      libraryBusy
    ) {
      return;
    }
    const targetName = confirmingRemoveName;
    libraryBusy = true;
    libraryError = null;
    libraryMessage = null;
    try {
      await onRemoveBlueprint(targetName);
      if (!mounted) return;
      blueprints = blueprints.filter((item) => item.name !== targetName);
      confirmingRemoveName = null;
      selectedKey = DEFAULT_PRESET_KEY;
      libraryMessage = `Removed "${targetName}" from your strategies.`;
    } catch (error) {
      if (!mounted) return;
      libraryError = error instanceof Error ? error.message : 'The strategy could not be removed.';
    } finally {
      if (mounted) {
        libraryBusy = false;
      }
    }
  }

  function handleNameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    void saveBlueprint();
  }
</script>

<div class="mt-3 border-t border-line-soft pt-3" data-testid="full-court-strategy-presets">
  <div class="flex flex-wrap items-baseline justify-between gap-1">
    <label class="ui-label" data-tone="muted" for="full-court-strategy-preset">
      Strategy preset
    </label>
    {#if libraryLoading}
      <span class="ui-micro" role="status">Loading saved strategies…</span>
    {/if}
  </div>

  <div class="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
    <select
      id="full-court-strategy-preset"
      class="{CONTROL_CLASS} sm:flex-1"
      value={selectedKey}
      disabled={disabled || libraryBusy}
      onchange={(event) => selectPreset(event.currentTarget.value)}
    >
      <optgroup label="Historical presets">
        {#each FULL_COURT_HISTORICAL_PRESETS as preset (preset.id)}
          <option value="historical:{preset.id}">{preset.name}</option>
        {/each}
      </optgroup>
      {#if blueprints.length > 0}
        <optgroup label="Saved strategies">
          {#each blueprints as blueprint (blueprint.name)}
            <option value="blueprint:{blueprint.name}">
              {blueprint.hierarchy === undefined
                ? blueprint.name
                : `${blueprint.name} · scoring roles`}
            </option>
          {/each}
        </optgroup>
      {/if}
    </select>

    <div class="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        tone="secondary"
        size="sm"
        disabled={disabled ||
          libraryBusy ||
          (selectedHistorical === null && selectedBlueprint === null)}
        onclick={applySelected}
      >
        Apply
      </Button>
      {#if selectedBlueprint !== null && onRemoveBlueprint !== undefined}
        <Button
          type="button"
          tone="ghost"
          size="sm"
          disabled={disabled || libraryBusy}
          onclick={() => {
            confirmingRemoveName = selectedBlueprint.name;
            libraryError = null;
            libraryMessage = null;
          }}
        >
          Remove
        </Button>
      {/if}
    </div>
  </div>

  {#if selectedHistorical !== null}
    <p class="mt-1.5 text-xs leading-snug text-muted-foreground">
      {selectedHistorical.description}
    </p>
    <p class="ui-micro mt-0.5">{formatTacticsSummary(selectedHistorical.tactics)}</p>
  {:else if selectedBlueprint !== null}
    <p class="ui-micro mt-1.5">{formatTacticsSummary(selectedBlueprint.tactics)}</p>
    {#if selectedPreview !== null}
      <div
        class="mt-2 rounded-lg border border-line-soft bg-surface-1 px-3 py-2"
        data-testid="full-court-blueprint-role-preview"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="ui-label" data-tone="muted">Scoring role preview</p>
          <div class="flex flex-wrap items-center gap-1">
            {#if selectedPreview.hasMissingOrVacant}
              <Badge tone="negative">Vacant role</Badge>
            {/if}
            {#if selectedPreview.hasAmbiguous}
              <Badge tone="accent">Ambiguous fit</Badge>
            {/if}
            {#if selectedPreview.hasFallback}
              <Badge tone="accent">Fallback</Badge>
            {/if}
            {#if !selectedPreview.hasMissingOrVacant && !selectedPreview.hasAmbiguous && !selectedPreview.hasFallback}
              <Badge tone="positive">Exact fit</Badge>
            {/if}
          </div>
        </div>
        <p class="ui-micro mt-0.5 text-muted-foreground">
          {selectedPreview.rotationSource === 'automatic'
            ? 'Previewed against the staff rotation. Rotations and rules stay unchanged.'
            : 'Previewed against your current rotation. Rotations and rules stay unchanged.'}
        </p>
        <ul class="mt-2 space-y-1.5">
          {#each selectedPreview.bindings as binding (binding.role)}
            <li class="rounded border border-line-soft bg-surface-2 px-2.5 py-1.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <span class="text-xs font-semibold text-foreground">
                    {ROLE_LABELS[binding.role]}
                  </span>
                  <span class="ui-micro ml-1.5 text-muted-foreground">
                    {binding.targetLabel}
                  </span>
                </div>
                <div class="flex items-center gap-1.5">
                  {#if binding.player !== null}
                    <span class="text-xs font-semibold text-foreground">
                      {binding.player.displayName} · {formatPositions(binding.player.positions)}
                    </span>
                  {/if}
                  <Badge tone={STATUS_TONES[binding.status]}>{STATUS_LABELS[binding.status]}</Badge>
                </div>
              </div>
              {#if binding.reason !== null}
                <p class="ui-micro mt-1 text-muted-foreground">{binding.reason}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {:else if selectedBlueprint.hierarchy !== undefined}
      <p class="ui-micro mt-1 text-muted-foreground">
        Includes portable scoring roles ({summarizeDraftHierarchy(selectedBlueprint.hierarchy)}).
      </p>
    {/if}
  {/if}

  {#if confirmingRemoveName !== null}
    <div
      class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2"
      role="region"
      aria-label="Confirm strategy removal"
    >
      <p class="text-xs font-semibold text-foreground">
        Remove "{confirmingRemoveName}" from saved strategies?
      </p>
      <div class="flex items-center gap-2">
        <Button
          type="button"
          tone="danger"
          size="sm"
          loading={libraryBusy}
          disabled={disabled || libraryBusy}
          onclick={() => void confirmRemove()}
        >
          Confirm remove
        </Button>
        <Button
          type="button"
          tone="ghost"
          size="sm"
          disabled={disabled || libraryBusy}
          onclick={() => (confirmingRemoveName = null)}
        >
          Cancel
        </Button>
      </div>
    </div>
  {/if}

  {#if onSaveBlueprint !== undefined}
    <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label class="sr-only" for="full-court-blueprint-name">Save current tactics as</label>
      <input
        id="full-court-blueprint-name"
        type="text"
        maxlength={FULL_COURT_BLUEPRINT_MAX_NAME_LENGTH}
        placeholder="Save current tactics as…"
        class="{CONTROL_CLASS} sm:flex-1"
        bind:value={blueprintName}
        disabled={disabled || libraryBusy || libraryLoading}
        oninput={() => {
          libraryError = null;
          libraryMessage = null;
        }}
        onkeydown={handleNameKeydown}
      />
      <Button
        type="button"
        tone="secondary"
        size="sm"
        loading={libraryBusy}
        disabled={disabled || libraryBusy || libraryLoading || !parsedName.success || duplicateName}
        onclick={() => void saveBlueprint()}
      >
        Save strategy
      </Button>
    </div>
    {#if draftBlueprintHierarchy !== undefined}
      <label class="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 accent-primary"
          bind:checked={includeRoles}
          disabled={disabled || libraryBusy || libraryLoading}
        />
        <span>
          Include portable scoring roles ({summarizeDraftHierarchy(draftBlueprintHierarchy)})
        </span>
      </label>
    {/if}
    {#if duplicateName}
      <p class="mt-1 text-xs font-semibold text-negative">
        A strategy with this name already exists. Choose another name.
      </p>
    {/if}
  {:else if hasSavedLibrary && !libraryLoading && blueprints.length === 0}
    <p class="ui-micro mt-2">No saved strategies yet.</p>
  {/if}

  {#if libraryError !== null}
    <Alert tone="danger" class="mt-2">{libraryError}</Alert>
  {/if}
  {#if libraryMessage !== null}
    <p class="mt-2 text-xs font-semibold text-positive" role="status">{libraryMessage}</p>
  {/if}
</div>
