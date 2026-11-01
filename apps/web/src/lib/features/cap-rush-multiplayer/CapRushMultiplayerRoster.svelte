<script lang="ts">
  import type {
    CapRushMultiplayerMarketPlayer,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    Position,
  } from '@hoop-rush/data-contracts';
  import { POSITIONS, franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { formatAverage, initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import { money, positionLabel, seatLabelFor } from './cap-rush-multiplayer-presentation.js';

  interface RosterSlot {
    readonly slot: Position;
    readonly playerId: string | null;
    readonly salaryDollars: number | null;
    readonly player: CapRushMultiplayerMarketPlayer | null;
    readonly fallbackName: string | null;
    readonly source: 'bid' | 'auto' | null;
  }

  let {
    state,
    seat,
    localSeat,
    art = null,
    compact = false,
    highlightPlayerId = null,
  }: {
    state: CapRushMultiplayerState;
    seat: CapRushMultiplayerSeatId;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    compact?: boolean;
    highlightPlayerId?: string | null;
  } = $props();

  const isLocal = $derived(seat === localSeat);
  const slots: RosterSlot[] = $derived.by(() => {
    const locked = state.locked?.seats[seat] ?? null;
    const recruitment = state.recruitment;
    const signings = recruitment?.signings.filter((entry) => entry.seat === seat) ?? [];
    return POSITIONS.map((slot) => {
      const pick = locked?.picks.find((entry) => entry.slot === slot) ?? null;
      const signing = signings.find((entry) => entry.position === slot) ?? null;
      const playerId = pick?.playerId ?? signing?.playerId ?? null;
      const player =
        playerId === null
          ? null
          : (recruitment?.market.players.find((entry) => entry.playerId === playerId) ?? null);
      return {
        slot,
        playerId,
        salaryDollars: pick?.salaryDollars ?? signing?.salaryDollars ?? null,
        player,
        fallbackName: signing?.displayName ?? null,
        source: signing?.source ?? null,
      };
    });
  });
  const filled = $derived(slots.filter((entry) => entry.playerId !== null).length);
  const averages = $derived.by(() => {
    const totals = new Map<
      string,
      { games: number; points: number; rebounds: number; assists: number }
    >();
    for (const game of state.season?.games ?? []) {
      for (const line of [...game.box.home.participants, ...game.box.away.participants]) {
        const entry = totals.get(line.playerId) ?? {
          games: 0,
          points: 0,
          rebounds: 0,
          assists: 0,
        };
        entry.games += 1;
        entry.points += line.points;
        entry.rebounds += line.rebounds;
        entry.assists += line.assists;
        totals.set(line.playerId, entry);
      }
    }
    return totals;
  });

  function nameOf(entry: RosterSlot): string {
    return entry.player?.displayName ?? entry.fallbackName ?? 'Unlisted player';
  }

  function teamLabel(entry: RosterSlot): string {
    if (entry.player === null) return positionLabel(entry.slot);
    return (
      art?.teamFor(entry.player.franchiseId)?.abbreviation ??
      franchiseAbbreviation(entry.player.franchiseId)
    );
  }
</script>

<section
  class="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-surface-1 p-2 {isLocal
    ? 'border-primary/40'
    : 'border-line-soft'}"
  aria-label={`${seatLabelFor(seat, localSeat)} roster`}
>
  <header class="flex items-center justify-between gap-2 px-1">
    <p
      class="font-mono text-[9px] font-bold tracking-[0.14em] uppercase {isLocal
        ? 'text-primary'
        : 'text-muted-foreground'}"
    >
      {seatLabelFor(seat, localSeat)}
    </p>
    <p class="font-mono text-[9px] text-muted-foreground tabular-nums">{filled}/5</p>
  </header>

  <ul class="flex flex-col gap-0.5">
    {#each slots as entry (entry.slot)}
      {@const name = nameOf(entry)}
      {@const player = entry.player}
      {@const face = player !== null && art !== null ? art.faceFor(player.source) : null}
      {@const team = player !== null && art !== null ? art.teamFor(player.franchiseId) : null}
      {@const average = player === null ? null : (averages.get(player.playerId) ?? null)}
      <li
        class="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1
          {entry.playerId !== null && entry.playerId === highlightPlayerId
          ? 'roster-highlight'
          : ''}"
      >
        {#if player !== null && face !== null && art !== null}
          <PlayerFace
            player={face}
            manifest={art.manifest}
            size={compact ? 'sm' : 'court'}
            fallbackInitials={initialsOf(name)}
          />
        {:else if entry.playerId !== null}
          <span
            class="grid shrink-0 place-items-center bg-surface-3 font-display text-xs font-extrabold text-muted-foreground {compact
              ? 'h-9 w-9 rounded-md'
              : 'h-12 w-12 rounded-full'}"
            aria-hidden="true">{initialsOf(name)}</span
          >
        {:else}
          <span
            class="shrink-0 border border-dashed border-line-strong {compact
              ? 'h-9 w-9 rounded-md'
              : 'h-12 w-12 rounded-full'}"
            aria-hidden="true"
          ></span>
        {/if}

        <div class="min-w-0 flex-1">
          <p
            class="truncate {compact
              ? 'text-xs font-semibold'
              : 'font-display text-sm font-bold tracking-tight uppercase'}"
          >
            {entry.playerId === null ? `Open ${entry.slot}` : name}
          </p>
          <p
            class="flex min-w-0 items-center gap-1 font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase"
          >
            {#if team !== null && art !== null}
              <TeamLogo
                manifest={art.manifest}
                franchiseId={team.franchiseId}
                teamExternalId={team.teamExternalId}
                className="h-3 w-3"
              />
            {/if}
            <span class="truncate">
              {#if entry.playerId === null}
                {positionLabel(entry.slot)}
              {:else}
                {entry.slot} · {teamLabel(entry)}
              {/if}
            </span>
            {#if entry.source === 'auto'}
              <span
                class="shrink-0 rounded border border-accent/40 px-1 font-mono text-[8px] font-bold text-accent uppercase"
                >Auto</span
              >
            {/if}
          </p>
          {#if average !== null && average.games > 0}
            <p class="mt-0.5 font-mono text-[9px] text-muted-foreground tabular-nums">
              {formatAverage(average.points, average.games)} PPG ·
              {formatAverage(average.rebounds, average.games)} RPG ·
              {formatAverage(average.assists, average.games)} APG
            </p>
          {/if}
        </div>

        <div class="shrink-0 text-right">
          <p class="font-mono text-[11px] font-semibold tabular-nums">
            {entry.salaryDollars === null ? '—' : money(entry.salaryDollars)}
          </p>
          {#if player !== null}
            <p class="font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
              {player.originalOverall} OVR
            </p>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</section>

<style>
  .roster-highlight {
    animation: roster-flash 900ms ease-out both;
  }
  @keyframes roster-flash {
    from {
      background-color: color-mix(in srgb, var(--color-primary) 26%, transparent);
    }
    to {
      background-color: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .roster-highlight {
      animation: none;
      background-color: color-mix(in srgb, var(--color-primary) 16%, transparent);
    }
  }
</style>
