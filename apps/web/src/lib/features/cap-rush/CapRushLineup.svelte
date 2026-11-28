<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import type { CapRushLockedInputs } from '@hoop-rush/data-contracts';
  import { Crown } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import { buildPlayerProfile, defaultSlotForPositions } from '#lib/players/player-profile.js';
  import type { PlayerProfileReferences } from '#lib/players/player-profile.js';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatMillions, initialsOf } from './cap-rush-presentation.ts';
  import {
    NO_APRON,
    capRushLockedApron,
    capRushProfileInput,
    capRushProjectedApron,
  } from './cap-rush-player-profile.ts';
  import CapRushPlayoffMark from './CapRushPlayoffMark.svelte';
  import {
    capRushPlayoffCoverage,
    capRushPlayoffRowFor,
    type CapRushPlayoffStatus,
  } from './cap-rush-playoff-presentation.ts';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';

  let {
    slots,
    art = null,
    locked = null,
    payrollDollars = 0,
    references = null,
    playoffStatus = 'no-sample',
  }: {
    slots: CapRushDraftView['slots'];
    art?: CapRushArt | null;
    locked?: CapRushLockedInputs | null;
    payrollDollars?: number;
    references?: PlayerProfileReferences | null;
    playoffStatus?: CapRushPlayoffStatus;
  } = $props();

  const filled = $derived(slots.filter((slot) => slot.player !== null).length);
  const coverage = $derived(
    capRushPlayoffCoverage(
      locked,
      slots.map((slot) => slot.player?.playerVersionId),
    ),
  );
  const positions = [
    { left: 50, top: 78 },
    { left: 78, top: 57 },
    { left: 22, top: 57 },
    { left: 72, top: 29 },
    { left: 36, top: 29 },
  ];
  const statusLabel: Record<CapRushPlayoffStatus, string> = {
    active: 'live now',
    pending: 'playoffs only',
    'no-sample': 'no sample',
  };

  let selectedId = $state<string | null>(null);
  let sheetTab = $state<'details' | 'tendencies' | 'ratings' | 'apron'>('details');

  const selectedSlot = $derived(
    selectedId === null
      ? null
      : (slots.find((slot) => slot.player?.playerVersionId === selectedId) ?? null),
  );

  const selectedTeam = $derived.by(() => {
    const player = selectedSlot?.player ?? null;
    return player === null || art === null ? null : art.teamFor(player.franchiseId);
  });

  const selectedApron = $derived.by(() => {
    const player = selectedSlot?.player ?? null;
    if (player === null) return NO_APRON;
    if (locked !== null) return capRushLockedApron(player, locked.payrollDollars);
    return capRushProjectedApron(player, payrollDollars);
  });

  const selectedProfile = $derived.by(() => {
    const player = selectedSlot?.player ?? null;
    if (player === null) return null;
    const slot = selectedSlot?.slot ?? defaultSlotForPositions(player.positions);
    return buildPlayerProfile(
      capRushProfileInput(player, selectedTeam?.abbreviation ?? player.franchiseId, slot),
      references?.forSlot(slot) ?? null,
    );
  });

  const selectedFace = $derived.by(() => {
    const player = selectedSlot?.player ?? null;
    return player === null || art === null ? null : art.faceFor(player);
  });
</script>

