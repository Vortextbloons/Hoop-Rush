<script lang="ts">
  import type { FullCourtDraftState, FullCourtReportTarget } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_SPIN_PURCHASES, franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import {
    fullCourtPayrollDollars,
    fullCourtPayrollStatus,
    fullCourtRouletteReceipts,
    fullCourtSpinEligibility,
    fullCourtWarChestDollars,
    type FullCourtCatalogIndex,
  } from '@hoop-rush/engine';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import {
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import FullCourtAbandonRun from './FullCourtAbandonRun.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import FullCourtRating from './FullCourtRating.svelte';
  import FullCourtRosterFitPanel from './FullCourtRosterFitPanel.svelte';
  import FullCourtTrainingCampPanel from './FullCourtTrainingCampPanel.svelte';
  import type { FullCourtArt } from './full-court-art.ts';

  let {
    draft,
    index,
    busy,
    onPurchaseSpin,
    onSkipSpin,
    onFinalize,
    onPurchaseReport,
    onAbandon,
    art = null,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex | null;
    busy: boolean;
    onPurchaseSpin: (purchase: 'standard' | 'surge', playerVersionId: string) => void;
    onSkipSpin: () => void;
    onFinalize: () => void;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
    onAbandon?: () => void;
    art?: FullCourtArt | null;
  } = $props();

  const purchases = [
    { id: 'standard', label: 'Standard spin' },
    { id: 'surge', label: 'Surge spin' },
  ] as const;
  const receipts = $derived(fullCourtRouletteReceipts(draft));
  const mutatedVersions = $derived(
    new Set(receipts.map((receipt) => receipt.target.playerVersionId)),
  );
  const payroll = $derived(fullCourtPayrollDollars(draft.picks));
  const payrollStatus = $derived(fullCourtPayrollStatus(payroll, draft.money));
  const warChest = $derived(fullCourtWarChestDollars(draft));
  const status = $derived(draft.roulette?.status ?? 'open');
  const spinningOpen = $derived(status === 'open');
</script>

<Panel padding="lg">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <SectionHeading title="Full Court Roulette" level={2} size="sm" align="start" />
      <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
        Payroll is locked at confirmation. Spins draw from the existing Cap Rush odds and prices and
        debit the budget without changing the apron. A target can be a starter or a reserve; its
        player version and position are pinned now.
      </p>
    </div>
    <Badge class={capStatusClass(payrollStatus)}>{capStatusLabel(payrollStatus)}</Badge>
  </div>

  <StatGrid class="mt-4" columns={4} mobile={2}>
    <StatTile label="Locked payroll" size="sm" surface="tile" value={formatMillions(payroll)} />
    <StatTile label="Budget" size="sm" surface="tile" value={formatMillions(warChest)} />
    <StatTile label="Spins bought" size="sm" surface="tile" value={receipts.length} />
    <StatTile
      label="Status"
      size="sm"
      surface="tile"
      value={status.charAt(0).toUpperCase() + status.slice(1)}
    />
  </StatGrid>

  {#if spinningOpen}
    <div class="ui-stats-scroll mt-5">
      <PlayerStatsTable
        columns={[
          {
            key: 'positions',
            label: 'Position',
            align: 'start',
            value: (pick) => pick.player.positions.join('/'),
            cellClass: 'text-muted-foreground',
          },
          {
            key: 'salary',
            label: 'Salary',
            align: 'start',
            value: (pick) => formatMillions(pick.salaryDollars),
          },
          {
            key: 'spin',
            label: 'Spin',
            align: 'start',
            value: () => '',
          },
        ] satisfies PlayerStatColumn<(typeof draft.picks)[number]>[]}
        rows={draft.picks}
        rowKey={(pick) => pick.player.playerVersionId}
        caption="Full Court Roulette roster"
        stickyIdentity
        tableClass="min-w-[42rem]"
        playerCellClass="ui-stats-player-cell"
        playerHeadCellClass="ui-stats-player-cell"
      >
        {#snippet identity(pick)}
          {@const mutated = mutatedVersions.has(pick.player.playerVersionId)}
          <div class="ui-stats-player">
            <FullCourtPortrait player={pick.player} {art} size="sm" />
            <div class="ui-stats-player-text">
              <div class="flex items-baseline gap-1.5">
                <span class="ui-stats-player-name font-display text-sm font-extrabold"
                  >{pick.player.displayName}</span
                >
                <FullCourtRating
                  value={pick.player.originalOverall}
                  size="sm"
                  layout="inline"
                  align="left"
                />
              </div>
              <p class="mt-0.5 font-mono text-[8px] text-muted-foreground uppercase">
                {franchiseAbbreviation(pick.player.franchiseId)} · {pick.player.seasonKey}
              </p>
              {#if mutated}
                {@const receipt = receipts.find(
                  (entry) => entry.target.playerVersionId === pick.player.playerVersionId,
                )}
                <div class="mt-1 text-xs text-muted-foreground">
                  {receipt?.entry.mutationId ?? 'Mutation'} · tier {receipt?.tier ?? '—'}
                </div>
              {/if}
            </div>
          </div>
        {/snippet}
        {#snippet cell(pick, column)}
          {#if column.key === 'spin'}
            {@const mutated = mutatedVersions.has(pick.player.playerVersionId)}
            {#if mutated}
              <span class="text-xs text-muted-foreground">Already mutated</span>
            {:else}
              <div class="flex flex-wrap gap-2">
                {#each purchases as purchase (purchase.id)}
                  {@const eligibility = fullCourtSpinEligibility(draft, purchase.id)}
                  <Button
                    size="sm"
                    tone={purchase.id === 'surge' ? 'secondary' : 'primary'}
                    disabled={busy || !eligibility.eligible}
                    onclick={() => onPurchaseSpin(purchase.id, pick.player.playerVersionId)}
                  >
                    {purchase.label}
                    <span class="ml-1 text-xs opacity-80">
                      {formatMillions(CAP_RUSH_SPIN_PURCHASES[purchase.id].priceDollars)}
                    </span>
                  </Button>
                {/each}
              </div>
              {@const standard = fullCourtSpinEligibility(draft, 'standard')}
              {#if !standard.eligible}
                <p class="mt-1 text-xs text-muted-foreground">
                  {standard.reason === 'cap'
                    ? `Locked payroll plus spins exceeds the ${formatMillions(draft.money.capLineDollars)} cap line.`
                    : 'The budget cannot cover another spin.'}
                </p>
              {/if}
            {/if}
          {:else}
            {column.value(pick)}
          {/if}
        {/snippet}
      </PlayerStatsTable>
    </div>
  {:else if status === 'skipped'}
    <p class="mt-4 text-sm text-muted-foreground">
      Spins are skipped for this run. Finalize to start the season with the confirmed roster.
    </p>
  {/if}

  <div class="mt-5 flex flex-wrap gap-2">
    {#if spinningOpen}
      <Button tone="secondary" disabled={busy} onclick={onSkipSpin}>Skip spins</Button>
    {/if}
    <Button tone="primary" disabled={busy} onclick={onFinalize}>Finalize and start season</Button>
  </div>
</Panel>

{#if onAbandon !== undefined}
  <div class="mt-3">
    <FullCourtAbandonRun {busy} {onAbandon} />
  </div>
{/if}

{#if index !== null}
  <div class="mt-3 flex flex-col gap-3">
    <FullCourtRosterFitPanel
      {draft}
      {index}
      {busy}
      {onPurchaseReport}
      ariaLabel="Full Court Roulette roster fit"
      eyebrow="Preparation"
    />
    <FullCourtTrainingCampPanel
      {draft}
      {index}
      {busy}
      campOpen
      practiceOpen={false}
      practice={null}
      {onPurchaseReport}
      onRunPractice={() => undefined}
      ariaLabel="Full Court Roulette training camp"
      {art}
    />
  </div>
{/if}
