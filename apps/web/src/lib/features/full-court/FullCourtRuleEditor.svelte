<script lang="ts">
  import type {
    FullCourtClosingLineupRule,
    FullCourtCoachingRule,
    FullCourtFoulTroubleRule,
    SimulationPlayer,
  } from '@hoop-rush/data-contracts';
  import Button from '#lib/components/ui/Button.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import {
    FULL_COURT_MAX_RULES,
    FULL_COURT_STARTER_SLOTS,
    fullCourtUnitNameForLineup,
    type FullCourtNamedUnitDraft,
  } from './full-court-coaching-presenter.ts';

  let {
    rules,
    roster,
    units = [],
    locked = false,
    onAdd,
    onUpdate,
    onRemove,
    onMove,
  }: {
    rules: readonly FullCourtCoachingRule[];
    roster: readonly SimulationPlayer[];
    units?: readonly FullCourtNamedUnitDraft[];
    locked?: boolean;
    onAdd: (kind: FullCourtCoachingRule['kind']) => void;
    onUpdate: (index: number, rule: FullCourtCoachingRule) => void;
    onRemove: (index: number) => void;
    onMove: (index: number, delta: number) => void;
  } = $props();

  const SLOTS = [0, 1, 2, 3, 4] as const;
  const SELECT_CLASS =
    'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const NUMBER_CLASS =
    'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line-soft bg-surface-2 px-2.5 text-right font-mono text-sm tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

  function timeMinutes(rule: FullCourtClosingLineupRule): number {
    return Math.round((rule.secondsRemainingMax / 60) * 10) / 10;
  }

  function update(rule: FullCourtCoachingRule): void {
    if (locked) return;
    onUpdate(rules.indexOf(rule), rule);
  }

  function setClosingTime(rule: FullCourtClosingLineupRule, raw: string): void {
    const minutes = Number(raw);
    update({
      ...rule,
      secondsRemainingMax: Number.isFinite(minutes)
        ? Math.round(Math.min(48, Math.max(0, minutes)) * 60)
        : 0,
    });
  }

  function setClosingMargin(rule: FullCourtClosingLineupRule, raw: string): void {
    const margin = Number(raw);
    update({
      ...rule,
      scoreMarginMax: Number.isFinite(margin) ? Math.round(Math.min(40, Math.max(0, margin))) : 0,
    });
  }

  function setLineupSlot(rule: FullCourtClosingLineupRule, slot: number, playerId: string): void {
    const lineup = [...rule.lineup];
    const existing = lineup.indexOf(playerId);
    if (existing >= 0 && existing !== slot) lineup[existing] = lineup[slot] ?? playerId;
    lineup[slot] = playerId;
    update({ ...rule, lineup });
  }

  function setNamedUnit(rule: FullCourtClosingLineupRule, name: string): void {
    const unit = units.find((candidate) => candidate.name === name);
    if (unit === undefined) return;
    update({ ...rule, lineup: [...unit.playerIds] });
  }

  function setFoulPlayer(rule: FullCourtFoulTroubleRule, playerId: string): void {
    const { replacementPlayerId, ...rest } = rule;
    update({
      ...rest,
      playerId,
      ...(replacementPlayerId === undefined || replacementPlayerId === playerId
        ? {}
        : { replacementPlayerId }),
    });
  }

  function setFoulLimit(rule: FullCourtFoulTroubleRule, raw: string): void {
    update({ ...rule, foulLimit: Number(raw) });
  }

  function setReplacement(rule: FullCourtFoulTroubleRule, playerId: string): void {
    update({
      ...rule,
      ...(playerId === '' ? { replacementPlayerId: undefined } : { replacementPlayerId: playerId }),
    });
  }
</script>

