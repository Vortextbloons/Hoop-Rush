<script lang="ts">
  import type { HavocReport } from '@hoop-rush/data-contracts';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocMvpCard from './HavocMvpCard.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import {
    havocParticipantKindLabel,
    havocRecordLabel,
    mutationNameOf,
  } from './havoc-presentation';

  let { report }: { report: HavocReport } = $props();
  const comparison = $derived(report.comparison);
</script>

<div class="flex min-w-0 flex-col gap-4" data-havoc-report>
  <section aria-labelledby="havoc-report-heading" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Havoc Report · {report.runId}
        </p>
        <h2
          id="havoc-report-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase"
        >
          {havocRecordLabel(report.havoc.wins, report.havoc.losses)}
          {#if report.perfectSeason}
            <span class="text-primary">· 82–0</span>
          {/if}
        </h2>
      </div>
      <span
        class="rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {report.status ===
        'complete'
          ? 'border-primary text-primary'
          : 'border-border text-muted-foreground'}"
      >
        {report.status === 'complete' ? 'Comparison complete' : 'Comparison pending'}
      </span>
    </div>
    <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Points for
        </dt>
        <dd class="font-mono text-lg font-bold">{report.havoc.pointsFor}</dd>
      </div>
      <div>
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Points against
        </dt>
        <dd class="font-mono text-lg font-bold">{report.havoc.pointsAgainst}</dd>
      </div>
      <div>
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Differential
        </dt>
        <dd class="font-mono text-lg font-bold">{report.havoc.differential}</dd>
      </div>
      <div>
        <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
          Direct mutation points
        </dt>
        <dd class="font-mono text-lg font-bold" data-havoc-direct-mutation-points>
          {report.directMutationPoints}
        </dd>
      </div>
    </dl>
    <details class="mt-3">
      <summary
        class="cursor-pointer font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Version identifiers
      </summary>
      <dl class="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Schema</dt>
          <dd>{report.versions.schemaVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Rules</dt>
          <dd>{report.versions.rulesVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Mutations</dt>
          <dd>{report.versions.mutationCatalogVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Seeds</dt>
          <dd>{report.versions.seedDerivationVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Engine</dt>
          <dd>{report.versions.engineVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Profile</dt>
          <dd>{report.versions.profileVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Data</dt>
          <dd>{report.versions.dataVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Catalog</dt>
          <dd class="break-all">{report.versions.catalogVersion}</dd>
        </div>
      </dl>
    </details>
  </section>

  <section aria-labelledby="havoc-report-lineup" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <h3
      id="havoc-report-lineup"
      class="font-display text-base font-extrabold tracking-tight uppercase"
    >
      Drafted lineup & packages
    </h3>
    <ul class="mt-3 flex flex-col gap-2">
      {#each report.lineup as entry (entry.slot)}
        <li class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
          <span class="w-8 shrink-0 font-mono text-xs font-bold text-muted-foreground uppercase">
            {entry.slot}
          </span>
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-display text-sm font-extrabold tracking-tight uppercase">
                {entry.nickname}
              </span>
              <HavocTierBadge tier={entry.tier} size="sm" />
            </p>
            <p class="text-xs text-muted-foreground">{entry.displayName}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {entry.mutations.map((mutation) => mutationNameOf(mutation.mutationId)).join(', ')}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  {#if report.mvp !== null && comparison !== null}
    <HavocMvpCard {comparison} />
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <section aria-labelledby="havoc-report-gains" class="rounded-xl bg-surface-1 p-4 sm:p-5">
      <h3
        id="havoc-report-gains"
        class="font-display text-base font-extrabold tracking-tight uppercase"
      >
        Top gains
      </h3>
      {#if report.topGains.length === 0}
        <p class="mt-2 text-xs text-muted-foreground">Available after the comparison completes.</p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1 text-xs">
          {#each report.topGains as difference (difference.gameNumber)}
            <li class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground"
                >Game {difference.gameNumber} vs {difference.opponentId}</span
              >
              <span class="font-mono">
                {difference.humanScore}–{difference.opponentScore}
                <span class="font-bold text-primary">+{difference.pointsDelta}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="havoc-report-losses" class="rounded-xl bg-surface-1 p-4 sm:p-5">
      <h3
        id="havoc-report-losses"
        class="font-display text-base font-extrabold tracking-tight uppercase"
      >
        Top losses
      </h3>
      {#if report.topLosses.length === 0}
        <p class="mt-2 text-xs text-muted-foreground">Available after the comparison completes.</p>
      {:else}
        <ul class="mt-2 flex flex-col gap-1 text-xs">
          {#each report.topLosses as difference (difference.gameNumber)}
            <li class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground"
                >Game {difference.gameNumber} vs {difference.opponentId}</span
              >
              <span class="font-mono">
                {difference.humanScore}–{difference.opponentScore}
                <span class="font-bold text-destructive">{difference.pointsDelta}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <section aria-labelledby="havoc-report-wildest" class="rounded-xl bg-surface-1 p-4 sm:p-5">
    <h3
      id="havoc-report-wildest"
      class="font-display text-base font-extrabold tracking-tight uppercase"
    >
      Wildest recorded games
    </h3>
    {#if report.wildestGames.length === 0}
      <p class="mt-2 text-xs text-muted-foreground">No games recorded yet.</p>
    {:else}
      <ul class="mt-2 flex flex-col gap-1 text-xs">
        {#each report.wildestGames as game (game.gameNumber)}
          <li class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-muted-foreground">Game {game.gameNumber} vs {game.opponentId}</span>
            <span class="font-mono">
              {game.humanScore}–{game.opponentScore} · margin {game.absoluteMargin} · adjustments
              {game.adjustments}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if comparison !== null}
    <section aria-labelledby="havoc-report-lines" class="rounded-xl bg-surface-1 p-4 sm:p-5">
      <h3
        id="havoc-report-lines"
        class="font-display text-base font-extrabold tracking-tight uppercase"
      >
        Starter, clone, and replacement lines
      </h3>
      <p class="mt-1 text-xs text-muted-foreground">
        Clone and replacement production belongs to its originating draft slot for the comparison
        and awards, but each line stays visible.
      </p>
      <div class="mt-3 flex flex-col gap-3">
        {#each comparison.slots as slot (slot.slot)}
          <div class="overflow-x-auto rounded-lg bg-surface-2 p-3">
            <p class="flex items-center gap-2 text-sm font-semibold">
              <span class="font-mono text-xs text-muted-foreground uppercase">{slot.slot}</span>
              {slot.displayName}
            </p>
            <table class="mt-2 w-full min-w-[34rem] text-xs">
              <thead>
                <tr
                  class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
                >
                  <th scope="col" class="px-2 py-1 text-left font-medium">Line</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">Pts</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">FG</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">Reb</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">Ast</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">Stl</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">Blk</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">TO</th>
                  <th scope="col" class="px-2 py-1 text-right font-medium">PF</th>
                </tr>
              </thead>
              <tbody>
                {#each slot.havoc.lines as line (line.instanceId)}
                  <tr class="border-b border-border/40">
                    <th scope="row" class="max-w-44 truncate px-2 py-1 text-left font-semibold">
                      {line.displayName}
                      <span class="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                        {havocParticipantKindLabel(line.kind)}
                      </span>
                    </th>
                    <td class="px-2 py-1 text-right font-mono font-bold">{line.line.points}</td>
                    <td class="px-2 py-1 text-right font-mono">
                      {line.line.fieldGoals.made}/{line.line.fieldGoals.attempted}
                    </td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.rebounds.total}</td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.assists}</td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.steals}</td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.blocks}</td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.turnovers}</td>
                    <td class="px-2 py-1 text-right font-mono">{line.line.fouls}</td>
                  </tr>
                {/each}
                <tr class="font-semibold">
                  <th scope="row" class="px-2 py-1 text-left">Combined (slot total)</th>
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.points}</td>
                  <td class="px-2 py-1 text-right font-mono">
                    {slot.havoc.combined.fieldGoals.made}/{slot.havoc.combined.fieldGoals.attempted}
                  </td>
                  <td class="px-2 py-1 text-right font-mono"
                    >{slot.havoc.combined.rebounds.total}</td
                  >
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.assists}</td>
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.steals}</td>
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.blocks}</td>
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.turnovers}</td>
                  <td class="px-2 py-1 text-right font-mono">{slot.havoc.combined.fouls}</td>
                </tr>
              </tbody>
            </table>
          </div>
        {/each}
      </div>
    </section>

    <HavocComparisonView {comparison} />
  {:else}
    <section class="rounded-xl bg-surface-1 p-4 sm:p-5">
      <h3 class="font-display text-base font-extrabold tracking-tight uppercase">
        Matched comparison
      </h3>
      <p class="mt-2 text-xs text-muted-foreground">
        The normal season is not final yet. Baseline numbers, the paired chart, and the MVP stay
        hidden until all 82 normal games are accepted.
      </p>
    </section>
  {/if}
</div>
