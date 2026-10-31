<script lang="ts">
  import {
    CAP_RUSH_PLAYOFF_CAPS,
    CAP_RUSH_PLAYOFF_FORMULA_VERSION,
    CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  } from '@hoop-rush/data-contracts';
  import {
    sampleLabel,
    signedFixed,
    signedPer36,
    signedPoints,
    weightLabel,
    type CapRushPlayoffRow,
    type CapRushPlayoffStatus,
  } from './cap-rush-playoff-presentation.ts';

  let {
    row,
    displayName,
    seasonKey,
    status = 'active',
  }: {
    row: CapRushPlayoffRow;
    displayName: string;
    seasonKey: string;
    status?: CapRushPlayoffStatus;
  } = $props();

  interface LedgerRow {
    readonly key: string;
    readonly label: string;
    readonly feeds: string;
    readonly regular: string;
    readonly playoffs: string;
    readonly measured: number | null;
    readonly measuredLabel: string;
    readonly applied: number;
    readonly appliedLabel: string;
    readonly cap: number;
    readonly worseWhenHigher: boolean;
  }

  function sharePct(value: number | null): string {
    return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
  }

  const rows = $derived.by((): LedgerRow[] => {
    const o = row.row.observed;
    const a = row.row.applied;
    const reg = row.row.regularSeason;
    const post = row.row.playoffs;
    const c = CAP_RUSH_PLAYOFF_CAPS;
    return [
      {
        key: 'ts',
        label: 'True shooting',
        feeds: 'FG% and 3P% anchors',
        regular: sharePct(reg.tsPct),
        playoffs: sharePct(post.tsPct),
        measured: o.tsPct,
        measuredLabel: signedPoints(o.tsPct),
        applied: a.fieldGoalPct,
        appliedLabel: signedPoints(a.fieldGoalPct),
        cap: c.fieldGoalPct,
        worseWhenHigher: false,
      },
      {
        key: 'pts',
        label: 'Scoring',
        feeds: 'shot volume',
        regular: signedPer36(reg.pointsPer36),
        playoffs: signedPer36(post.pointsPer36),
        measured: o.pointsPer36,
        measuredLabel: o.pointsPer36 === null ? '—' : `${signedPer36(o.pointsPer36)}/36`,
        applied: a.fieldGoalAttemptsPerGame,
        appliedLabel: `${signedFixed(a.fieldGoalAttemptsPerGame, 2)} shots/g`,
        cap: c.fieldGoalAttemptsPerGame,
        worseWhenHigher: false,
      },
      {
        key: 'ast',
        label: 'Assists',
        feeds: 'assist anchor, pass rate',
        regular: signedPer36(reg.assistsPer36),
        playoffs: signedPer36(post.assistsPer36),
        measured: o.assistsPer36,
        measuredLabel: o.assistsPer36 === null ? '—' : `${signedPer36(o.assistsPer36)}/36`,
        applied: a.assistsPerGame,
        appliedLabel: `${signedFixed(a.assistsPerGame, 2)} ast/g`,
        cap: c.assistsPerGame,
        worseWhenHigher: false,
      },
      {
        key: 'reb',
        label: 'Rebounds',
        feeds: 'offensive and defensive weights',
        regular: signedPer36(reg.reboundsPer36),
        playoffs: signedPer36(post.reboundsPer36),
        measured: o.reboundsPer36,
        measuredLabel: o.reboundsPer36 === null ? '—' : `${signedPer36(o.reboundsPer36)}/36`,
        applied: a.offensiveReboundsPerGame + a.defensiveReboundsPerGame,
        appliedLabel: `${signedFixed(a.offensiveReboundsPerGame + a.defensiveReboundsPerGame, 2)} reb/g`,
        cap: c.offensiveReboundsPerGame + c.defensiveReboundsPerGame,
        worseWhenHigher: false,
      },
      {
        key: 'tov',
        label: 'Turnovers',
        feeds: 'turnover tendency',
        regular: signedPer36(reg.turnoversPer36),
        playoffs: signedPer36(post.turnoversPer36),
        measured: o.turnoversPer36,
        measuredLabel: o.turnoversPer36 === null ? '—' : `${signedPer36(o.turnoversPer36)}/36`,
        applied: a.turnoverRate,
        appliedLabel: `${signedFixed(a.turnoverRate, 2)} tendency`,
        cap: c.turnoverRate,
        worseWhenHigher: true,
      },
    ];
  });

  /** Share of the channel cap, clamped, used for both bars on a shared scale. */
  function share(value: number | null, cap: number): number {
    if (value === null || cap <= 0) return 0;
    return Math.min(1, Math.abs(value) / cap);
  }

  function isBetter(entry: LedgerRow, value: number): boolean {
    return entry.worseWhenHigher ? value < 0 : value > 0;
  }

  const moving = $derived(rows.filter((entry) => Math.abs(entry.applied) >= 0.005));
  const measuredChannels = $derived(
    rows.filter((entry) => entry.measured !== null && Math.abs(entry.measured) >= 0.0005).length,
  );
  const badge = $derived(
    status === 'active'
      ? { text: 'Live in playoffs', tone: 'live' }
      : status === 'pending'
        ? { text: 'Playoffs only', tone: 'armed' }
        : status === 'legacy'
          ? { text: 'Not in this run', tone: 'muted' }
          : { text: 'No sample', tone: 'muted' },
  );
