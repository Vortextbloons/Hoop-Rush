import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIXED_SANDBOX_ERA,
  LINEUP_STRUCTURE,
  type ChallengeCreation,
  type ChallengeRun,
  type ShotZoneSummary,
} from '@hoop-rush/data-contracts';
import {
  createChallenge,
  createEngineContext,
  simulateChallenge,
  toSimulationPlayer,
} from '@hoop-rush/engine';
import { loadPackagedData, PackagedData, REPO_ROOT } from './commands/data-loader.ts';
import { resolvePoolLineup } from './commands/challenge.ts';
import { fixtureSeed } from './commands/sim.ts';

const SAMPLE_COUNT = 100;
const SEED_FIXTURE = 'lineup-paired-benchmark';

const LINEUP_SPECS: Record<string, string> = {
  D1:
    'Trae Young@Atlanta Hawks/2020s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  D2:
    'Gary Payton@Oklahoma City Thunder/1990s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  E1:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,Carmelo Anthony@New York Knicks/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  E2:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,Kawhi Leonard@San Antonio Spurs/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  F1:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  F2:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Hakeem Olajuwon@Houston Rockets/1990s',
  G1:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  G2:
    'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dennis Rodman@Detroit Pistons/1990s,Nikola Jokić@Denver Nuggets/2020s',
};

const PAIRS: Array<{
  id: string;
  label: string;
  weakId: string;
  strongId: string;
  swapLabel: string;
}> = [
  { id: 'D', label: 'POA defense', weakId: 'D1', strongId: 'D2', swapLabel: 'Trae Young → Gary Payton (PG)' },
  { id: 'E', label: 'Wing defense', weakId: 'E1', strongId: 'E2', swapLabel: 'Carmelo Anthony → Kawhi Leonard (SF)' },
  { id: 'F', label: 'Rim protection', weakId: 'F1', strongId: 'F2', swapLabel: 'Nikola Jokić → Hakeem Olajuwon (C)' },
  { id: 'G', label: 'PF defense / glass', weakId: 'G1', strongId: 'G2', swapLabel: 'Dirk Nowitzki → Dennis Rodman (PF)' },
];

interface SeasonMetrics {
  wins: number;
  pointDiffPerGame: number;
  ppg: number;
  oppPpg: number;
  possessionsPerGame: number;
  ortg: number;
  drtg: number;
  oppFgPct: number;
  oppEfgPct: number;
  oppTsPct: number;
  opp3pPct: number;
  oppRimFgPct: number | null;
  oppFtaPerGame: number;
  oppOrebPerGame: number;
  drebPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
}

type MetricKey = keyof SeasonMetrics;

const METRIC_ROWS: Array<{ key: MetricKey; label: string; format: (value: number | null) => string }> =
  [
    { key: 'wins', label: 'Wins', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'pointDiffPerGame', label: 'Point diff / game', format: (v) => signed((v ?? 0), 2) },
    { key: 'ppg', label: 'PPG', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'oppPpg', label: 'Opponent PPG', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'possessionsPerGame', label: 'Possessions / game', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'ortg', label: 'ORtg', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'drtg', label: 'DRtg', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'oppFgPct', label: 'Opponent FG%', format: (v) => pct(v ?? 0) },
    { key: 'oppEfgPct', label: 'Opponent eFG%', format: (v) => pct(v ?? 0) },
    { key: 'oppTsPct', label: 'Opponent TS%', format: (v) => pct(v ?? 0) },
    { key: 'opp3pPct', label: 'Opponent 3P%', format: (v) => pct(v ?? 0) },
    { key: 'oppRimFgPct', label: 'Opponent rim FG%', format: (v) => (v === null ? '—' : pct(v)) },
    { key: 'oppFtaPerGame', label: 'Opponent FTA / game', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'oppOrebPerGame', label: 'Opponent OREB / game', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'drebPerGame', label: 'Your DREB / game', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'stealsPerGame', label: 'Steals / game', format: (v) => (v ?? 0).toFixed(2) },
    { key: 'blocksPerGame', label: 'Blocks / game', format: (v) => (v ?? 0).toFixed(2) },
  ];

function signed(value: number, digits: number): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function fmtStat(values: readonly number[], formatter: (value: number) => string): string {
  const spread = stdev(values);
  const spreadText = Number.isFinite(spread) ? spread.toFixed(2) : '0.00';
  return `${formatter(mean(values))} ± ${spreadText}`;
}

function fmtPctStat(values: readonly number[]): string {
  const spread = stdev(values);
  const spreadText = Number.isFinite(spread) ? pct(spread) : '0.0%';
  return `${pct(mean(values))} ± ${spreadText}`;
}

