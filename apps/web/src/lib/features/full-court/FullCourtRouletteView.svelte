<script lang="ts">
  import type { FullCourtDraftState, FullCourtReportTarget } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_SPIN_PURCHASES } from '@hoop-rush/data-contracts';
  import {
    fullCourtPayrollDollars,
    fullCourtPayrollStatus,
    fullCourtRouletteReceipts,
    fullCourtSpinEligibility,
    fullCourtWarChestDollars,
    type FullCourtCatalogIndex,
  } from '@hoop-rush/engine';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import {
    capStatusClass,
    capStatusLabel,
    formatMillions,
  } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import { formatWarChestCr } from './full-court-draft-presentation.js';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
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
    art = null,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex | null;
    busy: boolean;
    onPurchaseSpin: (purchase: 'standard' | 'surge', playerVersionId: string) => void;
    onSkipSpin: () => void;
    onFinalize: () => void;
    onPurchaseReport: (target: FullCourtReportTarget) => void;
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
        debit the War Chest without changing the apron. A target can be a starter or a reserve; its
        player version and position are pinned now.
      </p>
    </div>
    <Badge class={capStatusClass(payrollStatus)}>{capStatusLabel(payrollStatus)}</Badge>
  </div>

  <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
    <div>
      <dt class="text-muted-foreground">Locked payroll</dt>
      <dd class="font-semibold">{formatMillions(payroll)}</dd>
    </div>
    <div>
      <dt class="text-muted-foreground">War Chest</dt>
      <dd class="font-semibold">{formatWarChestCr(warChest)}</dd>
    </div>
    <div>
      <dt class="text-muted-foreground">Spins bought</dt>
      <dd class="font-semibold">{receipts.length}</dd>
    </div>
    <div>
      <dt class="text-muted-foreground">Status</dt>
      <dd class="font-semibold capitalize">{status}</dd>
    </div>
  </dl>

  {#if spinningOpen}
    <div class="mt-5 overflow-x-auto">
      <table class="w-full min-w-[42rem] text-sm">
        <thead>
          <tr class="border-b border-border text-left text-muted-foreground">
            <th class="py-2 pr-3 font-medium">Player</th>
            <th class="py-2 pr-3 font-medium">Position</th>
            <th class="py-2 pr-3 font-medium">Salary</th>
            <th class="py-2 font-medium">Spin</th>
          </tr>
        </thead>
        <tbody>
          {#each draft.picks as pick (pick.player.playerVersionId)}
            {@const mutated = mutatedVersions.has(pick.player.playerVersionId)}
            <tr class="border-b border-border/60 align-top">
              <td class="py-3 pr-3">
                <div class="flex min-w-0 items-center gap-2">
                  <FullCourtPortrait player={pick.player} {art} size="sm" />
                  <div class="min-w-0">
                    <span class="font-medium">{pick.player.displayName}</span>
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
              </td>
              <td class="py-3 pr-3 text-muted-foreground">
                {pick.player.positions.join(' / ')}
              </td>
              <td class="py-3 pr-3">{formatMillions(pick.salaryDollars)}</td>
              <td class="py-3">
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
                        : 'The War Chest cannot cover another spin.'}
                    </p>
                  {/if}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
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
