<script lang="ts">
  import type { PlayoffAdjustment, CapRushPlayoffApplied } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_PLAYOFF_EFFECT_STRENGTH } from '@hoop-rush/engine';

  let { adjustment, applied }: { adjustment: PlayoffAdjustment; applied: CapRushPlayoffApplied } =
    $props();
  const signed = (value: number, digits = 2) => {
    const rounded = Math.abs(value).toFixed(digits);
    return Number(rounded) === 0 ? rounded : `${value < 0 ? '-' : '+'}${rounded}`;
  };
  const rate = (value: number | null, percent = false) =>
    value === null ? '--' : percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(1);
  const rows = $derived.by(() => {
    const modern = adjustment.modelVersion === 'opponent-pace-v2';
    const volume = adjustment.shotVolume;
    const base = [
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
    ].map((row) => ({
      ...row,
      weight: adjustment.weights[row.key],
      attempts: null as number | null,
      unavailable: false,
      threshold: 0.005,
    }));
    if (!modern) return base;
    const shooting = (['twoPoint', 'threePoint', 'freeThrow'] as const).map((key) => {
      const evidence = adjustment.shooting?.[key];
      const value =
        key === 'twoPoint'
          ? (applied.twoPointPct ?? 0)
          : key === 'threePoint'
            ? applied.threePointPct
            : (applied.freeThrowPct ?? 0);
      return {
        key,
        label:
          key === 'twoPoint'
            ? '2-point shooting'
            : key === 'threePoint'
              ? '3-point shooting'
              : 'Free throws',
        expected: rate(evidence?.expected ?? null, true),
        actual: rate(evidence?.actual ?? null, true),
        effect: `${signed(value * 100)} pp`,
        value,
        worse: false,
        weight: evidence?.weight ?? 0,
        attempts: evidence?.attempts ?? null,
        unavailable: evidence == null,
        threshold: 0.00005,
      };
    });
    return [
      ...shooting,
      ...base.slice(1).map((row) =>
        row.key !== 'pointsPer36'
          ? row
          : {
              ...row,
              label: 'Shot attempts',
              expected: rate(volume?.expected ?? null),
              actual: rate(volume?.actual ?? null),
              weight: volume?.weight ?? 0,
              unavailable: volume == null,
            },
      ),
    ];
  });
</script>

<div class="rounded-lg border border-border/60 bg-surface-1 p-3">
  <p class="text-sm font-bold">Opponent and pace adjusted</p>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
    Expected production uses this player's regular season and the defenses actually faced in the
    playoffs. Shooting types are evaluated separately; counting stats use estimated possessions.
    Each skill receives its own sample adjustment and capped gameplay effect.
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
              >{Math.round(row.weight * 100)}%
              {#if row.attempts !== null}<span class="block text-[9px] text-muted-foreground"
                  >{Math.round(row.attempts)} attempts</span
                >{/if}</td
            >
            <td class="p-2">
              <span class="font-bold"
                >{row.unavailable
                  ? 'No usable sample'
                  : row.weight === 0
                    ? 'Insufficient predictive evidence'
                    : Math.abs(row.value) < row.threshold
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
    Expected and actual counting stats are per 100 estimated possessions.
    {#if adjustment.modelVersion === 'opponent-pace-v2'}
      Shot volume uses attempts, independently of shooting efficiency. Free throws use the player's
      regular-season baseline. Supported effects use {CAP_RUSH_PLAYOFF_EFFECT_STRENGTH}x gameplay
      strength before caps.
    {:else}
      This saved model uses combined true shooting and scoring-derived shot volume.
    {/if}
    Retained is the share left after shrinking the sample toward neutral, not a confidence probability.
    Effects change simulation inputs, not guaranteed box-score results. Injury and role changes are not
    isolated.
    {#if adjustment.minutePrecision === 'whole-minutes'}
      Some game minutes were reported as whole minutes, so possession exposure is approximate.
    {/if}
  </p>
</div>