function fmtNullableStat(
  values: readonly (number | null)[],
  formatter: (value: number) => string,
): string {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return '—';
  const spread = stdev(numeric);
  const spreadText = Number.isFinite(spread) ? pct(spread) : '0.0%';
  return `${formatter(mean(numeric))} ± ${spreadText}`;
}

function opponentTotals(run: ChallengeRun) {
  const zoneTotals = new Map<string, { attempts: number; makes: number }>();
  const totals = {
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { offensive: 0, defensive: 0 },
    shotZones: [] as ShotZoneSummary[],
  };
  for (const game of run.games) {
    const box = game.away.box;
    totals.points += box.points;
    totals.fieldGoals.made += box.fieldGoals.made;
    totals.fieldGoals.attempted += box.fieldGoals.attempted;
    totals.threes.made += box.threes.made;
    totals.threes.attempted += box.threes.attempted;
    totals.freeThrows.made += box.freeThrows.made;
    totals.freeThrows.attempted += box.freeThrows.attempted;
    totals.rebounds.offensive += box.rebounds.offensive;
    totals.rebounds.defensive += box.rebounds.defensive;
    for (const zone of game.away.shotZones) {
      const acc = zoneTotals.get(zone.zone) ?? { attempts: 0, makes: 0 };
      acc.attempts += zone.attempts;
      acc.makes += zone.makes;
      zoneTotals.set(zone.zone, acc);
    }
  }
  totals.shotZones = [...zoneTotals.entries()].map(([zone, acc]) => ({
    zone: zone as ShotZoneSummary['zone'],
    attempts: acc.attempts,
    makes: acc.makes,
  }));
  return totals;
}

function seasonMetrics(run: ChallengeRun): SeasonMetrics {
  const team = run.aggregates.team;
  const games = team.gamesPlayed;
  const opp = opponentTotals(run);
  const possessions = Math.max(1, team.possessions);
  const rim = opp.shotZones.find((zone) => zone.zone === 'rim');
  const oppFgAttempts = Math.max(1, opp.fieldGoals.attempted);
  const oppTsDenom = 2 * (opp.fieldGoals.attempted + 0.44 * opp.freeThrows.attempted);
  return {
    wins: team.wins,
    pointDiffPerGame: (team.points - opp.points) / games,
    ppg: team.points / games,
    oppPpg: opp.points / games,
    possessionsPerGame: team.possessions / games,
    ortg: (team.points / possessions) * 100,
    drtg: (opp.points / possessions) * 100,
    oppFgPct: opp.fieldGoals.made / oppFgAttempts,
    oppEfgPct: (opp.fieldGoals.made + 0.5 * opp.threes.made) / oppFgAttempts,
    oppTsPct: oppTsDenom > 0 ? opp.points / oppTsDenom : 0,
    opp3pPct: opp.threes.attempted > 0 ? opp.threes.made / opp.threes.attempted : 0,
    oppRimFgPct: rim && rim.attempts > 0 ? rim.makes / rim.attempts : null,
    oppFtaPerGame: opp.freeThrows.attempted / games,
    oppOrebPerGame: opp.rebounds.offensive / games,
    drebPerGame: team.rebounds.defensive / games,
    stealsPerGame: team.steals / games,
    blocksPerGame: team.blocks / games,
  };
}

function buildCreation(
  lineupId: string,
  spec: string,
  seed: string,
  data: PackagedData,
  context: ReturnType<typeof createEngineContext>,
): ChallengeCreation {
  const eraId = FIXED_SANDBOX_ERA;
  const profile = data.eraProfile(eraId);
  const bracket = data.bracket();
  const resolved = resolvePoolLineup(spec, data);
  const players = resolved.map((player) => toSimulationPlayer(player));
  const sample = resolved[0];
  return {
    runId: `paired-${lineupId}-${seed.slice(0, 8)}`,
    mode: 'sandbox',
    franchiseId: null,
    eraId,
    homeDisplayName: resolved.map((player) => player.displayName).join(' · ').slice(0, 96),
    lineup: {
      structure: [...LINEUP_STRUCTURE],
      assignments: resolved.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.playable,
      })),
    },
    players,
    selections: resolved.map((player) => ({
      playerId: player.playerId,
      franchiseId: player.franchiseId,
      eraId: player.eraId,
    })),
    runSeed: seed,
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
  };
}