<section aria-label="Your lineup" class="min-w-0">
  <SectionHeading class="px-1 py-3" title="Your five" size="sm" align="center">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        {#if coverage.withEvidence > 0}
          <span
            class="flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.04em] uppercase {playoffStatus ===
            'active'
              ? 'border-positive/50 bg-positive/10 text-positive'
              : playoffStatus === 'pending'
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-line-soft text-muted-foreground'}"
            title={`Playoff form is recorded for ${String(coverage.withEvidence)} of ${String(coverage.total)} starters: ${statusLabel[playoffStatus]}.`}
          >
            PO {coverage.withEvidence}/{coverage.total}
            <span class="font-normal opacity-80">{statusLabel[playoffStatus]}</span>
          </span>
        {/if}
        <span class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
          >{filled}/5</span
        >
      </div>
    {/snippet}
  </SectionHeading>
  <div class="court" role="group" aria-label="Your five on the court">
    <span class="court-arc" aria-hidden="true"></span>
    <span class="court-rim" aria-hidden="true"></span>
    {#each slots as slot, i (slot.slot)}
      {@const player = slot.player}
      {@const face = art !== null && player !== null ? art.faceFor(player) : null}
      {@const playoffRow =
        locked === null || player === null
          ? null
          : capRushPlayoffRowFor(locked, player.playerVersionId)}
      <div
        class="court-slot"
        style:left={`${positions[i]?.left}%`}
        style:top={`${positions[i]?.top}%`}
      >
        <div class="relative inline-block">
          {#if player !== null}
            <div
              class="h-14 w-14 overflow-hidden rounded-full border-[3px] border-white/90 bg-[#20242c] shadow-lg sm:h-16 sm:w-16"
            >
              {#if face !== null && art !== null}
                <PlayerFace
                  player={face}
                  manifest={art.manifest}
                  size="court"
                  fallbackInitials={initialsOf(player.displayName)}
                />
              {:else}
                <span
                  class="grid h-full w-full place-items-center font-display text-sm font-extrabold text-white"
                  >{initialsOf(player.displayName)}</span
                >
              {/if}
            </div>
            <button
              type="button"
              class="absolute inset-0 z-10 rounded-full outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${player.displayName} details`}
              onclick={() => (selectedId = player.playerVersionId)}
            ></button>
          {:else}
            <span
              class="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-white/80 font-display text-xl font-bold text-white/80 sm:h-16 sm:w-16"
              >+</span
            >
          {/if}
          <span
            class="absolute -top-1 -left-1 rounded bg-primary px-1 py-px font-mono text-[9px] font-bold text-primary-foreground"
            >{slot.slot}</span
          >
          {#if slot.highestPaid}<span
              class="absolute -top-1 -right-1 rounded-full bg-card p-1 text-accent"
              title="Highest-paid player"
              ><Crown size={12} aria-hidden="true" /><span class="sr-only">Highest-paid player</span
              ></span
            >{/if}
        </div>
        {#if player !== null}
          <button
            type="button"
            class="slot-name outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${player.displayName} details`}
            onclick={() => (selectedId = player.playerVersionId)}
          >
            {player.displayName}
          </button>
        {:else}
          <span class="slot-name">Open {slot.slot}</span>
        {/if}
        {#if player}
          <span class="slot-salary">
            {formatMillions(slot.salaryDollars)}{#if playoffRow !== null}<span class="slot-playoff"
                ><CapRushPlayoffMark row={playoffRow} status={playoffStatus} size="sm" /></span
              >{/if}
          </span>
        {/if}
      </div>
    {/each}
  </div>
</section>

{#if selectedProfile !== null}
  <PlayerProfileSheet
    profile={selectedProfile}
    apron={selectedApron}
    face={selectedFace}
    manifest={art?.manifest ?? null}
    money={{
      salaryLabel: formatMillions(selectedSlot?.salaryDollars ?? 0),
      statusLabel: locked !== null ? 'Signed' : 'Projected',
      note: null,
    }}
    tabs={['details', 'tendencies', 'ratings', 'apron']}
    bind:tab={sheetTab}
    open={selectedId !== null}
    onOpenChange={(open) => {
      if (!open) selectedId = null;
    }}
  />
{/if}

<style>
  .court {
    position: relative;
    min-height: 300px;
    overflow: hidden;
    border-radius: 0.625rem;
    background: var(--color-court-wood);
    background-image: repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.07) 0 2px,
      transparent 2px 64px
    );
    box-shadow: inset 0 0 70px rgba(78, 39, 6, 0.28);
  }
  .court::before {
    content: '';
    position: absolute;
    left: 8%;
    right: 8%;
    top: -2px;
    height: 65%;
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-top: 0;
  }
  .court::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -70px;
    width: 150px;
    height: 225px;
    transform: translateX(-50%);
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-radius: 0 0 85px 85px;
  }
  .court-arc {
    position: absolute;
    left: 17%;
    top: -42%;
    width: 66%;
    height: 88%;
    border: 2px solid rgba(255, 255, 255, 0.68);
    border-radius: 50%;
  }
  .court-rim {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 73px;
    width: 52px;
    height: 12px;
    transform: translateX(-50%);
    border: 3px solid var(--color-court-rim);
    border-radius: 50%;
  }
  .court-slot {
    position: absolute;
    z-index: 3;
    width: 92px;
    transform: translate(-50%, -50%);
    text-align: center;
  }
  .slot-name,
  .slot-salary {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #241406;
    font-weight: 800;
    line-height: 1.15;
  }
  .slot-name {
    margin-top: 4px;
    width: 100%;
    font-family: var(--font-display);
    font-size: 10px;
  }
  .slot-salary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .slot-playoff {
    display: inline-flex;
    flex: none;
  }
  @media (min-width: 640px) {
    .court {
      min-height: 410px;
    }
    .court-slot {
      width: 104px;
    }
    .slot-name {
      font-size: 11px;
    }
  }
</style>
