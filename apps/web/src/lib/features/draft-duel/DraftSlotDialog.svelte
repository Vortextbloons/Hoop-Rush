<script lang="ts">
  import type { DraftDuelCard, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { ArrowRight, Check, Plus, Lock } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { canPlay, slotRequirement } from '@hoop-rush/engine';
  import DialogShell from '$lib/components/DialogShell.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import PositionOptionRow from '$lib/components/PositionOptionRow.svelte';
  import { SLOT_INDEXES, SLOT_LABELS, SLOT_NAMES, formatPositions } from '$lib/player-positions';

  let {
    card,
    manifest,
    roster,
    legalSlots,
    moving = false,
    moveLabels = {},
    onplace,
    onclose,
  }: {
    card: DraftDuelCard | null;
    manifest: HoopRushManifest | null;
    roster: (DraftDuelCard | null)[];
    legalSlots: number[];
    moving?: boolean;
    moveLabels?: Record<number, string>;
    onplace: (slotIndex: number) => void;
    onclose: () => void;
  } = $props();

  type SlotOption = {
    index: number;
    label: string;
    incumbent: DraftDuelCard | null;
    state: 'open' | 'move' | 'occupied' | 'cant-play' | 'unsafe' | 'self';
    ariaLabel: string;
  };

  const options = $derived.by((): SlotOption[] => {
    const subject = card;
    if (!subject) return [];
    return SLOT_INDEXES.map((index) => {
      const label = SLOT_LABELS[index];
      const slotName = `${SLOT_NAMES[index]} slot ${index + 1}`;
      const incumbent = roster[index] ?? null;
      if (incumbent?.playerVersionId === subject.playerVersionId) {
        return {
          index,
          label,
          incumbent,
          state: 'self' as const,
          ariaLabel: `${subject.displayName} already at ${slotName}`,
        };
      }
      if (!canPlay(subject.positions, slotRequirement(index))) {
        return {
          index,
          label,
          incumbent,
          state: 'cant-play' as const,
          ariaLabel: `${subject.displayName} cannot play ${slotName}`,
        };
      }
      if (legalSlots.includes(index)) {
        if (incumbent) {
          return {
            index,
            label,
            incumbent,
            state: 'move' as const,
            ariaLabel: `Move ${subject.displayName} to ${slotName}, moving ${incumbent.displayName}`,
          };
        }
        return {
          index,
          label,
          incumbent: null,
          state: 'open' as const,
          ariaLabel: `${moving ? 'Move' : 'Place'} ${subject.displayName} at ${slotName}`,
        };
      }
      if (incumbent) {
        return {
          index,
          label,
          incumbent,
          state: 'occupied' as const,
          ariaLabel: `${slotName} is occupied by ${incumbent.displayName}`,
        };
      }
      return {
        index,
        label,
        incumbent: null,
        state: 'unsafe' as const,
        ariaLabel: `Placing ${subject.displayName} at ${slotName} would risk the lineup`,
      };
    });
  });

  const initials = $derived(
    (card?.displayName ?? '')
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );

  function stateText(state: SlotOption['state']): string {
    if (state === 'occupied') return 'Occupied';
    if (state === 'cant-play') return "Can't play";
    if (state === 'self') return 'Current';
    return "Can't complete";
  }

  function toneOf(state: SlotOption['state']): 'open' | 'move' | 'self' | 'muted' {
    if (state === 'open') return 'open';
    if (state === 'move') return 'move';
    if (state === 'self') return 'self';
    return 'muted';
  }

  function selectable(state: SlotOption['state']): boolean {
    return state === 'open' || state === 'move';
  }
</script>

<DialogShell
  open={card !== null}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
  size="sm"
  grabHandle
  closeLabel="Cancel"
  contentClass="max-h-[92dvh] overscroll-contain"
>
  {#snippet header()}
    {#if card}
      {@const subject = card}
      <div class="flex min-w-0 items-center gap-3">
        {#if manifest && subject.playerExternalId}
          <PlayerFace
            player={{
              playerId: subject.playerId,
              playerExternalId: subject.playerExternalId,
              altIds: null,
            }}
            {manifest}
            size="sm"
            fallbackInitials={initials}
          />
        {:else}
          <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
          >
            {initials}
          </span>
        {/if}
        <div class="min-w-0">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {subject.displayName}
          </Dialog.Title>
          <p class="font-mono text-[10px] text-muted-foreground">
            {subject.seasonKey} · {formatPositions(subject.positions)}
          </p>
        </div>
      </div>
    {/if}
  {/snippet}

  {#if card}
    <p class="mt-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
      {moving ? 'Move to a position' : 'Choose a position'}
    </p>

    <div class="mt-2 flex flex-col gap-2">
      {#each options as option (option.index)}
        <PositionOptionRow
          slotLabel={option.label}
          ariaLabel={option.ariaLabel}
          disabled={!selectable(option.state)}
          tone={toneOf(option.state)}
          incumbent={option.incumbent === null
            ? null
            : {
                name: option.incumbent.displayName,
                meta: `${option.incumbent.seasonKey} · ${formatPositions(option.incumbent.positions)}`,
              }}
          emptyLabel={option.state === 'open'
            ? `Open ${option.label} slot`
            : (SLOT_NAMES[option.index] ?? '')}
          onSelect={() => onplace(option.index)}
        >
          {#snippet trailing()}
            {#if option.state === 'self'}
              <Check class="h-4 w-4 text-primary" />
              <span class="font-mono text-[10px] tracking-wide uppercase">Current</span>
            {:else if option.state === 'move'}
              <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
              <span class="font-mono text-[10px] tracking-wide uppercase text-accent">
                {moveLabels[option.index] ?? 'Move'}
              </span>
            {:else if option.state === 'open'}
              <Plus class="h-4 w-4 text-primary" />
            {:else if option.state === 'occupied'}
              <Lock class="h-4 w-4" />
              <span class="font-mono text-[10px] tracking-wide uppercase">Occupied</span>
            {:else}
              <span class="font-mono text-[10px] tracking-wide uppercase">
                {stateText(option.state)}
              </span>
            {/if}
          {/snippet}
        </PositionOptionRow>
      {/each}
    </div>
  {/if}
</DialogShell>