<section class="mt-0" aria-label="Coaching rules" data-testid="full-court-rule-editor">
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0">
      <p class="text-sm font-semibold">Conditional rules</p>
      <p class="mt-1 text-[11px] leading-snug text-muted-foreground">
        Rules run in priority order at dead balls. The first matching rule wins. Closing lineups
        activate once; foul-trouble rules wait out a cooldown after each trigger.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button
        tone="secondary"
        type="button"
        disabled={locked || rules.length >= FULL_COURT_MAX_RULES}
        onclick={() => onAdd('closing-lineup')}
      >
        Add closing lineup
      </Button>
      <Button
        tone="secondary"
        type="button"
        disabled={locked || rules.length >= FULL_COURT_MAX_RULES}
        onclick={() => onAdd('foul-trouble')}
      >
        Add foul trouble
      </Button>
    </div>
  </div>

  {#if rules.length === 0}
    <p
      class="mt-3 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      No conditional rules. The staff keeps the saved rotation and closing five.
    </p>
  {:else}
    <ol class="mt-3 grid gap-2">
      {#each rules as rule, index (rule.ruleId)}
        <li class="rounded-lg border border-line-soft bg-surface-1 px-3 py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary-foreground"
              >
                Priority {index + 1}
              </span>
              <span class="text-sm font-semibold">
                {rule.kind === 'closing-lineup' ? 'Closing lineup' : 'Foul trouble'}
              </span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Button
                tone="ghost"
                type="button"
                disabled={locked || index === 0}
                onclick={() => onMove(index, -1)}
              >
                Move up
              </Button>
              <Button
                tone="ghost"
                type="button"
                disabled={locked || index === rules.length - 1}
                onclick={() => onMove(index, 1)}
              >
                Move down
              </Button>
              <Button tone="ghost" type="button" disabled={locked} onclick={() => onRemove(index)}>
                Remove
              </Button>
            </div>
          </div>

          <p class="mt-1 text-sm text-muted-foreground">
            {#if rule.kind === 'closing-lineup'}
              Final {Math.floor(rule.secondsRemainingMax / 60)}:{String(
                rule.secondsRemainingMax % 60,
              ).padStart(2, '0')} with the score within {rule.scoreMarginMax} points &rarr; {fullCourtUnitNameForLineup(
                units,
                rule.lineup,
              ) ?? 'Selected five'}
            {:else}
              {roster.find((player) => player.playerId === rule.playerId)?.displayName ?? 'Player'}
              reaches {rule.foulLimit} fouls &rarr;
              {roster.find((player) => player.playerId === rule.replacementPlayerId)?.displayName ??
                'Staff-selected substitute'}
            {/if}
          </p>
          {#if rule.kind === 'closing-lineup'}
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <label class="min-w-0">
                <span class="ui-micro">At or under (minutes left in regulation)</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  max="48"
                  step="0.5"
                  class={NUMBER_CLASS}
                  value={timeMinutes(rule)}
                  disabled={locked}
                  oninput={(event) => setClosingTime(rule, event.currentTarget.value)}
                />
              </label>
              <label class="min-w-0">
                <span class="ui-micro">Score margin at or under</span>
                <input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max="40"
                  step="1"
                  class={NUMBER_CLASS}
                  value={rule.scoreMarginMax}
                  disabled={locked}
                  oninput={(event) => setClosingMargin(rule, event.currentTarget.value)}
                />
              </label>
            </div>
            {#if units.length > 0}
              <label class="mt-2 block min-w-0">
                <span class="ui-micro">Start from named unit</span>
                <select
                  class={SELECT_CLASS}
                  value={fullCourtUnitNameForLineup(units, rule.lineup) ?? ''}
                  disabled={locked}
                  onchange={(event) => setNamedUnit(rule, event.currentTarget.value)}
                >
                  <option value="">Custom lineup</option>
                  {#each units as unit (unit.name)}
                    <option value={unit.name}>{unit.name}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {#each SLOTS as slot (slot)}
                <label class="min-w-0">
                  <span class="ui-micro">Player {slot + 1}</span>
                  <select
                    class={SELECT_CLASS}
                    value={rule.lineup[slot] ?? ''}
                    disabled={locked}
                    onchange={(event) => setLineupSlot(rule, slot, event.currentTarget.value)}
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
          {:else}
            <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label class="min-w-0">
                <span class="ui-micro">Player</span>
                <select
                  class={SELECT_CLASS}
                  value={rule.playerId}
                  disabled={locked}
                  onchange={(event) => setFoulPlayer(rule, event.currentTarget.value)}
                >
                  {#each roster as player (player.playerId)}
                    <option value={player.playerId}>{player.displayName}</option>
                  {/each}
                </select>
              </label>
              <label class="min-w-0">
                <span class="ui-micro">Replace at fouls</span>
                <select
                  class={SELECT_CLASS}
                  value={String(rule.foulLimit)}
                  disabled={locked}
                  onchange={(event) => setFoulLimit(rule, event.currentTarget.value)}
                >
                  {#each Array.from({ length: FULL_COURT_STARTER_SLOTS }, (_, index) => index + 1) as limit (limit)}
                    <option value={String(limit)}>{limit}</option>
                  {/each}
                </select>
              </label>
              <label class="min-w-0">
                <span class="ui-micro">Replacement</span>
                <select
                  class={SELECT_CLASS}
                  value={rule.replacementPlayerId ?? ''}
                  disabled={locked}
                  onchange={(event) => setReplacement(rule, event.currentTarget.value)}
                >
                  <option value="">Best available reserve</option>
                  {#each roster as player (player.playerId)}
                    {#if player.playerId !== rule.playerId}
                      <option value={player.playerId}>{player.displayName}</option>
                    {/if}
                  {/each}
                </select>
              </label>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>
