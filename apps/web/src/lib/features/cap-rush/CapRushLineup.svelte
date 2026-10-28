<script lang="ts">
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { Crown } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatMillions, initialsOf } from './cap-rush-presentation.ts';

  let {
    slots,
    art = null,
  }: {
    slots: CapRushDraftView['slots'];
    art?: CapRushArt | null;
  } = $props();
  const filled = $derived(slots.filter((slot) => slot.player !== null).length);
</script>

<section class="rounded-2xl border border-border bg-card px-3 py-2" aria-label="Your lineup">
  <div class="flex items-center justify-between gap-3 px-0.5">
    <h2 class="font-display text-sm font-extrabold tracking-tight uppercase">Your five</h2>
    <span class="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
      {filled}/5
    </span>
  </div>
  <ol class="mt-2 grid grid-cols-5 gap-1.5">
    {#each slots as slot (slot.slot)}
      {@const player = slot.player}
      {@const face = art !== null && player !== null ? art.faceFor(player) : null}
      {@const team = art !== null && player !== null ? art.teamFor(player.franchiseId) : null}
      {@const lastName =
        player === null
          ? null
          : (player.displayName.split(' ').filter(Boolean).at(-1) ?? player.displayName)}
      <li
        class="min-w-0 rounded-lg border p-1.5 md:rounded-xl md:px-2 md:py-1.5 {player
          ? 'border-line-soft bg-surface-1'
          : 'border-dashed border-line-soft bg-background/40'} {slot.highestPaid
          ? 'ring-1 ring-accent/60'
          : ''}"
      >
        <div class="flex items-center justify-between gap-1">
          <span
            class="flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 py-0.5 font-mono text-[8px] font-bold md:px-1.5 md:text-[9px]"
          >
            {slot.slot}
            {#if slot.highestPaid}
              <Crown size={8} class="text-accent" aria-hidden="true" />
              <span class="sr-only">Highest-paid target</span>
            {/if}
          </span>
          <span class="shrink-0 font-mono text-[7px] font-semibold tabular-nums md:text-[10px]">
            {player ? formatMillions(slot.salaryDollars) : '—'}
          </span>
        </div>
        <div class="mt-1 flex flex-col items-center gap-1 md:mt-1.5 md:flex-row md:gap-2">
          {#if player !== null}
            {#if face !== null && art !== null}
              <PlayerFace
                player={face}
                manifest={art.manifest}
                size="sm"
                fallbackInitials={initialsOf(player.displayName)}
              />
            {:else}
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                aria-hidden="true">{initialsOf(player.displayName)}</span
              >
            {/if}
            <div class="min-w-0 w-full text-center md:text-left">
              <p class="truncate text-[10px] leading-tight font-bold md:hidden">{lastName}</p>
              <p class="hidden truncate text-xs font-bold md:block">{player.displayName}</p>
              <p
                class="mt-0.5 hidden min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground md:flex"
              >
                {#if team !== null && art !== null}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={team.franchiseId}
                    teamExternalId={team.teamExternalId}
                    className="h-3.5 w-3.5"
                  />
                {/if}
                <span class="truncate uppercase"
                  >{team?.abbreviation ?? franchiseAbbreviation(player.franchiseId)} ·
                  {player.seasonKey}</span
                >
              </p>
            </div>
          {:else}
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-dashed border-line-strong font-display text-xs font-extrabold text-muted-foreground"
              aria-hidden="true">+</span
            >
            <div class="hidden min-w-0 w-full text-center md:block md:text-left">
              <p class="truncate text-[10px] font-semibold text-muted-foreground md:text-xs">
                Open
              </p>
              <p class="hidden font-mono text-[9px] text-muted-foreground uppercase md:block">
                Unfilled
              </p>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
</section>