</script>

<div class="flex flex-col gap-4">
  <header class="flex flex-wrap items-end gap-x-2 gap-y-1">
    <div class="min-w-0">
      <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
        Playoff form · {seasonKey}
      </p>
      <h3 class="font-display mt-0.5 truncate text-xl leading-none font-extrabold uppercase">
        {displayName}
      </h3>
    </div>
    <span class="badge ml-auto" data-tone={badge.tone}>{badge.text}</span>
  </header>

  <div class="sample">
    <div class="sample-figure">
      <span class="sample-value">{sampleLabel(row.row)}</span>
      <span class="sample-label">playoff sample</span>
    </div>
    <div class="sample-figure">
      <span class="sample-value">{weightLabel(row.row)}</span>
      <span class="sample-label">applied</span>
    </div>
    <p class="sample-note">
      A short run is deliberately pulled toward neutral instead of being discarded. This is the
      observed difference for this exact season — not an opponent-adjusted estimate, and not a
      forecast of points or results.
    </p>
  </div>

  {#if status === 'legacy'}
    <p class="notice">
      This run was created before playoff performance existed, so its playoffs keep the previous
      simulation. Start a new run to use playoff form.
    </p>
  {:else if status === 'no-sample'}
    <p class="notice">
      No player in this run carries a recorded playoff sample, so nothing is adjusted.
    </p>
  {/if}

  <table class="ledger">
    <caption class="sr-only">
      Regular-season and playoff values, the measured difference, and the gameplay change the
      simulation uses.
    </caption>
    <thead>
      <tr>
        <th scope="col" class="th-left">Channel</th>
        <th scope="col">Reg</th>
        <th scope="col">PO</th>
        <th scope="col">Measured</th>
        <th scope="col">Applied</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as entry (entry.key)}
        <tr data-missing={entry.measured === null}>
          <th scope="row" class="th-row">
            <span class="channel">{entry.label}</span>
            <span class="feeds">{entry.feeds}</span>
          </th>
          <td class="num">{entry.regular}</td>
          <td class="num">{entry.playoffs}</td>
          <td class="num measured">
            {entry.measuredLabel}
            <span class="rail" aria-hidden="true">
              <span class="rail-axis"></span>
              {#if entry.measured !== null}
                <span
                  class="rail-bar rail-measured"
                  data-sign={entry.measured < 0 ? 'down' : 'up'}
                  style:--share={share(entry.measured, entry.cap)}
                ></span>
              {/if}
            </span>
          </td>
          <td class="num applied">
            <span
              class="applied-value"
              data-better={Math.abs(entry.applied) < 0.005
                ? 'flat'
                : isBetter(entry, entry.applied)
                  ? 'true'
                  : 'false'}>{entry.appliedLabel}</span
            >
            <span class="rail" aria-hidden="true">
              <span class="rail-axis"></span>
              <span
                class="rail-bar rail-applied"
                data-sign={entry.applied < 0 ? 'down' : 'up'}
                data-better={Math.abs(entry.applied) < 0.005
                  ? 'flat'
                  : isBetter(entry, entry.applied)
                    ? 'true'
                    : 'false'}
                style:--share={share(entry.applied, entry.cap)}
              ></span>
            </span>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="legend">
    <p class="legend-row">
      <span class="legend-swatch" data-kind="measured" aria-hidden="true"></span>
      Historical difference from the recorded regular season and playoff totals.
    </p>
    <p class="legend-row">
      <span class="legend-swatch" data-kind="applied" aria-hidden="true"></span>
      What the simulation actually changes, after the {String(
        CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
      )}-minute neutral anchor ({row.row.weight < 0.5 ? 'less' : 'more'} than half of the measured difference)
      and the per-channel caps. Both bars share one scale.
    </p>
    <p class="legend-row legend-note">
      True shooting is shown in percentage points, production per 36 minutes, applied changes in the
      engine units named. A higher turnover value is worse. Caps: {signedFixed(
        CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct * 100,
        0,
      )}pp shooting, {signedFixed(CAP_RUSH_PLAYOFF_CAPS.fieldGoalAttemptsPerGame, 1)} shots/g,
      {signedFixed(CAP_RUSH_PLAYOFF_CAPS.assistsPerGame, 1)} ast/g, {signedFixed(
        CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame +
          CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame,
        1,
      )} reb/g, {signedFixed(CAP_RUSH_PLAYOFF_CAPS.turnoverRate, 0)} turnover tendency. Formula
      {CAP_RUSH_PLAYOFF_FORMULA_VERSION}.
    </p>
  </div>

  {#if moving.length === 0}
    <p class="notice">
      {measuredChannels === 0
        ? 'This season records no measurable playoff difference, so the playoffs use his regular-season inputs.'
        : 'The measured differences round to no gameplay change, so the playoffs use his regular-season inputs.'}
    </p>
  {:else}
    <p class="notice notice-quiet">
      {moving.length} of {rows.length} channels move. A positive change is not a promise of more points:
      the other four players, the opponent, and the possession rolls still decide the game.
    </p>
  {/if}
</div>

<style>
  .badge {
    border: 1px solid var(--color-line-strong);
    border-radius: 0.25rem;
    padding: 0.1rem 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .badge[data-tone='live'] {
    border-color: color-mix(in srgb, var(--color-positive) 50%, transparent);
    background: color-mix(in srgb, var(--color-positive) 12%, transparent);
    color: var(--color-positive);
  }
  .badge[data-tone='armed'] {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .badge[data-tone='muted'] {
    color: var(--color-muted-foreground);
  }

  .sample {
    display: grid;
    grid-template-columns: auto auto;
    gap: 0.5rem 1.5rem;
    align-items: baseline;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.5rem;
    background: var(--color-surface-1);
    padding: 0.6rem 0.75rem;
  }
  .sample-figure {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .sample-value {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .sample-label {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .sample-note {
    grid-column: 1 / -1;
    font-size: 0.6875rem;
    line-height: 1.5;
    color: var(--color-muted-foreground);
  }

  .ledger {
    width: 100%;
    border-collapse: collapse;
    text-align: right;
  }
  .ledger thead th {
    border-bottom: 1px solid var(--color-line-soft);
    padding: 0 0.25rem 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted-foreground);
  }
  .th-left {
    text-align: left;
  }
  .ledger tbody tr {
    border-bottom: 1px solid color-mix(in srgb, var(--color-line-soft) 60%, transparent);
  }
  .th-row {
    padding: 0.4rem 0.25rem;
    text-align: left;
    vertical-align: top;
  }
  .channel {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .feeds {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.5rem;
    letter-spacing: 0.02em;
    color: var(--color-muted-foreground);
  }
  .num {
    padding: 0.4rem 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    vertical-align: top;
    white-space: nowrap;
  }
  tr[data-missing='true'] .measured {
    opacity: 0.55;
  }
  .applied-value {
    display: block;
    font-weight: 700;
  }
  .applied-value[data-better='true'] {
    color: var(--color-positive);
  }
  .applied-value[data-better='false'] {
    color: var(--color-negative);
  }
  .applied-value[data-better='flat'] {
    color: var(--color-muted-foreground);
  }

  .rail {
    position: relative;
    display: none;
    height: 6px;
    margin-top: 0.2rem;
    border-radius: 1px;
    background: var(--color-surface-3);
  }
  .rail-axis {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    background: color-mix(in srgb, var(--color-line-strong) 90%, transparent);
  }
  .rail-bar {
    position: absolute;
    top: 1px;
    bottom: 1px;
    width: calc(var(--share) * 50%);
    border-radius: 1px;
  }
  .rail-bar[data-better='true'] {
    background: var(--color-positive);
  }
  .rail-bar[data-better='false'] {
    background: var(--color-negative);
  }
  .rail-bar[data-better='flat'] {
    background: var(--color-line-strong);
  }
  .rail-measured {
    opacity: 0.4;
    left: 50%;
    background: var(--color-foreground);
  }
  .rail-measured[data-sign='down'] {
    left: auto;
    right: 50%;
  }
  .rail-applied {
    left: 50%;
  }
  .rail-applied[data-sign='down'] {
    left: auto;
    right: 50%;
  }

  .legend {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .legend-row {
    display: flex;
    gap: 0.4rem;
    font-size: 0.6875rem;
    line-height: 1.45;
    color: var(--color-muted-foreground);
  }
  .legend-swatch {
    flex: none;
    width: 12px;
    height: 6px;
    margin-top: 0.32rem;
    border-radius: 1px;
  }
  .legend-swatch[data-kind='measured'] {
    background: color-mix(in srgb, var(--color-foreground) 35%, transparent);
  }
  .legend-swatch[data-kind='applied'] {
    background: color-mix(in srgb, var(--color-positive) 70%, transparent);
  }
  .legend-note {
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    letter-spacing: 0.01em;
  }
  .notice {
    border: 1px solid var(--color-line-soft);
    border-radius: 0.375rem;
    background: var(--color-surface-2);
    padding: 0.5rem 0.625rem;
    font-size: 0.6875rem;
    line-height: 1.5;
  }
  .notice-quiet {
    border-color: transparent;
    background: transparent;
    padding: 0;
    color: var(--color-muted-foreground);
  }

  @media (min-width: 480px) {
    .rail {
      display: block;
    }
    .num {
      padding-inline: 0.4rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rail-bar {
      transition: none;
    }
  }
</style>
