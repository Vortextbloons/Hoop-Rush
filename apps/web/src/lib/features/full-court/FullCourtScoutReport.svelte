<script lang="ts">
  import { fullCourtReportScope } from '@hoop-rush/data-contracts';
  import { fullCourtScoutPlayer } from '@hoop-rush/engine';
  import Badge from '#lib/components/ui/Badge.svelte';
  import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
  import FullCourtScoutEvidence from './FullCourtScoutEvidence.svelte';

  const ROLE_LABELS = {
    'primary-creator': 'Primary creator',
    'secondary-creator': 'Secondary creator',
    'floor-spacer': 'Floor spacer',
    'rim-runner': 'Rim runner',
    'post-scorer': 'Post scorer',
    'glass-crasher': 'Glass crasher',
    'rim-protector': 'Rim protector',
    'perimeter-stopper': 'Perimeter stopper',
    connector: 'Connector',
    support: 'Support',
  } as const;

  const USAGE_LABELS = {
    low: 'Low usage',
    balanced: 'Balanced usage',
    high: 'High usage',
    heavy: 'Heavy usage',
  } as const;

  const FINDING_LABELS = {
    'elite-spacing': 'Elite spacing',
    'plus-spacing': 'Plus spacing',
    'rim-pressure': 'Rim pressure',
    'post-threat': 'Post threat',
    'offensive-glass': 'Offensive glass',
    'rim-protection': 'Rim protection',
    'perimeter-defense': 'Perimeter defense',
    'defensive-playmaking': 'Defensive playmaking',
    'low-usage': 'Low usage',
    'no-three-point-range': 'No three-point range',
    'turnover-risk': 'Turnover risk',
    'foul-risk': 'Foul risk',
    'poor-free-throw': 'Poor free throw',
    'limited-playmaking': 'Limited playmaking',
  } as const;

  const ZONE_LABELS = {
    rim: 'Rim',
    'short-mid': 'Short mid',
    'long-mid': 'Long mid',
    'corner-three': 'Corner 3',
    'above-break-three': 'Above break',
  } as const;

  let {
    report,
    priceDollars = null,
    purchasedRevision = null,
  }: {
    report: ReturnType<typeof fullCourtScoutPlayer>;
    priceDollars?: number | null;
    purchasedRevision?: number | null;
  } = $props();
</script>

<div class="mt-3 flex flex-wrap items-center gap-2 border-y border-line-soft py-2.5">
  <Badge tone="positive">Owned</Badge>
  <span class="font-mono text-[9px] text-muted-foreground uppercase">
    {fullCourtReportScope('player-scouting') === 'run' ? 'Lifetime of this run' : 'This game only'}
  </span>
  {#if priceDollars !== null}
    <span class="ml-auto font-mono text-[9px] text-muted-foreground tabular-nums">
      Paid {formatMillions(priceDollars)}
    </span>
  {/if}
</div>

<div class="mt-3 grid gap-3 sm:grid-cols-2">
  <section aria-label="Usage read">
    <p class="ui-label text-muted-foreground">Usage</p>
    <p class="mt-1 font-display text-2xl font-extrabold tabular-nums">
      {report.usage.usageRate}%
    </p>
    <p class="text-[11px] font-semibold">{USAGE_LABELS[report.usage.tier]}</p>
    <p class="mt-1 font-mono text-[9px] text-muted-foreground">
      On ball {report.usage.onBallRate}% · Pass {report.usage.passRate}%
    </p>
    <div class="mt-1.5">
      <FullCourtScoutEvidence
        items={report.usage.evidence.map((entry) => ({
          field: entry.field,
          value: entry.value,
        }))}
      />
    </div>
  </section>

  <section aria-label="Role read">
    <p class="ui-label text-muted-foreground">Role</p>
    <p class="mt-1 text-sm font-bold">{ROLE_LABELS[report.role.role]}</p>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      Next to a higher-usage creator: {ROLE_LABELS[report.role.complementaryRole]}
    </p>
    <div class="mt-1.5">
      <FullCourtScoutEvidence
        items={report.role.evidence.map((entry) => ({
          field: entry.field,
          value: entry.value,
        }))}
      />
    </div>
  </section>
</div>

<section class="mt-4 border-t border-line-soft pt-3" aria-label="Shot profile">
  <p class="ui-label text-muted-foreground">Shot profile</p>
  <ul class="mt-1.5 grid gap-1">
    {#each report.shotProfile as zone (zone.zone)}
      <li class="flex items-center justify-between gap-3 font-mono text-[10px]">
        <span class="text-muted-foreground">{ZONE_LABELS[zone.zone]}</span>
        <span class="font-bold tabular-nums">{zone.frequency}%</span>
      </li>
    {/each}
  </ul>
</section>

<section class="mt-4 border-t border-line-soft pt-3" aria-label="Scouting strengths">
  <p class="ui-label text-muted-foreground">Strengths</p>
  {#if report.strengths.length === 0}
    <p class="mt-1 text-[11px] text-muted-foreground">
      No strength cleared the evidence thresholds.
    </p>
  {:else}
    <ul class="mt-1.5 flex flex-col gap-2">
      {#each report.strengths as finding (finding.code)}
        <li>
          <p class="text-[11px] font-bold">{FINDING_LABELS[finding.code]}</p>
          {#if finding.evidence.length > 0}
            <div class="mt-1">
              <FullCourtScoutEvidence
                items={finding.evidence.map((entry) => ({
                  field: entry.field,
                  value: entry.value,
                }))}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mt-4 border-t border-line-soft pt-3" aria-label="Scouting limitations">
  <p class="ui-label text-muted-foreground">Limitations</p>
  {#if report.limitations.length === 0}
    <p class="mt-1 text-[11px] text-muted-foreground">
      No limitation cleared the evidence thresholds.
    </p>
  {:else}
    <ul class="mt-1.5 flex flex-col gap-2">
      {#each report.limitations as finding (finding.code)}
        <li>
          <p class="text-[11px] font-bold">{FINDING_LABELS[finding.code]}</p>
          {#if finding.evidence.length > 0}
            <div class="mt-1">
              <FullCourtScoutEvidence
                items={finding.evidence.map((entry) => ({
                  field: entry.field,
                  value: entry.value,
                }))}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if purchasedRevision !== null}
  <p class="mt-4 border-t border-line-soft pt-2 font-mono text-[9px] text-muted-foreground">
    Bought at draft revision {purchasedRevision}.
  </p>
{/if}
