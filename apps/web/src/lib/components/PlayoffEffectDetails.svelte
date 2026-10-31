<script lang="ts">
  import type { PlayoffAdjustment, CapRushPlayoffApplied } from '@hoop-rush/data-contracts';

  let { adjustment, applied }: { adjustment: PlayoffAdjustment; applied: CapRushPlayoffApplied } =
    $props();
  const signed = (value: number, digits = 2) => {
    const rounded = Math.abs(value).toFixed(digits);
    return Number(rounded) === 0 ? rounded : `${value < 0 ? '-' : '+'}${rounded}`;
  };
  const rate = (value: number | null, percent = false) =>
    value === null ? '--' : percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(1);
  const rows = $derived([
    {
      label: 'Shooting',
      key: 'tsPct' as const,
      expected: rate(adjustment.expected.tsPct, true),
      actual: rate(adjustment.actual.tsPct, true),
      effect: `${signed(applied.fieldGoalPct * 100)} pp FG / ${signed(applied.threePointPct * 100)} pp 3P`,
      value: applied.fieldGoalPct + applied.threePointPct,
      worse: false,
    },
    {
      label: 'Shot volume',
      key: 'pointsPer36' as const,
      expected: rate(adjustment.expected.pointsPer100),
      actual: rate(adjustment.actual.pointsPer100),
      effect: `${signed(applied.fieldGoalAttemptsPerGame)} shots/g`,
      value: applied.fieldGoalAttemptsPerGame,
      worse: false,
    },
    {
      label: 'Passing',
      key: 'assistsPer36' as const,
      expected: rate(adjustment.expected.assistsPer100),
      actual: rate(adjustment.actual.assistsPer100),
      effect: `${signed(applied.assistsPerGame)} ast/g / ${signed(applied.passRate)} pass tendency`,
      value: applied.assistsPerGame,
      worse: false,
    },
    {
      label: 'Rebounding',
      key: 'reboundsPer36' as const,
      expected: rate(adjustment.expected.reboundsPer100),
      actual: rate(adjustment.actual.reboundsPer100),
      effect: `${signed(applied.offensiveReboundsPerGame)} ORB / ${signed(applied.defensiveReboundsPerGame)} DRB per game`,
      value: applied.offensiveReboundsPerGame + applied.defensiveReboundsPerGame,
      worse: false,
    },
    {
      label: 'Ball security',
      key: 'turnoversPer36' as const,
      expected: rate(adjustment.expected.turnoversPer100),
      actual: rate(adjustment.actual.turnoversPer100),
      effect: `${signed(applied.turnoverRate)} turnover tendency`,
      value: applied.turnoverRate,
      worse: true,
    },
  ]);
</script>

<div class="rounded-lg border border-border/60 bg-surface-1 p-3">
  <p class="text-sm font-bold">Opponent and pace adjusted</p>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
    Expected production uses this player's regular season and the defenses actually faced in the
    playoffs. Rates use estimated possessions; shooting uses true shooting percentage. Each skill
    receives its own sample adjustment and capped gameplay effect.
  </p>
  <p class="mt-2 font-mono text-[10px] text-muted-foreground">
    {adjustment.opponents} opponents / {Math.round(adjustment.possessions)} estimated possessions
  </p>
  <div class="mt-3 overflow-x-auto">
    <table class="w-full min-w-[28rem] text-left text-[11px]">
      <caption class="sr-only"
        >Opponent-adjusted expected and actual playoff production, evidence retained, and gameplay
        effects</caption
      >
      <thead class="font-mono text-[9px] text-muted-foreground uppercase">
        <tr
          ><th scope="col" class="py-2">Skill</th><th scope="col" class="p-2 text-right"
            >Expected</th
          ><th scope="col" class="p-2 text-right">Actual</th><th scope="col" class="p-2 text-right"
            >Retained</th
          ><th scope="col" class="p-2">Playoff effect</th></tr
        >
      </thead>
      <tbody>
        {#each rows as row (row.key)}
          <tr class="border-t border-border/40">
            <th scope="row" class="py-2 pr-2 font-medium">{row.label}</th>
            <td class="p-2 text-right font-mono tabular-nums">{row.expected}</td>
            <td class="p-2 text-right font-mono tabular-nums">{row.actual}</td>
            <td class="p-2 text-right font-mono tabular-nums"
              >{Math.round(adjustment.weights[row.key] * 100)}%</td
            >
            <td class="p-2">
              <span class="font-bold"
                >{adjustment.weights[row.key] === 0
                  ? 'Insufficient predictive evidence'
                  : Math.abs(row.value) < 0.005
                    ? 'Near neutral'
                    : (row.worse ? row.value < 0 : row.value > 0)
                      ? 'Bonus'
                      : 'Penalty'}</span
              >
              <span class="mt-0.5 block font-mono text-[10px] text-muted-foreground"
                >{row.effect}</span
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="mt-2 text-[10px] leading-relaxed text-muted-foreground">
    Expected and actual counting stats are per 100 estimated possessions. Shot volume is informed by
    scoring. Retained is the share left after shrinking the sample toward neutral, not a confidence
    probability. Effects change simulation inputs, not guaranteed box-score results. Injury and role
    changes are not isolated.
    {#if adjustment.minutePrecision === 'whole-minutes'}
      Some game minutes were reported as whole minutes, so possession exposure is approximate.
    {/if}
  </p>
</div>
