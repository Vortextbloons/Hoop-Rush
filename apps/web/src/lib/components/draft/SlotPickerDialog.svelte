<script lang="ts">
  import type { HoopRushManifest, PlayersIndexEntry } from '@hoop-rush/data-contracts';
  import type { LineupRepositionMove, LineupRepositionPlan } from '@hoop-rush/engine';
  import { ArrowRight, Check, Lock, Plus } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import PositionOptionRow from '#lib/components/PositionOptionRow.svelte';
  import {
    ratingBadges,
    type DraftPresentation,
    type RatingBadgeLabel,
  } from '#lib/draft-presentation.js';
  import {
    SLOT_INDEXES,
    SLOT_LABELS,
    SLOT_NAMES,
    canFillSlot,
    planPlayerMove,
  } from '#lib/draft-slots.js';
  import { formatPositions } from '#lib/player-positions.js';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  type IndexRow = PlayersIndexEntry;
  const BADGE_TITLES: Record<RatingBadgeLabel, string> = {
    O: 'Overall',
  };
  let {
    player,
    slots,
    manifest,
    presentation,
    allowDisplacement,
    onplace,
    onclose,
  }: {
    player: IndexRow | null;
    slots: (IndexRow | null)[];
    manifest: HoopRushManifest;
    presentation: DraftPresentation;
    allowDisplacement: boolean;
    onplace: (player: IndexRow, slotIndex: number) => void;
    onclose: () => void;
  } = $props();
  type PickerOption = {
    index: number;
    incumbent: IndexRow | null;
    state: 'open' | 'self' | 'displace' | 'swap' | 'blocked' | 'cant-play';
    plan: LineupRepositionPlan | null;
    ariaLabel: string;
  };
  function secondaryMovesFor(
    plan: LineupRepositionPlan | null,
    subjectPlayerId: string,
  ): LineupRepositionMove[] {
    return plan?.moves.filter((move) => move.playerId !== subjectPlayerId) ?? [];
  }
  function moveLabel(move: LineupRepositionMove): string {
    const movedPlayer = slots.find((candidate) => candidate?.playerId === move.playerId);
    return `${movedPlayer?.displayName ?? move.playerId} → ${SLOT_LABELS[move.toSlot]}`;
  }
  const pickerOptions = $derived.by((): PickerOption[] => {
    const subject = player;
    if (!subject) return [];
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === subject.playerId);
    return SLOT_INDEXES.map((i) => {
      const incumbent = slots[i] ?? null;
      const slotName = `${SLOT_NAMES[i]} slot ${i + 1}`;
      if (!canFillSlot(subject, i)) {
        return {
          index: i,
          incumbent,
          state: 'cant-play',
          plan: null,
          ariaLabel: `${subject.displayName} cannot play ${slotName}`,
        };
      }
      const plan = planPlayerMove(slots, subject, i);
      const secondaryMoves = secondaryMovesFor(plan, subject.playerId);
      if (!incumbent) {
        return {
          index: i,
          incumbent: null,
          state: 'open',
          plan,
          ariaLabel: `Place ${subject.displayName} at ${slotName}`,
        };
      }
      if (incumbent.playerId === subject.playerId) {
        return {
          index: i,
          incumbent,
          state: 'self',
          plan,
          ariaLabel: `${subject.displayName} already at ${slotName}`,
        };
      }
      if (allowDisplacement && plan !== null) {
        return {
          index: i,
          incumbent,
          state: 'displace',
          plan,
          ariaLabel: `Place ${subject.displayName} at ${slotName}, moving ${secondaryMoves.map(moveLabel).join(', ')}`,
        };
      }
      if (!allowDisplacement && subjectSlot !== -1 && plan !== null && plan.moves.length <= 2) {
        return {
          index: i,
          incumbent,
          state: 'swap',
          plan,
          ariaLabel: `Swap ${subject.displayName} with ${incumbent.displayName} at ${slotName}`,
        };
      }
      return {
        index: i,
        incumbent,
        state: 'blocked',
        plan: null,
        ariaLabel: `${slotName} occupied by ${incumbent.displayName}`,
      };
    });
  });
  function placePlayer(subject: IndexRow, slotIndex: number) {
    onplace(subject, slotIndex);
  }
  function toneOf(state: PickerOption['state']): 'open' | 'move' | 'self' | 'muted' {
    if (state === 'open') return 'open';
    if (state === 'displace' || state === 'swap') return 'move';
    if (state === 'self') return 'self';
    return 'muted';
  }
</script>

<DialogShell
  open={player !== null}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
  size="sm"
  closeLabel="Cancel"
>
  {#snippet header()}
    {#if player}
      {@const subject = player}
      <div class="flex min-w-0 items-center gap-3">
        <PlayerFace
          player={subject}
          {manifest}
          size="sm"
          fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
        />
        <div class="min-w-0">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {subject.displayName}
          </Dialog.Title>
          <p class="font-mono text-[10px] text-muted-foreground">
            {subject.seasonKey} · {formatPositions(subject.positionsPlayable)}
            {#each ratingBadges(subject, presentation) as badge (badge.label)}
              <span class="rounded bg-surface-3 px-1.5 py-0.5" title={BADGE_TITLES[badge.label]}>
                · {`${badge.label} ${badge.value}`}
              </span>
            {/each}
          </p>
        </div>
      </div>
    {/if}
  {/snippet}

  {#if player}
    {@const subject = player}
    <div class="mt-4 flex flex-col gap-2">
      {#each pickerOptions as opt (opt.index)}
        {@const label = SLOT_LABELS[opt.index] ?? ''}
        <PositionOptionRow
          slotLabel={label}
          ariaLabel={opt.ariaLabel}
          disabled={opt.state === 'self' || opt.state === 'blocked' || opt.state === 'cant-play'}
          tone={toneOf(opt.state)}
          incumbent={opt.incumbent === null
            ? null
            : {
                name: opt.incumbent.displayName,
                meta: `${opt.incumbent.seasonKey} · ${formatPositions(opt.incumbent.positionsPlayable)}`,
              }}
          emptyLabel={`Open ${label} slot`}
          onSelect={() => placePlayer(subject, opt.index)}
        >
          {#snippet trailing()}
            {#if opt.state === 'self'}
              <Check class="h-4 w-4 text-primary" />
              <span class="font-mono text-[10px] tracking-wide uppercase">Current</span>
            {:else if opt.state === 'displace' && opt.plan !== null}
              {@const secondaryMoves = secondaryMovesFor(opt.plan, subject.playerId)}
              <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
              <span class="font-mono text-[10px] tracking-wide uppercase text-accent">
                Moves {secondaryMoves.length} player{secondaryMoves.length === 1 ? '' : 's'}:
                {secondaryMoves.map(moveLabel).join(', ')}
              </span>
            {:else if opt.state === 'swap'}
              <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
              <span class="font-mono text-[10px] tracking-wide uppercase text-accent">Swap</span>
            {:else if opt.state === 'blocked'}
              <Lock class="h-4 w-4 shrink-0" />
              <span class="font-mono text-[10px] tracking-wide uppercase">Occupied</span>
            {:else if opt.state === 'cant-play'}
              <span class="font-mono text-[10px] tracking-wide uppercase">Can't play</span>
            {:else}
              <Plus class="h-4 w-4 shrink-0 text-primary" />
            {/if}
          {/snippet}
        </PositionOptionRow>
      {/each}
    </div>
  {/if}
</DialogShell>