function simulateLineup(
  lineupId: string,
  spec: string,
  sampleIndex: number,
  data: PackagedData,
  context: ReturnType<typeof createEngineContext>,
): SeasonMetrics {
  const seed = fixtureSeed(SEED_FIXTURE, sampleIndex);
  const creation = buildCreation(lineupId, spec, seed, data, context);
  const run = simulateChallenge(createChallenge(creation), creation.profile, context);
  return seasonMetrics(run);
}

function collectMetrics(
  lineupId: string,
  spec: string,
  data: PackagedData,
  context: ReturnType<typeof createEngineContext>,
): SeasonMetrics[] {
  const results: SeasonMetrics[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    results.push(simulateLineup(lineupId, spec, index, data, context));
    if ((index + 1) % 10 === 0) {
      console.log(`  ${lineupId}: ${String(index + 1)}/${String(SAMPLE_COUNT)}`);
    }
  }
  return results;
}

function metricValues(results: SeasonMetrics[], key: MetricKey): Array<number | null> {
  return results.map((result) => result[key]);
}

const packaged = loadPackagedData();
const data = new PackagedData(packaged.manifest, packaged.dir);
const context = createEngineContext();

const pairResults = PAIRS.map((pair) => {
  console.log(`Pair ${pair.id}: ${pair.weakId} vs ${pair.strongId}`);
  const weakSpec = LINEUP_SPECS[pair.weakId];
  const strongSpec = LINEUP_SPECS[pair.strongId];
  if (!weakSpec || !strongSpec) {
    throw new Error(`missing lineup spec for ${pair.weakId} or ${pair.strongId}`);
  }
  const weak = collectMetrics(pair.weakId, weakSpec, data, context);
  const strong = collectMetrics(pair.strongId, strongSpec, data, context);
  const pairedDeltaDrtg = strong.map((strongRun, index) => strongRun.drtg - weak[index].drtg);
  return { pair, weak, strong, pairedDeltaDrtg };
});

const headline = pairResults
  .map(({ pair, pairedDeltaDrtg }) => {
    return `| ${pair.id} | ${pair.swapLabel} | ${fmtStat(pairedDeltaDrtg, (v) => signed(v, 2))} |`;
  })
  .join('\n');

const sections = pairResults
  .map(({ pair, weak, strong, pairedDeltaDrtg }) => {
    const rows = METRIC_ROWS
      .map((row) => {
        const weakValues = metricValues(weak, row.key);
        const strongValues = metricValues(strong, row.key);
        const weakCell =
          row.key === 'oppRimFgPct'
            ? fmtNullableStat(weakValues, (v) => pct(v))
            : row.key.startsWith('opp') && row.key.endsWith('Pct')
              ? fmtPctStat(weakValues as number[])
              : fmtStat(weakValues as number[], (v) => row.format(v));
        const strongCell =
          row.key === 'oppRimFgPct'
            ? fmtNullableStat(strongValues, (v) => pct(v))
            : row.key.startsWith('opp') && row.key.endsWith('Pct')
              ? fmtPctStat(strongValues as number[])
              : fmtStat(strongValues as number[], (v) => row.format(v));
        return `| ${row.label} | ${weakCell} | ${strongCell} |`;
      })
      .join('\n');
    return `## Pair ${pair.id} — ${pair.label}

**Swap:** ${pair.swapLabel}

**Paired ΔDRtg** (DRtg strong − DRtg weak, same seed): **${fmtStat(pairedDeltaDrtg, (v) => signed(v, 2))}**

Negative ΔDRtg means the strong-defender lineup allowed fewer points per 100 possessions on the paired schedule.

| Metric | ${pair.weakId} (weak) | ${pair.strongId} (strong) |
| --- | --- | --- |
${rows}
`;
  })
  .join('\n');

const markdown = `# Lineup Paired Benchmark (${SAMPLE_COUNT} seeds)

Generated: ${new Date().toISOString()}

Each pair runs **${SAMPLE_COUNT}** independent full 82-game challenge seasons. Both lineups in a pair use the **same seed** for each index (seeds derived from \`${SEED_FIXTURE}-0\` … \`${SEED_FIXTURE}-${String(SAMPLE_COUNT - 1)}\`).

This is **not** best-of-N. Every season is retained and summarized as mean ± sample standard deviation.

## Headline: paired ΔDRtg

| Pair | Swap | Paired ΔDRtg (strong − weak) |
| --- | --- | ---: |
${headline}

${sections}
`;

const outPath = resolve(REPO_ROOT, 'Docs/lineup-paired-benchmark.md');
writeFileSync(outPath, markdown);
console.log(`\nWrote ${outPath}`);
